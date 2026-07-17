"""Shared FastAPI dependencies: DB session, actors (users / API keys),
capability checks, environment resolution.

Two authentication planes:

  Management plane  -> `get_actor` accepts a user JWT *or* a management API key.
                       Capability checks via `require_capability` (space_id read
                       from the route path) or `ensure_can` (id-addressed routes
                       that resolve the space after loading the object).

  Content plane     -> `get_content_key` accepts delivery/preview API keys
                       (Authorization: Bearer or ?access_token=). Delivery keys
                       see published content only; preview keys see drafts too.
"""
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import usage
from app.core.permissions import user_capabilities
from app.core.security import decode_access_token, hash_api_token
from app.database import get_db
from app.models import AccountMember, ApiKey, Environment, Space, Tenant, User

_credentials_error = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def _bearer_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


@dataclass
class Actor:
    """The authenticated principal on the management plane.

    `tenant_id` is the ACTIVE ACCOUNT — resolved from the validated JWT
    `account_id` claim (membership-checked), never from the request body.
    """

    tenant_id: uuid.UUID
    user: User | None = None
    api_key: ApiKey | None = None

    @property
    def user_id(self) -> uuid.UUID | None:
        return self.user.id if self.user else None

    def capabilities(self, space_id: uuid.UUID | None = None) -> set[str]:
        if self.api_key is not None:
            # Management keys act as space admins of their own space only.
            if space_id is None or space_id == self.api_key.space_id:
                return {"*"}
            return set()
        assert self.user is not None
        return user_capabilities(self.user, space_id, account_id=self.tenant_id)

    def can(self, capability: str, space_id: uuid.UUID | None = None) -> bool:
        caps = self.capabilities(space_id)
        return "*" in caps or capability in caps


async def _bind_account(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """Row-Level-Security binding: expose the active account to Postgres for
    the duration of this transaction (policies check
    current_setting('app.current_account_id')). No-op unless the app connects
    as a non-owner role — see specs/001."""
    try:
        await db.execute(
            text("SELECT set_config('app.current_account_id', :v, true)"),
            {"v": str(tenant_id)},
        )
    except Exception:  # pragma: no cover - never block requests on RLS binding
        pass


async def _load_user(db: AsyncSession, token: str) -> User | None:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
    except (pyjwt.PyJWTError, KeyError, ValueError):
        return None
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        return None
    return user


async def _load_api_key(db: AsyncSession, token: str, types: set[str]) -> ApiKey | None:
    if not token.startswith("cms_"):
        return None
    key = (
        await db.execute(select(ApiKey).where(ApiKey.token_hash == hash_api_token(token)))
    ).scalar_one_or_none()
    if key is None or not key.enabled or key.type not in types:
        return None
    # Fire-and-forget usage stamp (no ORM refresh needed).
    await db.execute(
        update(ApiKey).where(ApiKey.id == key.id).values(last_used_at=datetime.now(timezone.utc))
    )
    await db.commit()
    return key


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """JWT-only dependency (auth endpoints, user profile)."""
    token = _bearer_token(request)
    if not token:
        raise _credentials_error
    user = await _load_user(db, token)
    if user is None:
        raise _credentials_error
    return user


async def get_actor(request: Request, db: AsyncSession = Depends(get_db)) -> Actor:
    """Management-plane auth: user JWT or management API key.

    For user JWTs the active account comes from the `account_id` claim and is
    validated against AccountMember (multi-account users). Every request binds
    the account for RLS, bumps the usage counter and enforces the API quota.
    """
    token = _bearer_token(request)
    if not token:
        raise _credentials_error
    if token.startswith("cms_"):
        key = await _load_api_key(db, token, {"management"})
        if key is None:
            raise HTTPException(status_code=401, detail="Invalid or disabled management token")
        await _bind_account(db, key.tenant_id)
        usage.track_api_call(key.tenant_id)
        await usage.check_api_quota(db, key.tenant_id)
        return Actor(tenant_id=key.tenant_id, api_key=key)

    try:
        payload = decode_access_token(token)
    except pyjwt.PyJWTError:
        raise _credentials_error
    if payload.get("type", "access") != "access":
        raise HTTPException(status_code=401, detail="Refresh tokens cannot access the API")
    user = await _load_user(db, token)
    if user is None:
        raise _credentials_error

    claimed = payload.get("account_id") or payload.get("tenant_id")
    try:
        account_id = uuid.UUID(str(claimed)) if claimed else user.tenant_id
    except ValueError:
        raise _credentials_error
    if account_id != user.tenant_id:
        member = (
            await db.execute(
                select(AccountMember).where(
                    AccountMember.user_id == user.id, AccountMember.tenant_id == account_id
                )
            )
        ).scalar_one_or_none()
        if member is None:
            raise HTTPException(status_code=403, detail="Not a member of this account")

    await _bind_account(db, account_id)
    usage.track_api_call(account_id)
    await usage.check_api_quota(db, account_id)
    return Actor(tenant_id=account_id, user=user)


async def get_current_account(
    db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)
) -> Tenant:
    """The active account (Tenant row) — derived exclusively from the token."""
    account = (
        await db.execute(select(Tenant).where(Tenant.id == actor.tenant_id))
    ).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def require_capability(capability: str):
    """Capability check for routes that carry {space_id} in their path
    (falls back to an org-level check when they don't).

    Usage: actor: Actor = Depends(require_capability(Capability.MANAGE_ENTRIES))
    """

    async def checker(request: Request, actor: Actor = Depends(get_actor)) -> Actor:
        raw = request.path_params.get("space_id")
        space_id: uuid.UUID | None = None
        if raw is not None:
            try:
                space_id = uuid.UUID(str(raw))
            except ValueError:
                raise HTTPException(status_code=422, detail="Invalid space id")
        ensure_can(actor, capability, space_id)
        return actor

    return checker


