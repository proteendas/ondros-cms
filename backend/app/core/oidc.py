"""OIDC relying-party helpers (spec 002). Crypto via authlib — not hand-rolled.

Flow: discovery -> authorization redirect -> code exchange -> id_token
verification against the IdP's JWKS (issuer + audience checked).
"""
import logging
import time
from dataclasses import dataclass

import httpx
from authlib.jose import JsonWebKey, JsonWebToken

logger = logging.getLogger(__name__)

GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration"
MICROSOFT_DISCOVERY = "https://login.microsoftonline.com/{tenant}/v2.0/.well-known/openid-configuration"

_DISCOVERY_TTL_S = 3600
_discovery_cache: dict[str, tuple[float, dict]] = {}
_jwks_cache: dict[str, tuple[float, dict]] = {}


class OIDCError(RuntimeError):
    pass


@dataclass
class OIDCProvider:
    discovery_url: str
    client_id: str
    client_secret: str


async def fetch_discovery(url: str) -> dict:
    cached = _discovery_cache.get(url)
    if cached and time.monotonic() - cached[0] < _DISCOVERY_TTL_S:
        return cached[1]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(url)
    if res.status_code != 200:
        raise OIDCError(f"OIDC discovery failed ({res.status_code}) for {url}")
    doc = res.json()
    for key in ("authorization_endpoint", "token_endpoint", "jwks_uri", "issuer"):
        if key not in doc:
            raise OIDCError(f"OIDC discovery document missing '{key}'")
    _discovery_cache[url] = (time.monotonic(), doc)
    return doc


async def _fetch_jwks(jwks_uri: str) -> dict:
    cached = _jwks_cache.get(jwks_uri)
    if cached and time.monotonic() - cached[0] < _DISCOVERY_TTL_S:
        return cached[1]
    async with httpx.AsyncClient(timeout=10) as client:
        res = await client.get(jwks_uri)
    if res.status_code != 200:
        raise OIDCError(f"JWKS fetch failed ({res.status_code})")
    jwks = res.json()
    _jwks_cache[jwks_uri] = (time.monotonic(), jwks)
    return jwks


async def build_authorize_url(provider: OIDCProvider, redirect_uri: str, state: str) -> str:
    doc = await fetch_discovery(provider.discovery_url)
    params = httpx.QueryParams(
        {
            "response_type": "code",
            "client_id": provider.client_id,
            "redirect_uri": redirect_uri,
            "scope": "openid email profile",
            "state": state,
            "prompt": "select_account",
        }
    )
    return f"{doc['authorization_endpoint']}?{params}"


async def exchange_code(provider: OIDCProvider, code: str, redirect_uri: str) -> dict:
    """Exchange the authorization code; returns verified id_token claims."""
    doc = await fetch_discovery(provider.discovery_url)
    async with httpx.AsyncClient(timeout=15) as client:
        res = await client.post(
            doc["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": provider.client_id,
                "client_secret": provider.client_secret,
            },
        )
    if res.status_code != 200:
        raise OIDCError(f"Token exchange failed ({res.status_code}): {res.text[:300]}")
    payload = res.json()
    id_token = payload.get("id_token")
    if not id_token:
        raise OIDCError("IdP response contained no id_token")

    jwks = JsonWebKey.import_key_set(await _fetch_jwks(doc["jwks_uri"]))
    jwt = JsonWebToken(["RS256", "ES256"])
    claims = jwt.decode(
        id_token,
        jwks,
        claims_options={
            "iss": {"essential": True, "value": doc["issuer"]},
            "aud": {"essential": True, "value": provider.client_id},
            "exp": {"essential": True},
        },
    )
    claims.validate()
    return dict(claims)
