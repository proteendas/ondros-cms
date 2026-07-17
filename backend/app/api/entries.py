"""Entry CRUD + publishing workflow.

  GET/POST  /spaces/{space_id}/environments/{environment}/entries       list/create
  POST      /spaces/{space_id}/environments/{environment}/entries/bulk  bulk actions
  GET/PATCH/DELETE /entries/{entry_id}                                  id-addressed
  POST      /entries/{entry_id}/publish|/unpublish|/archive|/transition

List supports filtering by content type (api_id or uuid), status, full-text
search over field values, updated_since, ordering and pagination.

Every mutation broadcasts a WebSocket event to /ws/entries/{id} subscribers
(live preview) and emits webhook events (app.core.events).

Publishing validates the schema (localized-aware) AND reference integrity:
referenced entries must exist in the same environment and match the field's
allowed_content_types; referenced media must exist in the same space.
"""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, ensure_can, get_actor, get_environment, require_capability
from app.core import usage
from app.core.audit import field_diff, record_audit, snapshot_entry
from app.core.events import emit
from app.core.permissions import Capability
from app.core.validation import collect_linked_ids, validate_entry_fields
from app.core.ws_manager import manager
from app.database import get_db
from app.models import ContentType, Entry, EntryStatus, EntryVersion, Environment, MediaAsset, Space
from app.schemas.content import (
    BulkActionRequest,
    BulkActionResult,
    EntryCreate,
    EntryListOut,
    EntryOut,
    EntryUpdate,
    TransitionRequest,
)

router = APIRouter(tags=["entries"])

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"in_review", "published", "archived"},
    "in_review": {"draft", "published", "archived"},
    "published": {"draft", "archived"},  # "draft" here = unpublish
    "archived": {"draft"},
}

ORDERABLE = {
    "updated_at": Entry.updated_at,
    "created_at": Entry.created_at,
    "published_at": Entry.published_at,
    "slug": Entry.slug,
    "status": Entry.status,
}


async def validate_references(db: AsyncSession, entry: Entry, field_defs: list[dict]) -> list[str]:
    """Reference integrity: linked entries exist in the same environment and
    match allowed_content_types; linked media exist in the same space."""
    errors: list[str] = []
    entry_ids_by_field, media_ids = collect_linked_ids(field_defs, entry.fields or {})

    all_entry_ids = {uuid.UUID(i) for ids in entry_ids_by_field.values() for i in ids}
    if all_entry_ids:
        rows = (
            await db.execute(
                select(Entry.id, ContentType.api_id)
                .join(ContentType, Entry.content_type_id == ContentType.id)
                .where(Entry.id.in_(all_entry_ids), Entry.environment_id == entry.environment_id)
            )
        ).all()
        found = {str(rid): api_id for rid, api_id in rows}
        defs_by_id = {fd["id"]: fd for fd in field_defs}
        for fid, ids in entry_ids_by_field.items():
            allowed = defs_by_id[fid].get("allowed_content_types") or []
            for ref_id in ids:
                if ref_id == str(entry.id):
                    errors.append(f"Field '{fid}': an entry cannot reference itself")
                elif ref_id not in found:
                    errors.append(f"Field '{fid}': referenced entry {ref_id} not found in this environment")
                elif allowed and found[ref_id] not in allowed:
                    errors.append(
                        f"Field '{fid}': entry {ref_id} has type '{found[ref_id]}', "
                        f"allowed: {allowed}"
                    )

    if media_ids:
        found_media = (
            await db.execute(
                select(MediaAsset.id).where(
                    MediaAsset.id.in_({uuid.UUID(m) for m in media_ids}),
                    MediaAsset.space_id == entry.space_id,
                )
            )
        ).scalars().all()
        missing = media_ids - {str(m) for m in found_media}
        for m in sorted(missing):
            errors.append(f"Referenced media asset {m} not found in this space")

    return errors


