"""SSO endpoints (spec 002): OIDC login/callback with JIT provisioning,
domain lookup, and per-account SSO configuration.

  GET /sso/options                       which global providers are configured
  GET /sso/lookup?email=                 SSO routing/enforcement for a domain
  GET /sso/{slug}/login                  302 to IdP (slug = account slug | google | microsoft)
  GET /sso/{slug}/callback               validate -> JIT provision -> token pair via URL fragment
  GET/POST /accounts/{account_id}/sso    config CRUD (manage_settings)
  PATCH/DELETE /accounts/{account_id}/sso/{config_id}
  POST /accounts/{account_id}/sso/{config_id}/test    discovery connectivity check

SAML: configs can be stored (provider_type="saml"); the runtime endpoint
returns 501 until python3-saml (xmlsec native deps) is installed in the image.
"""
import re
import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, ensure_can, get_actor
from app.config import get_settings
from app.core.audit import record_audit
from app.core.oidc import (
    GOOGLE_DISCOVERY,
    MICROSOFT_DISCOVERY,
    OIDCError,
    OIDCProvider,
    build_authorize_url,
    exchange_code,
    fetch_discovery,
)
from app.core import oauth_github
from app.core.permissions import SYSTEM_ROLES, Capability
from app.core.security import create_state_token, decode_state_token
from app.database import get_db
from app.models import AccountMember, Role, SSOConfig, Tenant, User, UserRoleAssignment

router = APIRouter(tags=["sso"])
settings = get_settings()

GLOBAL_SLUGS = {"google", "microsoft"}


def _global_provider(slug: str) -> OIDCProvider | None:
    if slug == "google" and settings.google_client_id:
        return OIDCProvider(GOOGLE_DISCOVERY, settings.google_client_id, settings.google_client_secret)
    if slug == "microsoft" and settings.microsoft_client_id:
        return OIDCProvider(
            MICROSOFT_DISCOVERY.format(tenant=settings.microsoft_tenant),
            settings.microsoft_client_id,
            settings.microsoft_client_secret,
        )
    return None


