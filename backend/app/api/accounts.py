"""Account management: memberships + teammate invitations (spec 001).

  GET  /accounts                              accounts the current user belongs to
  GET/POST /accounts/{account_id}/invitations (manage_users)
  DELETE   /accounts/{account_id}/invitations/{invitation_id}   revoke
  GET  /invitations/{token}                   public: who invited me, to what
  POST /invitations/{token}/accept            create/link user, grant role
"""
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, ensure_can, get_actor
from app.config import get_settings
from app.core import usage
from app.core.audit import record_audit
from app.core.mailer import link_button, send_email
from app.core.permissions import Capability
from app.core.security import generate_opaque_token, hash_api_token, hash_password
from app.database import get_db
from app.models import (
    AccountMember,
    Invitation,
    InvitationStatus,
    Role,
    Space,
    Tenant,
    User,
    UserRoleAssignment,
)
from app.schemas.auth import AccountInfo, TokenPairResponse

router = APIRouter(tags=["accounts"])
settings = get_settings()

INVITE_TTL = timedelta(days=7)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class InvitationCreate(BaseModel):
    email: EmailStr
    role_id: uuid.UUID
    space_id: uuid.UUID | None = None  # scope the role to one space; None = org-wide


class InvitationOut(BaseModel):
    id: uuid.UUID
    email: str
    status: str
    role_name: str | None = None
    space_id: uuid.UUID | None = None
    expires_at: datetime
    created_at: datetime
    dev_token: str | None = None  # AUTH_DEV_MODE, on create only


class InvitationPublicInfo(BaseModel):
    account_name: str
    email: str
    role_name: str | None = None
    existing_user: bool
    status: str


class InvitationAccept(BaseModel):
    # Required when the invited email has no user yet.
    password: str | None = Field(default=None, min_length=8)
    full_name: str = ""


@router.get("/accounts", response_model=list[AccountInfo])
async def my_accounts(db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)):
    if actor.user is None:
        raise HTTPException(status_code=403, detail="A user token is required")
    rows = (
        await db.execute(
            select(AccountMember, Tenant)
            .join(Tenant, AccountMember.tenant_id == Tenant.id)
            .where(AccountMember.user_id == actor.user.id)
        )
    ).all()
    return [
        AccountInfo(id=t.id, name=t.name, slug=t.slug, is_owner=m.is_owner,
                    is_active=t.id == actor.tenant_id)
        for m, t in rows
    ]


