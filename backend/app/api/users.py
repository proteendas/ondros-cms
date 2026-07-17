"""User, role and role-assignment management (org-level administration).

  GET/POST   /users                      list / invite users
  PATCH      /users/{user_id}            activate/deactivate, rename
  GET/POST   /roles                      list / create roles
  PATCH/DELETE /roles/{role_id}          edit / delete custom roles
  POST/DELETE /role-assignments[/{id}]   grant / revoke a role (org- or space-scoped)
  GET        /permissions/catalog        capability strings for the roles UI
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, ensure_can
from app.core.permissions import Capability, SYSTEM_ROLES
from app.core.security import hash_password
from app.database import get_db
from app.models import Role, Space, User, UserRoleAssignment
from app.schemas.settings import (
    RoleAssignmentCreate,
    RoleAssignmentOut,
    RoleCreate,
    RoleOut,
    RoleUpdate,
    UserCreate,
    UserSummaryOut,
)

router = APIRouter(tags=["users-roles"])


def _manage_users(actor: Actor = Depends(get_actor)) -> Actor:
    ensure_can(actor, Capability.MANAGE_USERS.value)
    return actor


@router.get("/permissions/catalog")
async def permissions_catalog():
    return {
        "capabilities": [c.value for c in Capability],
        "system_roles": {name: preset["permissions"] for name, preset in SYSTEM_ROLES.items()},
    }


# --- Users --------------------------------------------------------------------


@router.get("/users", response_model=list[UserSummaryOut])
async def list_users(db: AsyncSession = Depends(get_db), actor: Actor = Depends(_manage_users)):
    stmt = select(User).where(User.tenant_id == actor.tenant_id).order_by(User.email)
    return (await db.execute(stmt)).scalars().unique().all()


@router.post("/users", response_model=UserSummaryOut, status_code=201)
async def create_user(
    payload: UserCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    duplicate = (
        await db.execute(select(User).where(User.email == payload.email))
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail="A user with this email already exists")

    user = User(
        tenant_id=actor.tenant_id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
    )
    db.add(user)
    await db.flush()
    if payload.role_id is not None:
        role = await _get_role(db, payload.role_id, actor)
        db.add(
            UserRoleAssignment(user_id=user.id, role_id=role.id, space_id=payload.space_id)
        )
    await db.commit()
    return (
        await db.execute(select(User).where(User.id == user.id))
    ).scalar_one()


class UserUpdate(BaseModel):
    full_name: str | None = None
    is_active: bool | None = None
    password: str | None = None


@router.patch("/users/{user_id}", response_model=UserSummaryOut)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    user = (
        await db.execute(
            select(User).where(User.id == user_id, User.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.hashed_password = hash_password(payload.password)
    await db.commit()
    await db.refresh(user)
    return user


# --- Roles --------------------------------------------------------------------


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)):
    stmt = select(Role).where(Role.tenant_id == actor.tenant_id).order_by(Role.name)
    return (await db.execute(stmt)).scalars().all()


@router.post("/roles", response_model=RoleOut, status_code=201)
async def create_role(
    payload: RoleCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    _validate_permissions(payload.permissions)
    role = Role(
        tenant_id=actor.tenant_id,
        name=payload.name,
        description=payload.description,
        permissions=payload.permissions,
        is_system=False,
    )
    db.add(role)
    await db.commit()
    await db.refresh(role)
    return role


@router.patch("/roles/{role_id}", response_model=RoleOut)
async def update_role(
    role_id: uuid.UUID,
    payload: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    role = await _get_role(db, role_id, actor)
    if role.is_system:
        raise HTTPException(status_code=422, detail="System roles cannot be edited")
    if payload.name is not None:
        role.name = payload.name
    if payload.description is not None:
        role.description = payload.description
    if payload.permissions is not None:
        _validate_permissions(payload.permissions)
        role.permissions = payload.permissions
    await db.commit()
    await db.refresh(role)
    return role


@router.delete("/roles/{role_id}", status_code=204)
async def delete_role(
    role_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    role = await _get_role(db, role_id, actor)
    if role.is_system:
        raise HTTPException(status_code=422, detail="System roles cannot be deleted")
    await db.delete(role)
    await db.commit()


# --- Assignments ----------------------------------------------------------------


@router.post("/role-assignments", response_model=RoleAssignmentOut, status_code=201)
async def assign_role(
    payload: RoleAssignmentCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    role = await _get_role(db, payload.role_id, actor)
    user = (
        await db.execute(
            select(User).where(User.id == payload.user_id, User.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if payload.space_id is not None:
        space = (
            await db.execute(
                select(Space).where(
                    Space.id == payload.space_id, Space.tenant_id == actor.tenant_id
                )
            )
        ).scalar_one_or_none()
        if space is None:
            raise HTTPException(status_code=404, detail="Space not found")

    duplicate = (
        await db.execute(
            select(UserRoleAssignment).where(
                UserRoleAssignment.user_id == payload.user_id,
                UserRoleAssignment.role_id == payload.role_id,
                UserRoleAssignment.space_id == payload.space_id,
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        return duplicate

    assignment = UserRoleAssignment(
        user_id=payload.user_id, role_id=role.id, space_id=payload.space_id
    )
    db.add(assignment)
    await db.commit()
    return (
        await db.execute(
            select(UserRoleAssignment).where(UserRoleAssignment.id == assignment.id)
        )
    ).scalar_one()


@router.delete("/role-assignments/{assignment_id}", status_code=204)
async def revoke_role(
    assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_users),
):
    assignment = (
        await db.execute(
            select(UserRoleAssignment)
            .join(User, UserRoleAssignment.user_id == User.id)
            .where(UserRoleAssignment.id == assignment_id, User.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()


def _validate_permissions(permissions: list[str]) -> None:
    valid = {c.value for c in Capability} | {"*"}
    unknown = [p for p in permissions if p not in valid]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown permissions: {unknown}")


async def _get_role(db: AsyncSession, role_id: uuid.UUID, actor: Actor) -> Role:
    role = (
        await db.execute(
            select(Role).where(Role.id == role_id, Role.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if role is None:
        raise HTTPException(status_code=404, detail="Role not found")
    return role