async def _account_config(db: AsyncSession, slug: str) -> tuple[Tenant, SSOConfig]:
    account = (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
    if account is None:
        raise HTTPException(status_code=404, detail="Account not found")
    config = (
        await db.execute(
            select(SSOConfig).where(SSOConfig.tenant_id == account.id, SSOConfig.enabled.is_(True))
        )
    ).scalars().first()
    if config is None:
        raise HTTPException(status_code=404, detail="SSO is not configured for this account")
    return account, config


def _redirect_uri(slug: str) -> str:
    # Registered at the IdP; BACKEND_URL is set per environment (spec 012).
    return f"{settings.backend_url.rstrip('/')}/sso/{slug}/callback"


@router.get("/sso/options")
async def sso_options():
    """Which global social providers the login page should offer."""
    return {
        "google": bool(settings.google_client_id),
        "microsoft": bool(settings.microsoft_client_id),
        "github": bool(settings.github_client_id),
    }


@router.get("/sso/lookup")
async def sso_lookup(email: EmailStr, db: AsyncSession = Depends(get_db)):
    """Domain-based SSO routing for the login page."""
    domain = email.rsplit("@", 1)[-1].lower()
    config = (
        await db.execute(
            select(SSOConfig).where(SSOConfig.email_domain == domain, SSOConfig.enabled.is_(True))
        )
    ).scalars().first()
    if config is None:
        return {"sso_available": False, "sso_required": False}
    account = (await db.execute(select(Tenant).where(Tenant.id == config.tenant_id))).scalar_one()
    return {
        "sso_available": True,
        "sso_required": config.enforced,
        "provider_name": config.name or config.provider_type,
        "login_url": f"/sso/{account.slug}/login",
    }


# --- Social JIT provisioning (spec 012) -------------------------------------------
#
# Global social login (Google / Microsoft / GitHub) creates a personal Account
# for unknown emails — the same bootstrap as /auth/signup: tenant + system
# roles + ORG_ADMIN owner. The IdP asserts mailbox ownership, so the user is
# born verified; the password sentinel never matches bcrypt verification.


async def _unique_account_slug(db: AsyncSession, email: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", email.split("@", 1)[0].lower()).strip("-") or "workspace"
    slug = base
    while (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none():
        slug = f"{base}-{secrets.token_hex(3)}"
    return slug


async def _jit_provision_personal_account(
    db: AsyncSession, email: str, full_name: str, provider: str
) -> User:
    account = Tenant(
        name=f"{full_name or email.split('@', 1)[0]}'s Workspace",
        slug=await _unique_account_slug(db, email),
    )
    db.add(account)
    await db.flush()

    roles: dict[str, Role] = {}
    for name, preset in SYSTEM_ROLES.items():
        role = Role(
            tenant_id=account.id, name=name, description=preset["description"],
            permissions=preset["permissions"], is_system=True,
        )
        db.add(role)
        roles[name] = role
    await db.flush()

    user = User(
        tenant_id=account.id,
        email=email,
        hashed_password="!sso!",  # never matches bcrypt verification
        full_name=full_name,
        email_verified=True,
    )
    db.add(user)
    await db.flush()
    db.add(AccountMember(tenant_id=account.id, user_id=user.id, is_owner=True))
    db.add(UserRoleAssignment(user_id=user.id, role_id=roles["ORG_ADMIN"].id, space_id=None))
    record_audit(db, None, "account.signup_social", "account", account.id,
                 diff={"email": email, "provider": provider}, tenant_id=account.id)
    await db.commit()
    await db.refresh(user)
    return user


# --- GitHub (plain OAuth2 — defined before the dynamic /sso/{slug} routes) --------


@router.get("/sso/github/login")
async def github_login():
    if not settings.github_client_id:
        raise HTTPException(status_code=404, detail="GitHub sign-in is not configured")
    state = create_state_token({"slug": "github"})
    url = oauth_github.build_authorize_url(
        settings.github_client_id, _redirect_uri("github"), state
    )
    return RedirectResponse(url, status_code=302)


@router.get("/sso/github/callback")
async def github_callback(
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from app.api.auth import _issue_pair

    if not settings.github_client_id:
        raise HTTPException(status_code=404, detail="GitHub sign-in is not configured")
    if error:
        raise HTTPException(status_code=401, detail=f"GitHub returned an error: {error}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
    try:
        state_claims = decode_state_token(state)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state (retry the sign-in)")
    if state_claims.get("slug") != "github":
        raise HTTPException(status_code=400, detail="State/slug mismatch")

    try:
        identity = await oauth_github.exchange_code(
            settings.github_client_id, settings.github_client_secret,
            code, _redirect_uri("github"),
        )
    except oauth_github.GitHubOAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))

    email = identity["email"]
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = await _jit_provision_personal_account(db, email, identity["name"], "github")
    elif not user.email_verified:
        user.email_verified = True  # GitHub asserts mailbox ownership
        await db.commit()
    if not user.is_active:
        raise HTTPException(status_code=403, detail="This user is suspended")

    pair = await _issue_pair(db, user, user.tenant_id)
    fragment = f"access={pair.access_token}&refresh={pair.refresh_token}&account={pair.account_id}"
    return RedirectResponse(f"{settings.frontend_url}/login#{fragment}", status_code=302)


@router.get("/sso/{slug}/login")
async def sso_login(slug: str, db: AsyncSession = Depends(get_db)):
    if slug in GLOBAL_SLUGS:
        provider = _global_provider(slug)
        if provider is None:
            raise HTTPException(status_code=404, detail=f"{slug} sign-in is not configured")
    else:
        _, config = await _account_config(db, slug)
        if config.provider_type == "saml":
            raise HTTPException(
                status_code=501,
                detail="SAML runtime requires python3-saml (xmlsec); install it and enable the ACS endpoint. See specs/002-sso.md.",
            )
        provider = OIDCProvider(config.discovery_url, config.client_id, config.client_secret)

    state = create_state_token({"slug": slug})
    try:
        url = await build_authorize_url(provider, _redirect_uri(slug), state)
    except OIDCError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return RedirectResponse(url, status_code=302)


@router.get("/sso/{slug}/callback")
async def sso_callback(
    slug: str,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    from app.api.auth import _issue_pair

    if error:
        raise HTTPException(status_code=401, detail=f"IdP returned an error: {error}")
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
    try:
        state_claims = decode_state_token(state)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid state (retry the sign-in)")
    if state_claims.get("slug") != slug:
        raise HTTPException(status_code=400, detail="State/slug mismatch")

    account: Tenant | None = None
    config: SSOConfig | None = None
    if slug in GLOBAL_SLUGS:
        provider = _global_provider(slug)
        if provider is None:
            raise HTTPException(status_code=404, detail=f"{slug} sign-in is not configured")
    else:
        account, config = await _account_config(db, slug)
        provider = OIDCProvider(config.discovery_url, config.client_id, config.client_secret)

    try:
        claims = await exchange_code(provider, code, _redirect_uri(slug))
    except OIDCError as e:
        raise HTTPException(status_code=401, detail=str(e))

    email = (claims.get("email") or "").lower()
    if not email:
        raise HTTPException(status_code=401, detail="IdP did not return an email claim")
    if config is not None and config.email_domain:
        if email.rsplit("@", 1)[-1] != config.email_domain.lower():
            raise HTTPException(
                status_code=403, detail=f"Only @{config.email_domain} accounts may sign in here"
            )

    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()

    if user is None:
        if account is None or config is None:
            # Global social login: mint a personal account (spec 012).
            user = await _jit_provision_personal_account(
                db, email, claims.get("name", ""), slug
            )
            pair = await _issue_pair(db, user, user.tenant_id)
            fragment = f"access={pair.access_token}&refresh={pair.refresh_token}&account={pair.account_id}"
            return RedirectResponse(f"{settings.frontend_url}/login#{fragment}", status_code=302)
        # JIT provisioning into the account that owns this SSO config.
        user = User(
            tenant_id=account.id,
            email=email,
            hashed_password="!sso!",  # never matches bcrypt verification
            full_name=claims.get("name", ""),
            email_verified=True,
        )
        db.add(user)
        await db.flush()
        db.add(AccountMember(tenant_id=account.id, user_id=user.id))
        role = (
            await db.execute(
                select(Role).where(
                    Role.tenant_id == account.id, Role.name == (config.default_role_name or "EDITOR")
                )
            )
        ).scalar_one_or_none()
        if role is not None:
            db.add(UserRoleAssignment(user_id=user.id, role_id=role.id, space_id=None))
        record_audit(db, None, "sso.jit_provision", "user", user.id,
                     diff={"email": email, "provider": slug}, tenant_id=account.id)
        await db.commit()
        await db.refresh(user)

    if not user.email_verified:
        user.email_verified = True  # the IdP asserts mailbox ownership
        await db.commit()

    target_account_id = account.id if account is not None else user.tenant_id
    if account is not None:
        member = (
            await db.execute(
                select(AccountMember).where(
                    AccountMember.user_id == user.id, AccountMember.tenant_id == account.id
                )
            )
        ).scalar_one_or_none()
        if member is None:
            raise HTTPException(status_code=403, detail="Not a member of this account")

    pair = await _issue_pair(db, user, target_account_id)
    fragment = f"access={pair.access_token}&refresh={pair.refresh_token}&account={pair.account_id}"
    return RedirectResponse(f"{settings.frontend_url}/login#{fragment}", status_code=302)


# --- Configuration CRUD -----------------------------------------------------------


class SSOConfigIn(BaseModel):
    provider_type: str = Field(default="oidc", pattern="^(oidc|saml)$")
    name: str = ""
    discovery_url: str = ""
    client_id: str = ""
    client_secret: str = ""
    metadata_xml: str = ""
    email_domain: str = ""
    default_role_name: str = "EDITOR"
    enforced: bool = False
    enabled: bool = True


class SSOConfigOut(BaseModel):
    id: uuid.UUID
    provider_type: str
    name: str
    discovery_url: str
    client_id: str
    has_client_secret: bool = False
    email_domain: str
    default_role_name: str
    enforced: bool
    enabled: bool
    created_at: datetime


def _to_out(c: SSOConfig) -> SSOConfigOut:
    return SSOConfigOut(
        id=c.id, provider_type=c.provider_type, name=c.name,
        discovery_url=c.discovery_url, client_id=c.client_id,
        has_client_secret=bool(c.client_secret), email_domain=c.email_domain,
        default_role_name=c.default_role_name, enforced=c.enforced,
        enabled=c.enabled, created_at=c.created_at,
    )


def _check(actor: Actor, account_id: uuid.UUID) -> None:
    if actor.tenant_id != account_id:
        raise HTTPException(status_code=403, detail="Token is not scoped to this account")
    ensure_can(actor, Capability.MANAGE_SETTINGS.value)


@router.get("/accounts/{account_id}/sso", response_model=list[SSOConfigOut])
async def list_sso_configs(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check(actor, account_id)
    rows = (
        await db.execute(select(SSOConfig).where(SSOConfig.tenant_id == account_id))
    ).scalars().all()
    return [_to_out(c) for c in rows]


@router.post("/accounts/{account_id}/sso", response_model=SSOConfigOut, status_code=201)
async def create_sso_config(
    account_id: uuid.UUID,
    payload: SSOConfigIn,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check(actor, account_id)
    if payload.provider_type == "oidc" and not payload.discovery_url:
        raise HTTPException(status_code=422, detail="OIDC configs need a discovery_url")
    config = SSOConfig(tenant_id=account_id, **payload.model_dump())
    db.add(config)
    record_audit(db, actor, "sso.config_create", "sso_config", config.id,
                 diff={"provider": payload.provider_type, "domain": payload.email_domain})
    await db.commit()
    await db.refresh(config)
    return _to_out(config)


@router.patch("/accounts/{account_id}/sso/{config_id}", response_model=SSOConfigOut)
async def update_sso_config(
    account_id: uuid.UUID,
    config_id: uuid.UUID,
    payload: SSOConfigIn,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check(actor, account_id)
    config = await _get(db, account_id, config_id)
    data = payload.model_dump()
    if not data.get("client_secret"):
        data.pop("client_secret")  # keep the stored secret when left blank
    for key, value in data.items():
        setattr(config, key, value)
    record_audit(db, actor, "sso.config_update", "sso_config", config.id,
                 diff={"enforced": payload.enforced, "enabled": payload.enabled})
    await db.commit()
    await db.refresh(config)
    return _to_out(config)


@router.delete("/accounts/{account_id}/sso/{config_id}", status_code=204)
async def delete_sso_config(
    account_id: uuid.UUID,
    config_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check(actor, account_id)
    config = await _get(db, account_id, config_id)
    record_audit(db, actor, "sso.config_delete", "sso_config", config.id)
    await db.delete(config)
    await db.commit()


@router.post("/accounts/{account_id}/sso/{config_id}/test")
async def test_sso_config(
    account_id: uuid.UUID,
    config_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Connectivity check: fetch and validate the discovery document."""
    _check(actor, account_id)
    config = await _get(db, account_id, config_id)
    if config.provider_type != "oidc":
        raise HTTPException(status_code=501, detail="Test connection currently supports OIDC only")
    try:
        doc = await fetch_discovery(config.discovery_url)
    except OIDCError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"ok": True, "issuer": doc["issuer"], "authorization_endpoint": doc["authorization_endpoint"]}


async def _get(db: AsyncSession, account_id: uuid.UUID, config_id: uuid.UUID) -> SSOConfig:
    config = (
        await db.execute(
            select(SSOConfig).where(SSOConfig.id == config_id, SSOConfig.tenant_id == account_id)
        )
    ).scalar_one_or_none()
    if config is None:
        raise HTTPException(status_code=404, detail="SSO config not found")
    return config
