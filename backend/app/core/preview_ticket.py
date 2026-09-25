"""Short-lived signed tickets that authorize a draft preview.

A connected site renders **unpublished** content when the editor asks it to.
Without proof that the request came from the editor, `?ondros-preview=1` is an
open door: anyone who is sent the URL — or finds it in a referrer log, a chat
message or browser history — reads every draft in the space.

So the editor no longer passes a flag, it passes a ticket:

    ?ondros-preview=<base64url(payload)>.<base64url(hmac-sha256)>

The payload is minted by ``preview-target``, which already requires an
authenticated actor with read access to the space. The site verifies it with
the connection's preview secret, which it holds in its own environment and
which never reaches the browser. A ticket that is missing, malformed, expired
or signed with the wrong secret means "not a preview" — the site serves its
published content, exactly as it would to any other visitor.

Sites verify rather than call back to the CMS because a preview must render
while the CMS is unreachable from the site's runtime, and because a per-render
round trip would show in every preview. The trade is that a ticket cannot be
revoked before it expires, which is why the lifetime is minutes.

The format is deliberately plain — base64url JSON and one HMAC — so it can be
verified in ten lines in any language. See `docs/20-code-sync.md`.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time

#: Long enough to open a preview, follow a link on the site and keep editing;
#: short enough that a leaked URL is worthless by the time it is shared.
DEFAULT_TTL_SECONDS = 30 * 60

#: Tolerance for clock skew between the CMS and the site.
LEEWAY_SECONDS = 60


def generate_secret() -> str:
    """A new preview secret for a connection (shown to the customer to copy)."""
    return "ondros_pv_" + secrets.token_urlsafe(32)


def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def mint(
    secret: str,
    *,
    environment: str = "",
    subject: str = "",
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
    now: float | None = None,
) -> str:
    """Sign a preview ticket.

    ``subject`` is the acting user's id. It is not used for authorization — the
    site has no user directory — but it makes a leaked ticket traceable to the
    session that produced it.
    """
    issued = int(now if now is not None else time.time())
    payload = {"iat": issued, "exp": issued + ttl_seconds}
    if environment:
        payload["env"] = environment
    if subject:
        payload["sub"] = subject

    body = _b64(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    return f"{body}.{_b64(_sign(secret, body))}"


def _sign(secret: str, body: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()


def verify(
    secret: str,
    ticket: str | None,
    *,
    environment: str = "",
    now: float | None = None,
) -> dict | None:
    """Return the payload of a valid ticket, or None.

    Mirrors what a connected site implements, and is what the tests exercise —
    a site that gets this wrong fails open, so the reference behaviour lives
    here rather than only in the docs.
    """
    if not secret or not ticket or "." not in ticket:
        return None

    body, _, signature = ticket.partition(".")
    try:
        expected = _sign(secret, body)
        if not hmac.compare_digest(expected, _unb64(signature)):
            return None
        payload = json.loads(_unb64(body))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    expires = payload.get("exp")
    if not isinstance(expires, int):
        return None
    if (now if now is not None else time.time()) > expires + LEEWAY_SECONDS:
        return None

    # A ticket minted for one environment must not unlock another's drafts.
    if environment and payload.get("env") and payload["env"] != environment:
        return None

    return payload