@router.get(
    "/spaces/{space_id}/environments/{environment}/entries", response_model=EntryListOut
)
async def list_entries(
    space_id: uuid.UUID,
    environment: str,
    content_type: str | None = Query(default=None, description="Content type api_id or uuid"),
    status: str | None = None,
    q: str | None = Query(default=None, description="Full-text search over slug + field values"),
    updated_since: datetime | None = None,
    order: str = Query(default="-updated_at", description="e.g. -updated_at, slug, -published_at"),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.READ_CONTENT.value)),
):
    env = await get_environment(space_id, environment, db, actor)
    stmt = select(Entry).where(Entry.environment_id == env.id)

    if content_type:
        try:
            stmt = stmt.where(Entry.content_type_id == uuid.UUID(content_type))
        except ValueError:
            stmt = stmt.join(ContentType, Entry.content_type_id == ContentType.id).where(
                ContentType.api_id == content_type
            )
    if status:
        stmt = stmt.where(Entry.status == status)
    if updated_since:
        stmt = stmt.where(Entry.updated_at >= updated_since)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(Entry.slug.ilike(like), cast(Entry.fields, String).ilike(like))
        )

    total = (
        await db.execute(select(func.count()).select_from(stmt.subquery()))
    ).scalar_one()

    desc = order.startswith("-")
    col = ORDERABLE.get(order.lstrip("-"), Entry.updated_at)
    stmt = stmt.order_by(col.desc() if desc else col.asc()).offset(skip).limit(limit)
    items = (await db.execute(stmt)).scalars().unique().all()
    return EntryListOut(items=items, total=total, skip=skip, limit=limit)


