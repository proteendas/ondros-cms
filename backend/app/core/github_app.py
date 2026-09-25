"""GitHub client for Ondros Code Sync.

Two credential modes, chosen by config (``Settings.code_sync_mode``):

  app    A registered GitHub App. We mint a short-lived RS256 App JWT from the
         private key, exchange it for an *installation* access token, and call
         the REST API with that. This is the real mode: per-installation
         scoping, revocable by the customer, no long-lived secret per space.
  token  A personal access token in ``GITHUB_TOKEN``. A development fallback so
         the feature is exercisable before the App is registered — it has the
         token owner's access, so it is never appropriate in production.

Installation tokens live an hour; they are cached in-process until a minute
before expiry. Nothing here touches the database.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt

from app.config import get_settings

logger = logging.getLogger(__name__)

_ACCEPT = "application/vnd.github+json"
_API_VERSION = "2022-11-28"
# Installation tokens are valid for an hour; refresh a minute early.
_TOKEN_SKEW_SECONDS = 60


class GitHubError(RuntimeError):
    """A GitHub call failed in a way the caller should surface to the user."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


@dataclass
class _CachedToken:
    token: str
    expires_at: float


_installation_tokens: dict[str, _CachedToken] = {}


def _private_key() -> str:
    """The App's PEM, accepting the three shapes people paste into env vars."""
    raw = (get_settings().github_app_private_key or "").strip()
    if not raw:
        raise GitHubError("GITHUB_APP_PRIVATE_KEY is not set")
    if "-----BEGIN" in raw:
        # Escaped newlines survive .env round-trips; real newlines pass through.
        return raw.replace("\\n", "\n")
    try:
        decoded = base64.b64decode(raw, validate=True).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError) as exc:
        raise GitHubError("GITHUB_APP_PRIVATE_KEY is neither a PEM nor valid base64") from exc
    if "-----BEGIN" not in decoded:
        raise GitHubError("GITHUB_APP_PRIVATE_KEY decoded to something that is not a PEM")
    return decoded


def app_jwt() -> str:
    """Short-lived JWT identifying the App itself (not an installation)."""
    settings = get_settings()
    if not settings.github_app_id:
        raise GitHubError("GITHUB_APP_ID is not set")
    now = int(time.time())
    return jwt.encode(
        # 60s backdate absorbs clock skew between us and GitHub, as their docs
        # recommend; 9 minutes is under their 10-minute ceiling.
        {"iat": now - 60, "exp": now + 540, "iss": settings.github_app_id},
        _private_key(),
        algorithm="RS256",
    )


def install_url(state: str = "") -> str:
    """Where to send someone to install the App on their org or account."""
    settings = get_settings()
    slug = settings.github_app_slug or "ondros-code-sync"
    url = f"https://github.com/apps/{slug}/installations/new"
    return f"{url}?state={state}" if state else url


def verify_webhook(body: bytes, signature: str | None) -> bool:
    """Constant-time check of GitHub's X-Hub-Signature-256 header."""
    secret = get_settings().github_app_webhook_secret
    if not secret:
        # Unconfigured secret means we cannot prove the sender: refuse rather
        # than trust, so a public endpoint can't be used to force syncs.
        return False
    if not signature or not signature.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature[len("sha256=") :])


async def _request(
    method: str,
    path: str,
    token: str,
    *,
    token_type: str = "token",
    params: dict | None = None,
) -> Any:
    settings = get_settings()
    url = path if path.startswith("http") else f"{settings.github_api_url}{path}"
    headers = {
        "Accept": _ACCEPT,
        "Authorization": f"{token_type} {token}",
        "X-GitHub-Api-Version": _API_VERSION,
    }
    async with httpx.AsyncClient(timeout=20) as client:
        res = await client.request(method, url, headers=headers, params=params)
    if res.status_code == 404:
        raise GitHubError(f"Not found on GitHub: {path}", status=404)
    if res.status_code == 401:
        # Say which credential to fix: "reinstall the app" is nonsense advice
        # when the deployment is running on a personal access token.
        fix = (
            "reinstall the Ondros Code Sync app"
            if settings.code_sync_mode == "app"
            else "check GITHUB_TOKEN"
        )
        raise GitHubError(f"GitHub rejected our credentials — {fix}", status=401)
    if res.status_code == 403:
        raise GitHubError(
            "GitHub denied access. Check the installation still grants this repository.",
            status=403,
        )
    if res.status_code >= 400:
        raise GitHubError(f"GitHub returned {res.status_code}: {res.text[:200]}", status=res.status_code)
    return res.json() if res.content else None


