"""Password hashing (bcrypt), JWT issuance/verification, API key tokens."""
import hashlib
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app.config import get_settings

settings = get_settings()

# Token prefixes make key types recognizable at a glance (and in logs).
API_KEY_PREFIXES = {"delivery": "cms_del_", "preview": "cms_pre_", "management": "cms_mgm_"}


def generate_api_token(key_type: str) -> tuple[str, str, str]:
    """Returns (token, display_prefix, sha256_hash). The token is shown once;
    only the hash is persisted."""
    token = API_KEY_PREFIXES.get(key_type, "cms_key_") + secrets.token_urlsafe(32)
    return token, token[:16], hash_api_token(token)


def hash_api_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(
    user_id: str,
    tenant_id: str,
    email: str,
    roles: list[str] | None = None,
    active_space_id: str | None = None,
) -> str:
    """Access JWT. Claims: sub (user), account_id (active account), roles[],
    optional active_space_id. `tenant_id` kept as an alias of account_id for
    backward compatibility with older clients."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {
        "sub": user_id,
        "account_id": tenant_id,
        "tenant_id": tenant_id,
        "email": email,
        "roles": roles or [],
        "type": "access",
        "exp": expire,
    }
    if active_space_id:
        payload["active_space_id"] = active_space_id
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    """Raises jwt.PyJWTError on invalid/expired tokens."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def generate_opaque_token(prefix: str = "") -> tuple[str, str]:
    """Random URL-safe token for refresh/action/invite links.
    Returns (raw_token, sha256_hash) — only the hash is stored."""
    raw = prefix + secrets.token_urlsafe(32)
    return raw, hash_api_token(raw)


def create_state_token(payload: dict, expires_minutes: int = 10) -> str:
    """Short-lived signed state (OIDC round-trips)."""
    data = {**payload, "exp": datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)}
    return jwt.encode(data, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_state_token(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