def ensure_can(actor: Actor, capability: str, space_id: uuid.UUID | None = None) -> None:
    """Imperative capability check for handlers that resolve the space from
    the loaded object (entries, assets, ... addressed by id)."""
    cap = capability.value if hasattr(capability, "value") else capability
    if not actor.can(cap, space_id):
        raise HTTPException(status_code=403, detail=f"Missing permission: {cap}")


async def get_space(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
) -> Space:
    """Load a space in the actor's tenant (404 if not found / other tenant)."""
    space = (
        await db.execute(
            select(Space).where(Space.id == space_id, Space.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=404, detail="Space not found")
    return space


async def resolve_environment(
    db: AsyncSession, space_id: uuid.UUID, env_key_or_id: str
) -> Environment:
    """Resolve an environment by key ("master") or UUID, within one space."""
    stmt = select(Environment).where(Environment.space_id == space_id)
    try:
        stmt = stmt.where(Environment.id == uuid.UUID(env_key_or_id))
    except ValueError:
        stmt = stmt.where(Environment.key == env_key_or_id)
    env = (await db.execute(stmt)).scalar_one_or_none()
    if env is None:
        raise HTTPException(status_code=404, detail=f"Environment '{env_key_or_id}' not found")
    return env


async def get_environment(
    space_id: uuid.UUID,
    environment: str,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
) -> Environment:
    """Path-based environment resolution for management routes
    (/spaces/{space_id}/environments/{environment}/...)."""
    await get_space(space_id, db, actor)  # tenant check
    return await resolve_environment(db, space_id, environment)


# --- Content plane (delivery / preview keys) ---------------------------------


@dataclass
class ContentKeyContext:
    api_key: ApiKey
    space: Space
    environment: Environment

    @property
    def include_drafts(self) -> bool:
        return self.api_key.type == "preview"


async def get_content_key(
    space_id: uuid.UUID,
    environment: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> ContentKeyContext:
    """Auth for the delivery/preview API. Token via Authorization: Bearer or
    ?access_token=. Enforces space + environment scoping."""
    token = _bearer_token(request) or request.query_params.get("access_token")
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Missing access token. Send 'Authorization: Bearer <token>' or ?access_token=",
        )
    key = await _load_api_key(db, token, {"delivery", "preview"})
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid or disabled access token")
    if key.space_id != space_id:
        raise HTTPException(status_code=403, detail="Token does not grant access to this space")
    await _bind_account(db, key.tenant_id)
    usage.track_api_call(key.tenant_id)
    await usage.check_api_quota(db, key.tenant_id)

    space = (await db.execute(select(Space).where(Space.id == space_id))).scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=404, detail="Space not found")

    env = await resolve_environment(db, space_id, environment)
    allowed = [str(e) for e in (key.environment_ids or [])]
    if allowed and str(env.id) not in allowed:
        raise HTTPException(
            status_code=403, detail=f"Token does not grant access to environment '{env.key}'"
        )
    return ContentKeyContext(api_key=key, space=space, environment=env)