async def installation_token(installation_id: str) -> str:
    """Access token for one installation, cached until just before it expires."""
    cached = _installation_tokens.get(installation_id)
    if cached and cached.expires_at - _TOKEN_SKEW_SECONDS > time.time():
        return cached.token

    data = await _request(
        "POST",
        f"/app/installations/{installation_id}/access_tokens",
        app_jwt(),
        token_type="Bearer",
    )
    token = data["token"]
    # expires_at is ISO-8601; an hour from now is the documented lifetime and a
    # safe floor if the field ever changes shape.
    _installation_tokens[installation_id] = _CachedToken(token, time.time() + 3600)
    return token


async def _credential(installation_id: str | None) -> str:
    settings = get_settings()
    if settings.code_sync_mode == "app":
        if not installation_id:
            raise GitHubError("This space has no GitHub App installation yet")
        return await installation_token(installation_id)
    if settings.code_sync_mode == "token":
        return settings.github_token
    raise GitHubError(
        "Code Sync is not configured on this server. Set GITHUB_APP_ID and "
        "GITHUB_APP_PRIVATE_KEY (or GITHUB_TOKEN for local development)."
    )


async def list_repositories(installation_id: str | None) -> list[dict]:
    """Repositories the connection may read, newest push first."""
    token = await _credential(installation_id)
    if get_settings().code_sync_mode == "app":
        data = await _request(
            "GET", "/installation/repositories", token, params={"per_page": 100}
        )
        repos = data.get("repositories", [])
    else:
        repos = await _request(
            "GET", "/user/repos", token, params={"per_page": 100, "sort": "pushed"}
        )
    return [
        {
            "fullName": r["full_name"],
            "name": r["name"],
            "private": r.get("private", False),
            "defaultBranch": r.get("default_branch", "main"),
            "htmlUrl": r.get("html_url", ""),
            "owner": (r.get("owner") or {}).get("login", ""),
        }
        for r in repos
    ]


async def installation_account(installation_id: str) -> dict:
    """Who installed the App — shown in the editor so people can confirm."""
    data = await _request("GET", f"/app/installations/{installation_id}", app_jwt(), token_type="Bearer")
    account = data.get("account") or {}
    return {
        "login": account.get("login", ""),
        "type": account.get("type", ""),
        "repositorySelection": data.get("repository_selection", ""),
    }


async def list_directory(
    repo_full_name: str, path: str, ref: str, installation_id: str | None
) -> list[dict]:
    """Entries in one repository directory, or [] when it doesn't exist.

    Used to discover components by convention (``blocks/<name>/``) in projects
    that ship no manifest, so connecting a repository needs no prior setup.
    """
    token = await _credential(installation_id)
    try:
        data = await _request(
            "GET", f"/repos/{repo_full_name}/contents/{path}", token, params={"ref": ref}
        )
    except GitHubError as exc:
        if exc.status == 404:
            return []
        raise
    if not isinstance(data, list):
        return []
    return [
        {"name": item.get("name", ""), "type": item.get("type", "")}
        for item in data
        if isinstance(item, dict)
    ]


async def get_file(
    repo_full_name: str, path: str, ref: str, installation_id: str | None
) -> str | None:
    """Decoded text of one file, or None when the repo simply doesn't have it.

    A missing file is an ordinary outcome here — manifest discovery tries
    several paths — so only *other* failures raise.
    """
    token = await _credential(installation_id)
    try:
        data = await _request(
            "GET", f"/repos/{repo_full_name}/contents/{path}", token, params={"ref": ref}
        )
    except GitHubError as exc:
        if exc.status == 404:
            return None
        raise
    if not isinstance(data, dict) or data.get("type") != "file":
        return None
    content = data.get("content") or ""
    encoding = data.get("encoding")
    if encoding != "base64":
        return content
    try:
        return base64.b64decode(content).decode("utf-8")
    except (binascii.Error, UnicodeDecodeError):
        logger.warning("Code Sync: %s:%s is not UTF-8 text", repo_full_name, path)
        return None
