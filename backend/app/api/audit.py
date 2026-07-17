"""Audit log listing (spec 006): GET /spaces/{space_id}/audit-log

Also exposes an account-wide view at /audit-log for org admins (settings UI
shows the space-scoped one).
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, get_space, require_capability
from app.core.permissions import Capability
from app.database import get_db
from app.models import AuditLog

router = APIRouter(tags=["audit"])


class AuditLogOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID | None
    actor_id: uuid.UUID | None
    actor_label: str
    action: str
    resource_type: str
    resource_id: str
    diff: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class AuditLogList(BaseModel):
    items: list[AuditLogOut]
    total: int
    skip: int
    limit: int


async def _query(
    db: AsyncSession,
    tenant_id: uuid.UUID,
    space_id: uuid.UUID | None,
    resource_type: str | None,
    action: str | None,
    q: str | None,
    skip: int,
    limit: int,
) -> AuditLogList:
    stmt = select(AuditLog).where(AuditLog.tenant_id == tenant_id)
    if space_id is not None:
        stmt = stmt.where(AuditLog.space_id == space_id)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                AuditLog.actor_label.ilike(like),
                AuditLog.action.ilike(like),
                AuditLog.resource_id.ilike(like),
            )
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit)
    items = (await db.execute(stmt)).scalars().all()
    return AuditLogList(items=list(items), total=total, skip=skip, limit=limit)


@router.get("/spaces/{space_id}/audit-log", response_model=AuditLogList)
async def space_audit_log(
    space_id: uuid.UUID,
    resource_type: str | None = None,
    action: str | None = None,
    q: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.READ_CONTENT.value)),
):
    await get_space(space_id, db, actor)
    return await _query(db, actor.tenant_id, space_id, resource_type, action, q, skip, limit)


@router.get("/audit-log", response_model=AuditLogList)
async def account_audit_log(
    resource_type: str | None = None,
    action: str | None = None,
    q: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_USERS.value)),
):
    return await _query(db, actor.tenant_id, None, resource_type, action, q, skip, limit)
