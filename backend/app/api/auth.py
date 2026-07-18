"""Authentication: signup, email verification, login (access+refresh pair),
refresh rotation, password reset, account switching. Spec: specs/001.

Every issued access JWT embeds: sub (user id), account_id (active account,
membership-validated), roles[], type=access. Refresh tokens are opaque,
stored hashed, and rotate on every use.
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, get_current_user
from app.config import get_settings
from app.core.audit import record_audit
from app.core.mailer import link_button, send_email
from app.core.permissions import SYSTEM_ROLES, user_capabilities
from app.core.security import (
    create_access_token,
    generate_opaque_token,
    hash_api_token,
    hash_password,
    verify_password,
)
from app.database import get_db
from app.models import (
    AccountMember,
    ActionToken,
    ActionTokenPurpose,
    RefreshToken,
    Role,
    SSOConfig,
    Tenant,
    User,
    UserRoleAssignment,
)
from app.schemas.auth import (
    AccountInfo,
    ForgotPasswordRequest,
    ForgotPasswordResponse,
    LoginRequest,
    RefreshRequest,
    ResetPasswordRequest,
    SignupRequest,
    SignupResponse,
    SwitchAccountRequest,
    TokenPairResponse,
    TokenResponse,
    UserOut,
    UserRoleInfo,
    VerifyEmailRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()

ACTION_TOKEN_TTL = timedelta(hours=48)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _issue_pair(db: AsyncSession, user: User, account_id: uuid.UUID) -> TokenPairResponse:
    roles = sorted(
        {a.role.name for a in user.assignments if a.role.tenant_id == account_id}
    )
    access = create_access_token(str(user.id), str(account_id), user.email, roles=roles)
    raw_refresh, token_hash = generate_opaque_token("rt_")
    db.add(
        RefreshToken(
            user_id=user.id,
            tenant_id=account_id,
            token_hash=token_hash,
            expires_at=_now() + timedelta(days=settings.refresh_token_expire_days),
        )
    )
    await db.commit()
    return TokenPairResponse(access_token=access, refresh_token=raw_refresh, account_id=account_id)


async def _create_action_token(db: AsyncSession, user: User, purpose: str) -> str:
    raw, token_hash = generate_opaque_token()
    db.add(
        ActionToken(
            user_id=user.id, purpose=purpose, token_hash=token_hash,
            expires_at=_now() + ACTION_TOKEN_TTL,
        )
    )
    return raw


async def _consume_action_token(db: AsyncSession, raw: str, purpose: str) -> User:
    token = (
        await db.execute(
            select(ActionToken).where(
                ActionToken.token_hash == hash_api_token(raw), ActionToken.purpose == purpose
            )
        )
    ).scalar_one_or_none()
    if token is None or token.used_at is not None or token.expires_at < _now():
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    token.used_at = _now()
    user = (await db.execute(select(User).where(User.id == token.user_id))).scalar_one()
    return user


async def _sso_enforced_for(db: AsyncSession, email: str) -> SSOConfig | None:
    domain = email.rsplit("@", 1)[-1].lower()
    return (
        await db.execute(
            select(SSOConfig).where(
                SSOConfig.email_domain == domain,
                SSOConfig.enforced.is_(True),
                SSOConfig.enabled.is_(True),
            )
        )
    ).scalars().first()


# --- Signup & verification -----------------------------------------------------


@router.post("/signup", response_model=SignupResponse, status_code=201)
async def signup(payload: SignupRequest, db: AsyncSession = Depends(get_db)):
    """Create an Account (tenant) + its first ORG_ADMIN user, send verification email."""
    if (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A user with this email already exists")
    if (
        await db.execute(select(Tenant).where(Tenant.slug == payload.account_slug))
    ).scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Account slug '{payload.account_slug}' is taken")

    account = Tenant(name=payload.account_name, slug=payload.account_slug)
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
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        email_verified=False,
    )
    db.add(user)
    await db.flush()
    db.add(AccountMember(tenant_id=account.id, user_id=user.id, is_owner=True))
    db.add(UserRoleAssignment(user_id=user.id, role_id=roles["ORG_ADMIN"].id, space_id=None))

    raw_token = await _create_action_token(db, user, ActionTokenPurpose.verify_email.value)
    record_audit(db, None, "account.signup", "account", account.id, tenant_id=account.id)
    await db.commit()

    verify_url = f"{settings.frontend_url}/verify-email?token={raw_token}"
    await send_email(
        user.email,
        f"Verify your email — {settings.brand_name}",
        f"<h2>Welcome to {settings.brand_name}</h2><p>Confirm your email to activate "
        f"<strong>{account.name}</strong>.</p>{link_button(verify_url, 'Verify email')}",
    )
    return SignupResponse(
        account_id=account.id,
        user_id=user.id,
        message="Account created. Check your email to verify your address.",
        dev_verification_token=raw_token if settings.auth_dev_mode else None,
    )


@router.post("/verify-email", response_model=TokenPairResponse)
async def verify_email(payload: VerifyEmailRequest, db: AsyncSession = Depends(get_db)):
    """Confirm the address and log the user straight in (token pair)."""
    user = await _consume_action_token(db, payload.token, ActionTokenPurpose.verify_email.value)
    user.email_verified = True
    await db.commit()
    return await _issue_pair(db, user, user.tenant_id)


# --- Login / refresh -------------------------------------------------------------


async def _authenticate(db: AsyncSession, email: str, password: str) -> User:
    sso = await _sso_enforced_for(db, email)
    if sso is not None:
        account = (await db.execute(select(Tenant).where(Tenant.id == sso.tenant_id))).scalar_one()
        raise HTTPException(
            status_code=428,
            detail={
                "code": "sso_required",
                "message": "Single sign-on is enforced for this email domain.",
                "login_url": f"/sso/{account.slug}/login",
            },
        )
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    if not user.email_verified:
        raise HTTPException(
            status_code=403,
            detail={"code": "email_unverified", "message": "Verify your email before signing in."},
        )
    return user


async def _resolve_account(db: AsyncSession, user: User, account_id: uuid.UUID | None) -> uuid.UUID:
    if account_id is None or account_id == user.tenant_id:
        return user.tenant_id
    member = (
        await db.execute(
            select(AccountMember).where(
                AccountMember.user_id == user.id, AccountMember.tenant_id == account_id
            )
        )
    ).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=403, detail="Not a member of this account")
    return account_id


@router.post("/login", response_model=TokenPairResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)):
    """JSON login used by the editor frontend. Returns access + refresh tokens."""
    user = await _authenticate(db, payload.email, payload.password)
    account_id = await _resolve_account(db, user, payload.account_id)
    return await _issue_pair(db, user, account_id)


@router.post("/token", response_model=TokenResponse)
async def login_form(
    form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)
):
    """OAuth2 form login so the Swagger UI 'Authorize' button works."""
    user = await _authenticate(db, form.username, form.password)
    roles = sorted({a.role.name for a in user.assignments if a.role.tenant_id == user.tenant_id})
    return TokenResponse(
        access_token=create_access_token(str(user.id), str(user.tenant_id), user.email, roles=roles)
    )


@router.post("/refresh", response_model=TokenPairResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Rotate a refresh token: the presented token is revoked, a new pair issued."""
    row = (
        await db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_api_token(payload.refresh_token))
        )
    ).scalar_one_or_none()
    if row is None or row.revoked_at is not None or row.expires_at < _now():
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
    row.revoked_at = _now()
    user = (await db.execute(select(User).where(User.id == row.user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="User is disabled")
    return await _issue_pair(db, user, row.tenant_id)


@router.post("/switch-account", response_model=TokenPairResponse)
async def switch_account(
    payload: SwitchAccountRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Issue a token pair scoped to another account the user belongs to."""
    account_id = await _resolve_account(db, user, payload.account_id)
    return await _issue_pair(db, user, account_id)


# --- Password reset ----------------------------------------------------------------


@router.post("/forgot-password", response_model=ForgotPasswordResponse)
async def forgot_password(payload: ForgotPasswordRequest, db: AsyncSession = Depends(get_db)):
    """Always answers 200 — never leaks whether the email exists."""
    user = (await db.execute(select(User).where(User.email == payload.email))).scalar_one_or_none()
    dev_token: str | None = None
    if user is not None and user.is_active:
        raw = await _create_action_token(db, user, ActionTokenPurpose.reset_password.value)
        await db.commit()
        reset_url = f"{settings.frontend_url}/reset-password?token={raw}"
        await send_email(
            user.email,
            f"Reset your password — {settings.brand_name}",
            f"<p>Someone requested a password reset for this address.</p>"
            f"{link_button(reset_url, 'Reset password')}"
            f"<p style='font-family:sans-serif;color:#667085;font-size:13px'>"
            f"Ignore this email if it wasn't you.</p>",
        )
        dev_token = raw if settings.auth_dev_mode else None
    return ForgotPasswordResponse(
        message="If that address exists, a reset link is on its way.",
        dev_reset_token=dev_token,
    )


@router.post("/reset-password", response_model=TokenPairResponse)
async def reset_password(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db)):
    user = await _consume_action_token(db, payload.token, ActionTokenPurpose.reset_password.value)
    user.hashed_password = hash_password(payload.password)
    user.email_verified = True  # proving mailbox ownership verifies the address
    record_audit(db, None, "user.password_reset", "user", user.id, tenant_id=user.tenant_id)
    await db.commit()
    return await _issue_pair(db, user, user.tenant_id)


# --- Profile ---------------------------------------------------------------------


@router.get("/me", response_model=UserOut)
async def me(db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)):
    """Profile + roles/capabilities for the ACTIVE account (from the token claim)."""
    if actor.user is None:
        raise HTTPException(status_code=403, detail="A user token is required")
    user = actor.user
    memberships = (
        await db.execute(
            select(AccountMember, Tenant)
            .join(Tenant, AccountMember.tenant_id == Tenant.id)
            .where(AccountMember.user_id == user.id)
        )
    ).all()
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        tenant_id=actor.tenant_id,
        roles=[
            UserRoleInfo(role_name=a.role.name, space_id=a.space_id)
            for a in user.assignments
            if a.role.tenant_id == actor.tenant_id
        ],
        capabilities=sorted(user_capabilities(user, account_id=actor.tenant_id)),
        accounts=[
            AccountInfo(
                id=t.id, name=t.name, slug=t.slug,
                is_owner=m.is_owner, is_active=t.id == actor.tenant_id,
            )
            for m, t in memberships
        ],
    )
