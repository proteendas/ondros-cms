"""Per-space locale management (spec 003).

Locale rows are the source of truth; `spaces.locales` + `spaces.default_locale`
are a denormalized cache rebuilt here after every mutation (existing read
paths — validation, editor tabs, delivery default — keep working unchanged).

  GET    /spaces/{space_id}/locales
  POST   /spaces/{space_id}/locales                     (manage_settings)
  PATCH  /spaces/{space_id}/locales/{locale_id}
  POST   /spaces/{space_id}/locales/{locale_id}/make-default
  DELETE /spaces/{space_id}/locales/{locale_id}
"""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, get_space, require_capability
from app.core.audit import record_audit
from app.core.permissions import Capability
from app.database import get_db
from app.models import Locale, Space

router = APIRouter(prefix="/spaces/{space_id}/locales", tags=["locales"])

_manage = require_capability(Capability.MANAGE_SETTINGS.value)

CODE_PATTERN = r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$"


class LocaleCreate(BaseModel):
    code: str = Field(pattern=CODE_PATTERN, max_length=20)
    name: str = ""
    fallback_code: str | None = None


class LocaleUpdate(BaseModel):
    name: str | None = None
    is_active: bool | None = None
    fallback_code: str | None = None  # "" clears the fallback
    position: int | None = None


class LocaleOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    is_default: bool
    is_active: bool
    position: int
    fallback_code: str | None = None
    created_at: datetime


async def get_space_locales(db: AsyncSession, space_id: uuid.UUID) -> list[Locale]:
    return list(
        (
            await db.execute(
                select(Locale)
                .where(Locale.space_id == space_id)
                .order_by(Locale.is_default.desc(), Locale.position, Locale.code)
            )
        ).scalars().all()
    )


async def sync_space_locale_cache(db: AsyncSession, space: Space) -> None:
    """Rebuild the denormalized spaces.locales / default_locale cache."""
    rows = await get_space_locales(db, space.id)
    space.locales = [{"code": l.code, "name": l.name or l.code} for l in rows if l.is_active]
    default = next((l for l in rows if l.is_default), rows[0] if rows else None)
    if default is not None:
        space.default_locale = default.code


async def fallback_chain_map(db: AsyncSession, space_id: uuid.UUID) -> dict[str, str | None]:
    """{code: fallback_code} for the delivery API's chain walk."""
    rows = await get_space_locales(db, space_id)
    by_id = {l.id: l.code for l in rows}
    return {l.code: by_id.get(l.fallback_locale_id) for l in rows if l.is_active}


def _to_out(l: Locale, by_id: dict[uuid.UUID, str]) -> LocaleOut:
    return LocaleOut(
        id=l.id, code=l.code, name=l.name, is_default=l.is_default,
        is_active=l.is_active, position=l.position,
        fallback_code=by_id.get(l.fallback_locale_id) if l.fallback_locale_id else None,
        created_at=l.created_at,
    )


async def _resolve_fallback(
    db: AsyncSession, space_id: uuid.UUID, code: str | None, self_code: str | None = None
) -> uuid.UUID | None:
    if not code:
        return None
    if code == self_code:
        raise HTTPException(status_code=422, detail="A locale cannot fall back to itself")
    row = (
        await db.execute(select(Locale).where(Locale.space_id == space_id, Locale.code == code))
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=422, detail=f"Fallback locale '{code}' does not exist")
    return row.id


@router.get("", response_model=list[LocaleOut])
async def list_locales(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    rows = await get_space_locales(db, space_id)
    by_id = {l.id: l.code for l in rows}
    return [_to_out(l, by_id) for l in rows]


@router.post("", response_model=LocaleOut, status_code=201)
async def create_locale(
    space_id: uuid.UUID,
    payload: LocaleCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    space = await get_space(space_id, db, actor)
    duplicate = (
        await db.execute(
            select(Locale).where(Locale.space_id == space_id, Locale.code == payload.code)
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Locale '{payload.code}' already exists")

    rows = await get_space_locales(db, space_id)
    locale = Locale(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        code=payload.code,
        name=payload.name or payload.code,
        is_default=len(rows) == 0,
        position=len(rows),
        fallback_locale_id=await _resolve_fallback(db, space_id, payload.fallback_code, payload.code),
    )
    db.add(locale)
    await sync_space_locale_cache(db, space)
    record_audit(db, actor, "locale.create", "locale", locale.id,
                 diff={"code": payload.code}, space_id=space_id)
    await db.commit()
    await db.refresh(locale)
    rows = await get_space_locales(db, space_id)
    return _to_out(locale, {l.id: l.code for l in rows})


@router.patch("/{locale_id}", response_model=LocaleOut)
async def update_locale(
    space_id: uuid.UUID,
    locale_id: uuid.UUID,
    payload: LocaleUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    space = await get_space(space_id, db, actor)
    locale = await _get(db, space_id, locale_id)
    if payload.name is not None:
        locale.name = payload.name
    if payload.is_active is not None:
        if locale.is_default and not payload.is_active:
            raise HTTPException(status_code=422, detail="The default locale cannot be deactivated")
        locale.is_active = payload.is_active
    if payload.position is not None:
        locale.position = payload.position
    if payload.fallback_code is not None:
        locale.fallback_locale_id = await _resolve_fallback(
            db, space_id, payload.fallback_code or None, locale.code
        )
    await sync_space_locale_cache(db, space)
    await db.commit()
    await db.refresh(locale)
    rows = await get_space_locales(db, space_id)
    return _to_out(locale, {l.id: l.code for l in rows})


@router.post("/{locale_id}/make-default", response_model=LocaleOut)
async def make_default(
    space_id: uuid.UUID,
    locale_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    space = await get_space(space_id, db, actor)
    target = await _get(db, space_id, locale_id)
    for l in await get_space_locales(db, space_id):
        l.is_default = l.id == target.id
    target.is_active = True
    await sync_space_locale_cache(db, space)
    record_audit(db, actor, "locale.make_default", "locale", target.id,
                 diff={"code": target.code}, space_id=space_id)
    await db.commit()
    await db.refresh(target)
    rows = await get_space_locales(db, space_id)
    return _to_out(target, {l.id: l.code for l in rows})


@router.delete("/{locale_id}", status_code=204)
async def delete_locale(
    space_id: uuid.UUID,
    locale_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    """Entry values stored under the removed code remain in the JSON (ignored);
    re-adding the locale later brings them back."""
    space = await get_space(space_id, db, actor)
    locale = await _get(db, space_id, locale_id)
    if locale.is_default:
        raise HTTPException(status_code=422, detail="Cannot delete the default locale")
    record_audit(db, actor, "locale.delete", "locale", locale.id,
                 diff={"code": locale.code}, space_id=space_id)
    await db.delete(locale)
    await db.flush()
    await sync_space_locale_cache(db, space)
    await db.commit()


async def _get(db: AsyncSession, space_id: uuid.UUID, locale_id: uuid.UUID) -> Locale:
    locale = (
        await db.execute(
            select(Locale).where(Locale.id == locale_id, Locale.space_id == space_id)
        )
    ).scalar_one_or_none()
    if locale is None:
        raise HTTPException(status_code=404, detail="Locale not found")
    return locale