@router.get("/accounts/{account_id}/invitations", response_model=list[InvitationOut])
async def list_invitations(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check_account(actor, account_id, Capability.MANAGE_USERS.value)
    rows = (
        await db.execute(
            select(Invitation)
            .where(Invitation.tenant_id == account_id)
            .order_by(Invitation.created_at.desc())
        )
    ).scalars().all()
    return [_to_out(i) for i in rows]


@router.post("/accounts/{account_id}/invitations", response_model=InvitationOut, status_code=201)
async def create_invitation(
    account_id: uuid.UUID,
    payload: InvitationCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check_account(actor, account_id, Capability.MANAGE_USERS.value)
    await usage.ensure_within_limit(db, account_id, "seats")

    role = (
        await db.execute(
            select(Role).where(Role.id == payload.role_id, Role.tenant_id == account_id)
        )
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found in this account")
    if payload.space_id is not None:
        space = (
            await db.execute(
                select(Space).where(Space.id == payload.space_id, Space.tenant_id == account_id)
            )
        ).scalar_one_or_none()
        if space is None:
            raise HTTPException(status_code=404, detail="Space not found")

    existing_user = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if existing_user is not None:
        member = (
            await db.execute(
                select(AccountMember).where(
                    AccountMember.user_id == existing_user.id,
                    AccountMember.tenant_id == account_id,
                )
            )
        ).scalar_one_or_none()
        if member is not None:
            raise HTTPException(status_code=409, detail="Already a member of this account")

    raw, token_hash = generate_opaque_token("inv_")
    invitation = Invitation(
        tenant_id=account_id,
        email=payload.email,
        role_id=role.id,
        space_id=payload.space_id,
        token_hash=token_hash,
        expires_at=_now() + INVITE_TTL,
        invited_by=actor.user_id,
    )
    db.add(invitation)
    record_audit(db, actor, "invitation.create", "invitation", invitation.id,
                 diff={"email": payload.email, "role": role.name}, tenant_id=account_id)
    await db.commit()
    await db.refresh(invitation)

    account = (await db.execute(select(Tenant).where(Tenant.id == account_id))).scalar_one()
    accept_url = f"{settings.frontend_url}/accept-invite/{raw}"
    await send_email(
        payload.email,
        f"You're invited to {account.name} — {settings.brand_name}",
        f"<p>You've been invited to join <strong>{account.name}</strong> as "
        f"<strong>{role.name}</strong>.</p>{link_button(accept_url, 'Accept invitation')}",
    )
    out = _to_out(invitation)
    if settings.auth_dev_mode:
        out.dev_token = raw
    return out


@router.delete("/accounts/{account_id}/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    account_id: uuid.UUID,
    invitation_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    _check_account(actor, account_id, Capability.MANAGE_USERS.value)
    invitation = (
        await db.execute(
            select(Invitation).where(
                Invitation.id == invitation_id, Invitation.tenant_id == account_id
            )
        )
    ).scalar_one_or_none()
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    invitation.status = InvitationStatus.revoked.value
    await db.commit()


# --- Public (token-addressed) ---------------------------------------------------


@router.get("/invitations/{token}", response_model=InvitationPublicInfo)
async def invitation_info(token: str, db: AsyncSession = Depends(get_db)):
    invitation = await _load_valid(db, token)
    account = (
        await db.execute(select(Tenant).where(Tenant.id == invitation.tenant_id))
    ).scalar_one()
    existing = (
        await db.execute(select(User).where(User.email == invitation.email))
    ).scalar_one_or_none()
    return InvitationPublicInfo(
        account_name=account.name,
        email=invitation.email,
        role_name=invitation.role.name if invitation.role else None,
        existing_user=existing is not None,
        status=invitation.status,
    )


@router.post("/invitations/{token}/accept", response_model=TokenPairResponse)
async def accept_invitation(
    token: str, payload: InvitationAccept, db: AsyncSession = Depends(get_db)
):
    from app.api.auth import _issue_pair  # shared token issuance

    invitation = await _load_valid(db, token)

    user = (
        await db.execute(select(User).where(User.email == invitation.email))
    ).scalar_one_or_none()
    if user is None:
        if not payload.password:
            raise HTTPException(status_code=422, detail="Set a password to create your user")
        user = User(
            tenant_id=invitation.tenant_id,  # first account becomes home account
            email=invitation.email,
            hashed_password=hash_password(payload.password),
            full_name=payload.full_name,
            email_verified=True,  # the invite email proves mailbox ownership
        )
        db.add(user)
        await db.flush()

    member = (
        await db.execute(
            select(AccountMember).where(
                AccountMember.user_id == user.id,
                AccountMember.tenant_id == invitation.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if member is None:
        db.add(AccountMember(tenant_id=invitation.tenant_id, user_id=user.id))
    if invitation.role_id is not None:
        db.add(
            UserRoleAssignment(
                user_id=user.id, role_id=invitation.role_id, space_id=invitation.space_id
            )
        )
    invitation.status = InvitationStatus.accepted.value
    record_audit(db, None, "invitation.accept", "invitation", invitation.id,
                 diff={"email": invitation.email}, tenant_id=invitation.tenant_id)
    await db.commit()
    await db.refresh(user)
    return await _issue_pair(db, user, invitation.tenant_id)


# --- helpers ---------------------------------------------------------------------


def _check_account(actor: Actor, account_id: uuid.UUID, capability: str) -> None:
    if actor.tenant_id != account_id:
        raise HTTPException(status_code=403, detail="Token is not scoped to this account")
    ensure_can(actor, capability)


def _to_out(i: Invitation) -> InvitationOut:
    return InvitationOut(
        id=i.id, email=i.email, status=i.status,
        role_name=i.role.name if i.role else None,
        space_id=i.space_id, expires_at=i.expires_at, created_at=i.created_at,
    )


async def _load_valid(db: AsyncSession, raw_token: str) -> Invitation:
    invitation = (
        await db.execute(
            select(Invitation).where(Invitation.token_hash == hash_api_token(raw_token))
        )
    ).scalar_one_or_none()
    if invitation is None or invitation.status != InvitationStatus.pending.value:
        raise HTTPException(status_code=404, detail="Invitation not found or no longer valid")
    if invitation.expires_at < _now():
        invitation.status = InvitationStatus.expired.value
        await db.commit()
        raise HTTPException(status_code=410, detail="Invitation expired")
    return invitation
