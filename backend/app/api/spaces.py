"""Spaces & environments management API.

  GET    /spaces                                      list spaces (+environments)
  POST   /spaces                                      create space (with master env)
  PATCH  /spaces/{space_id}                           rename / locales
  DELETE /spaces/{space_id}
  GET    /spaces/{space_id}/environments
  POST   /spaces/{space_id}/environments              create (optionally clone)
  POST   /spaces/{space_id}/environments/{environment}/make-default
  DELETE /spaces/{space_id}/environments/{environment}

Environment cloning copies the content model and (optionally) all entries.
Entry ids change on clone; reference field values are remapped to the new ids.
Media assets are NOT duplicated — they are space-scoped and shared across
environments (asset lookups in the delivery API resolve by space).
"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, get_space, require_capability, resolve_environment
from app.core.events import emit
from app.core.permissions import Capability, accessible_space_ids
from app.database import get_db
from app.models import ContentType, Entry, Environment, Space
from app.schemas.content import (
    EnvironmentCloneStats,
    EnvironmentCreate,
    EnvironmentOut,
    SpaceCreate,
    SpaceOut,
    SpaceUpdate,
)

router = APIRouter(prefix="/spaces", tags=["spaces"])


@router.get("", response_model=list[SpaceOut])
async def list_spaces(db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)):
    stmt = select(Space).where(Space.tenant_id == actor.tenant_id).order_by(Space.name)
    if actor.user is not None:
        allowed = accessible_space_ids(actor.user)
        if allowed is not None:
            stmt = stmt.where(Space.id.in_(allowed)) if allowed else stmt.where(False)
    elif actor.api_key is not None:
        stmt = stmt.where(Space.id == actor.api_key.space_id)
    return (await db.execute(stmt)).scalars().unique().all()


@router.post("", response_model=SpaceOut, status_code=201)
async def create_space(
    payload: SpaceCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_SPACES.value)),
):
    from app.core import usage
    from app.core.audit import record_audit
    from app.models import Locale

    await usage.ensure_within_limit(db, actor.tenant_id, "spaces")
    duplicate = (
        await db.execute(
            select(Space).where(Space.tenant_id == actor.tenant_id, Space.slug == payload.slug)
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Space slug '{payload.slug}' already exists")

    space = Space(
        tenant_id=actor.tenant_id,
        name=payload.name,
        slug=payload.slug,
        locales=[loc.model_dump() for loc in payload.locales],
        default_locale=payload.default_locale,
    )
    db.add(space)
    await db.flush()
    db.add(
        Environment(
            tenant_id=actor.tenant_id,
            space_id=space.id,
            key="master",
            name="Master",
            type="master",
            is_default=True,
        )
    )
    # First-class Locale rows (source of truth; spaces.locales stays as cache).
    for i, loc in enumerate(payload.locales):
        db.add(
            Locale(
                tenant_id=actor.tenant_id,
                space_id=space.id,
                code=loc.code,
                name=loc.name or loc.code,
                is_default=loc.code == payload.default_locale,
                position=i,
            )
        )
    record_audit(db, actor, "space.create", "space", space.id, diff={"name": payload.name})
    await db.commit()
    return (
        await db.execute(select(Space).where(Space.id == space.id))
    ).scalar_one()


@router.patch("/{space_id}", response_model=SpaceOut)
async def update_space(
    space_id: uuid.UUID,
    payload: SpaceUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_SETTINGS.value)),
):
    space = await get_space(space_id, db, actor)
    if payload.name is not None:
        space.name = payload.name
    if payload.locales is not None:
        codes = [loc.code for loc in payload.locales]
        if len(set(codes)) != len(codes):
            raise HTTPException(status_code=422, detail="Duplicate locale codes")
        space.locales = [loc.model_dump() for loc in payload.locales]
    if payload.default_locale is not None:
        space.default_locale = payload.default_locale
    if space.default_locale not in [loc["code"] for loc in space.locales]:
        raise HTTPException(status_code=422, detail="default_locale must be one of the space locales")
    await db.commit()
    await db.refresh(space)
    return space


@router.delete("/{space_id}", status_code=204)
async def delete_space(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_SPACES.value)),
):
    space = await get_space(space_id, db, actor)
    await db.delete(space)
    await db.commit()


# --- Environments -------------------------------------------------------------


@router.get("/{space_id}/environments", response_model=list[EnvironmentOut])
async def list_environments(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    stmt = (
        select(Environment)
        .where(Environment.space_id == space_id)
        .order_by(Environment.is_default.desc(), Environment.created_at)
    )
    return (await db.execute(stmt)).scalars().all()


class EnvironmentCreatedOut(EnvironmentOut):
    cloned: EnvironmentCloneStats = EnvironmentCloneStats()


@router.post("/{space_id}/environments", response_model=EnvironmentCreatedOut, status_code=201)
async def create_environment(
    space_id: uuid.UUID,
    payload: EnvironmentCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_ENVIRONMENTS.value)),
):
    space = await get_space(space_id, db, actor)
    duplicate = (
        await db.execute(
            select(Environment).where(
                Environment.space_id == space_id, Environment.key == payload.key
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Environment '{payload.key}' already exists")

    env = Environment(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        key=payload.key,
        name=payload.name,
        type=payload.type,
        is_default=False,
    )
    db.add(env)
    await db.flush()

    stats = EnvironmentCloneStats()
    if payload.clone_from_environment_id is not None:
        source = (
            await db.execute(
                select(Environment).where(
                    Environment.id == payload.clone_from_environment_id,
                    Environment.space_id == space_id,
                )
            )
        ).scalar_one_or_none()
        if source is None:
            raise HTTPException(status_code=404, detail="Source environment not found")
        stats = await _clone_environment(
            db, source, env, payload.clone_content_types, payload.clone_entries
        )

    await db.commit()
    await db.refresh(env)
    emit(
        actor.tenant_id,
        space_id,
        "environment.create",
        {"environmentId": str(env.id), "key": env.key, "clonedFrom": str(payload.clone_from_environment_id or "")},
        environment_key=env.key,
    )
    out = EnvironmentCreatedOut.model_validate(env)
    out.cloned = stats
    return out


@router.post("/{space_id}/environments/{environment}/make-default", response_model=EnvironmentOut)
async def make_default_environment(
    space_id: uuid.UUID,
    environment: str,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_ENVIRONMENTS.value)),
):
    await get_space(space_id, db, actor)
    env = await resolve_environment(db, space_id, environment)
    all_envs = (
        (await db.execute(select(Environment).where(Environment.space_id == space_id))).scalars().all()
    )
    for e in all_envs:
        e.is_default = e.id == env.id
    await db.commit()
    await db.refresh(env)
    return env


@router.delete("/{space_id}/environments/{environment}", status_code=204)
async def delete_environment(
    space_id: uuid.UUID,
    environment: str,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_ENVIRONMENTS.value)),
):
    await get_space(space_id, db, actor)
    env = await resolve_environment(db, space_id, environment)
    if env.is_default:
        raise HTTPException(status_code=422, detail="Cannot delete the default environment")
    await db.delete(env)  # cascades to content types + entries
    await db.commit()


async def _clone_environment(
    db: AsyncSession,
    source: Environment,
    target: Environment,
    clone_content_types: bool,
    clone_entries: bool,
) -> EnvironmentCloneStats:
    """Deep-copy content types (and optionally entries) between environments.

    Reference field values store entry ids, which change on clone — so we
    remap them (including inside localized {locale: value} dicts and
    reference_many arrays) once all new entries exist.
    """
    stats = EnvironmentCloneStats()
    if not clone_content_types:
        return stats

    source_cts = (
        (
            await db.execute(
                select(ContentType).where(ContentType.environment_id == source.id)
            )
        )
        .scalars()
        .all()
    )
    ct_id_map: dict[uuid.UUID, ContentType] = {}
    for ct in source_cts:
        clone = ContentType(
            tenant_id=ct.tenant_id,
            space_id=ct.space_id,
            environment_id=target.id,
            name=ct.name,
            api_id=ct.api_id,
            description=ct.description,
            display_field=ct.display_field,
            fields=list(ct.fields or []),
        )
        db.add(clone)
        ct_id_map[ct.id] = clone
    await db.flush()
    stats.content_types = len(ct_id_map)

    if not clone_entries:
        return stats

    source_entries = (
        (await db.execute(select(Entry).where(Entry.environment_id == source.id))).scalars().all()
    )
    entry_id_map: dict[str, str] = {}
    clones: list[tuple[Entry, Entry]] = []
    for e in source_entries:
        if e.content_type_id not in ct_id_map:
            continue
        clone = Entry(
            tenant_id=e.tenant_id,
            space_id=e.space_id,
            environment_id=target.id,
            content_type_id=ct_id_map[e.content_type_id].id,
            slug=e.slug,
            status=e.status,
            fields=dict(e.fields or {}),
            published_fields=dict(e.published_fields) if e.published_fields else None,
            version=1,
            created_by=e.created_by,
            published_at=e.published_at,
        )
        db.add(clone)
        clones.append((e, clone))
    await db.flush()
    for original, clone in clones:
        entry_id_map[str(original.id)] = str(clone.id)

    # Remap reference values now that every clone has its new id.
    for original, clone in clones:
        field_defs = ct_id_map[original.content_type_id].fields or []
        clone.fields = _remap_references(clone.fields, field_defs, entry_id_map)
        if clone.published_fields:
            clone.published_fields = _remap_references(
                clone.published_fields, field_defs, entry_id_map
            )
    stats.entries = len(clones)
    return stats


def _remap_references(
    fields: dict[str, Any], field_defs: list[dict], id_map: dict[str, str]
) -> dict[str, Any]:
    def remap_value(value: Any) -> Any:
        if isinstance(value, str):
            return id_map.get(value, value)
        if isinstance(value, list):
            return [id_map.get(v, v) if isinstance(v, str) else v for v in value]
        return value

    out = dict(fields)
    for fd in field_defs:
        if fd.get("type") not in ("reference", "reference_many"):
            continue
        fid = fd["id"]
        if fid not in out or out[fid] is None:
            continue
        value = out[fid]
        # Localized fields wrap the value in a {locale: value} dict.
        if fd.get("localized") and isinstance(value, dict):
            out[fid] = {loc: remap_value(v) for loc, v in value.items()}
        else:
            out[fid] = remap_value(value)
    return out