@router.post(
    "/spaces/{space_id}/environments/{environment}/entries",
    response_model=EntryOut,
    status_code=201,
)
async def create_entry(
    space_id: uuid.UUID,
    environment: str,
    payload: EntryCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_ENTRIES.value)),
):
    env = await get_environment(space_id, environment, db, actor)
    await usage.ensure_within_limit(db, actor.tenant_id, "entries")
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == payload.content_type_id,
                ContentType.environment_id == env.id,
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found in this environment")

    duplicate = (
        await db.execute(
            select(Entry).where(
                Entry.content_type_id == payload.content_type_id, Entry.slug == payload.slug
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"Slug '{payload.slug}' already exists for this type")

    entry = Entry(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        environment_id=env.id,
        content_type_id=payload.content_type_id,
        slug=payload.slug,
        fields=payload.fields,
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(entry)
    await db.flush()
    record_audit(db, actor, "entry.create", "entry", entry.id,
                 diff={"slug": payload.slug, "contentType": ct.api_id}, space_id=space_id)
    await db.commit()
    await db.refresh(entry)
    emit(
        actor.tenant_id,
        space_id,
        "entry.create",
        {"entryId": str(entry.id), "slug": entry.slug, "contentTypeId": str(ct.id)},
        content_type_api_id=ct.api_id,
        environment_key=env.key,
    )
    return entry


@router.post(
    "/spaces/{space_id}/environments/{environment}/entries/bulk",
    response_model=BulkActionResult,
)
async def bulk_action(
    space_id: uuid.UUID,
    environment: str,
    payload: BulkActionRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Bulk publish/unpublish/archive/delete. Per-entry permission + validation
    failures are reported in `failed` without aborting the rest."""
    env = await get_environment(space_id, environment, db, actor)
    needed = (
        Capability.MANAGE_ENTRIES.value
        if payload.action == "delete"
        else Capability.PUBLISH_ENTRIES.value
    )
    ensure_can(actor, needed, space_id)

    target_status = {"publish": "published", "unpublish": "draft", "archive": "archived"}.get(
        payload.action
    )
    result = BulkActionResult()
    for entry_id in payload.entry_ids:
        entry = (
            await db.execute(
                select(Entry).where(Entry.id == entry_id, Entry.environment_id == env.id)
            )
        ).scalar_one_or_none()
        if entry is None:
            result.failed[str(entry_id)] = "Not found in this environment"
            continue
        try:
            if payload.action == "delete":
                await _delete_entry_row(db, actor, entry, env)
            else:
                await _transition(db, actor, entry, target_status, env)
            result.succeeded.append(entry_id)
        except HTTPException as e:
            detail = e.detail if isinstance(e.detail, str) else str(e.detail)
            result.failed[str(entry_id)] = detail
    return result


@router.get("/entries/{entry_id}", response_model=EntryOut)
async def get_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, entry.space_id)
    return entry


@router.patch("/entries/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: uuid.UUID,
    payload: EntryUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    ensure_can(actor, Capability.MANAGE_ENTRIES.value, entry.space_id)
    # Snapshot the pre-change state so this version can be diffed/restored.
    await snapshot_entry(db, entry, actor)
    old_fields = dict(entry.fields or {})
    if payload.slug is not None:
        entry.slug = payload.slug
    if payload.fields is not None:
        # Merge semantics: only the provided keys change. Send {"fields": {"title": ...}}
        # from inline editing without clobbering other fields.
        entry.fields = {**(entry.fields or {}), **payload.fields}
    entry.version += 1
    entry.updated_by = actor.user_id
    record_audit(db, actor, "entry.update", "entry", entry.id,
                 diff=field_diff(old_fields, entry.fields), space_id=entry.space_id)
    await db.commit()
    await db.refresh(entry)

    await manager.broadcast(
        str(entry.id),
        {
            "type": "entry.updated",
            "entryId": str(entry.id),
            "version": entry.version,
            "status": entry.status,
            "fields": entry.fields,
            "changed": list((payload.fields or {}).keys()),
        },
    )
    env = (
        await db.execute(select(Environment).where(Environment.id == entry.environment_id))
    ).scalar_one_or_none()
    emit(
        actor.tenant_id,
        entry.space_id,
        "entry.update",
        {"entryId": str(entry.id), "slug": entry.slug, "version": entry.version},
        content_type_api_id=entry.content_type.api_id,
        environment_key=env.key if env else None,
    )
    return entry


@router.post("/entries/{entry_id}/publish", response_model=EntryOut)
async def publish_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    return await _transition_endpoint(db, actor, entry, "published")


@router.post("/entries/{entry_id}/unpublish", response_model=EntryOut)
async def unpublish_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    return await _transition_endpoint(db, actor, entry, "draft")


@router.post("/entries/{entry_id}/archive", response_model=EntryOut)
async def archive_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    return await _transition_endpoint(db, actor, entry, "archived")


@router.post("/entries/{entry_id}/transition", response_model=EntryOut)
async def transition_entry(
    entry_id: uuid.UUID,
    payload: TransitionRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    return await _transition_endpoint(db, actor, entry, payload.status)


@router.delete("/entries/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    env = (
        await db.execute(select(Environment).where(Environment.id == entry.environment_id))
    ).scalar_one_or_none()
    await _delete_entry_row(db, actor, entry, env)


# --- Version history (spec 006) ------------------------------------------------


from pydantic import BaseModel as _BaseModel  # local, avoids clash with schemas


class EntryVersionMeta(_BaseModel):
    version: int
    slug: str
    status: str
    created_by: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class EntryVersionOut(EntryVersionMeta):
    fields: dict

    model_config = {"from_attributes": True}


@router.get("/entries/{entry_id}/versions", response_model=list[EntryVersionMeta])
async def list_entry_versions(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, entry.space_id)
    stmt = (
        select(EntryVersion)
        .where(EntryVersion.entry_id == entry.id)
        .order_by(EntryVersion.version.desc())
    )
    return (await db.execute(stmt)).scalars().all()


@router.get("/entries/{entry_id}/versions/{version}", response_model=EntryVersionOut)
async def get_entry_version(
    entry_id: uuid.UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    entry = await _get_owned(db, entry_id, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, entry.space_id)
    row = (
        await db.execute(
            select(EntryVersion).where(
                EntryVersion.entry_id == entry.id, EntryVersion.version == version
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return row


@router.post("/entries/{entry_id}/versions/{version}/restore", response_model=EntryOut)
async def restore_entry_version(
    entry_id: uuid.UUID,
    version: int,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Copy a snapshot's fields (+slug) back into the draft as a NEW version."""
    entry = await _get_owned(db, entry_id, actor)
    ensure_can(actor, Capability.MANAGE_ENTRIES.value, entry.space_id)
    snapshot = (
        await db.execute(
            select(EntryVersion).where(
                EntryVersion.entry_id == entry.id, EntryVersion.version == version
            )
        )
    ).scalar_one_or_none()
    if snapshot is None:
        raise HTTPException(status_code=404, detail="Version not found")

    await snapshot_entry(db, entry, actor)  # preserve the current state first
    old_fields = dict(entry.fields or {})
    entry.fields = dict(snapshot.fields or {})
    if snapshot.slug:
        entry.slug = snapshot.slug
    entry.version += 1
    entry.updated_by = actor.user_id
    record_audit(db, actor, "entry.restore_version", "entry", entry.id,
                 diff={"restored_version": version, **field_diff(old_fields, entry.fields)},
                 space_id=entry.space_id)
    await db.commit()
    await db.refresh(entry)

    await manager.broadcast(
        str(entry.id),
        {
            "type": "entry.updated",
            "entryId": str(entry.id),
            "version": entry.version,
            "status": entry.status,
            "fields": entry.fields,
            "changed": list((entry.fields or {}).keys()),
        },
    )
    return entry


# --- internals ----------------------------------------------------------------


async def _transition_endpoint(db: AsyncSession, actor: Actor, entry: Entry, target: str) -> Entry:
    env = (
        await db.execute(select(Environment).where(Environment.id == entry.environment_id))
    ).scalar_one_or_none()
    return await _transition(db, actor, entry, target, env)


async def _transition(
    db: AsyncSession, actor: Actor, entry: Entry, target: str, env: Environment | None
) -> Entry:
    ensure_can(actor, Capability.PUBLISH_ENTRIES.value, entry.space_id)
    if target == entry.status:
        return entry
    if target not in ALLOWED_TRANSITIONS.get(entry.status, set()):
        raise HTTPException(
            status_code=422, detail=f"Cannot transition from '{entry.status}' to '{target}'"
        )

    await snapshot_entry(db, entry, actor)
    was_published = entry.status == EntryStatus.published.value
    if target == EntryStatus.published.value:
        space = (
            await db.execute(select(Space).where(Space.id == entry.space_id))
        ).scalar_one()
        locale_codes = [loc["code"] for loc in (space.locales or [])] or [space.default_locale]
        errors = validate_entry_fields(
            entry.content_type.fields, entry.fields or {}, space.default_locale, locale_codes
        )
        errors += await validate_references(db, entry, entry.content_type.fields)
        if errors:
            raise HTTPException(status_code=422, detail={"message": "Validation failed", "errors": errors})
        entry.published_fields = dict(entry.fields or {})
        entry.published_at = datetime.now(timezone.utc)
    elif was_published:
        # Leaving published state = unpublish.
        entry.published_fields = None
        entry.published_at = None

    entry.status = target
    entry.version += 1
    entry.updated_by = actor.user_id
    record_audit(db, actor, f"entry.{target if target != 'draft' else 'unpublish'}",
                 "entry", entry.id, diff={"status": target}, space_id=entry.space_id)
    await db.commit()
    await db.refresh(entry)

    await manager.broadcast(
        str(entry.id),
        {
            "type": "entry.transitioned",
            "entryId": str(entry.id),
            "status": entry.status,
            "version": entry.version,
        },
    )
    event = {
        "published": "entry.publish",
        "archived": "entry.archive",
    }.get(target, "entry.unpublish" if was_published else "entry.update")
    emit(
        actor.tenant_id,
        entry.space_id,
        event,
        {"entryId": str(entry.id), "slug": entry.slug, "status": entry.status, "version": entry.version},
        content_type_api_id=entry.content_type.api_id,
        environment_key=env.key if env else None,
    )
    return entry


async def _delete_entry_row(db: AsyncSession, actor: Actor, entry: Entry, env: Environment | None) -> None:
    ensure_can(actor, Capability.MANAGE_ENTRIES.value, entry.space_id)
    payload = {"entryId": str(entry.id), "slug": entry.slug}
    api_id = entry.content_type.api_id
    space_id = entry.space_id
    record_audit(db, actor, "entry.delete", "entry", entry.id,
                 diff={"slug": entry.slug}, space_id=space_id)
    await db.delete(entry)
    await db.commit()
    emit(
        actor.tenant_id,
        space_id,
        "entry.delete",
        payload,
        content_type_api_id=api_id,
        environment_key=env.key if env else None,
    )


async def _get_owned(db: AsyncSession, entry_id: uuid.UUID, actor: Actor) -> Entry:
    entry = (
        await db.execute(
            select(Entry).where(Entry.id == entry_id, Entry.tenant_id == actor.tenant_id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry
