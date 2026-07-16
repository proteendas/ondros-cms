"""Entry CRUD + publishing workflow.

Every mutation broadcasts a WebSocket event to /ws/entries/{id} subscribers so
the live preview (and other editor tabs) update immediately.

Workflow: draft -> in_review -> published -> archived, with sensible back-edges.
Publishing freezes Entry.fields into Entry.published_fields; the public
delivery API only ever reads published_fields.
"""
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.ws_manager import manager
from app.database import get_db
from app.models import ContentType, Entry, EntryStatus, User
from app.schemas.content import EntryCreate, EntryOut, EntryUpdate, TransitionRequest

router = APIRouter(prefix="/entries", tags=["entries"])

ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"in_review", "published", "archived"},
    "in_review": {"draft", "published", "archived"},
    "published": {"draft", "archived"},  # "draft" here = unpublish
    "archived": {"draft"},
}


def validate_fields(field_defs: list[dict], values: dict[str, Any]) -> list[str]:
    """Validate entry values against the content type schema.

    Drafts are allowed to be invalid (so editors can save partial work);
    this is enforced only on publish. Extend with type coercion, regex,
    reference existence checks, etc.
    """
    errors: list[str] = []
    for fd in field_defs:
        fid = fd["id"]
        v = fd.get("validations") or {}
        value = values.get(fid)
        is_empty = value is None or (isinstance(value, str) and not value.strip())
        if v.get("required") and is_empty:
            errors.append(f"Field '{fid}' is required")
            continue
        if is_empty:
            continue
        if isinstance(value, str):
            if v.get("min_length") and len(value) < v["min_length"]:
                errors.append(f"Field '{fid}' must be at least {v['min_length']} characters")
            if v.get("max_length") and len(value) > v["max_length"]:
                errors.append(f"Field '{fid}' must be at most {v['max_length']} characters")
            if v.get("pattern") and not re.search(v["pattern"], value):
                errors.append(f"Field '{fid}' does not match pattern {v['pattern']}")
            if v.get("allowed_values") and value not in v["allowed_values"]:
                errors.append(f"Field '{fid}' must be one of {v['allowed_values']}")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            if v.get("min") is not None and value < v["min"]:
                errors.append(f"Field '{fid}' must be >= {v['min']}")
            if v.get("max") is not None and value > v["max"]:
                errors.append(f"Field '{fid}' must be <= {v['max']}")
    return errors


@router.get("", response_model=list[EntryOut])
async def list_entries(
    content_type_id: uuid.UUID | None = None,
    space_id: uuid.UUID | None = None,
    status: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(Entry).where(Entry.tenant_id == user.tenant_id)
    if content_type_id:
        stmt = stmt.where(Entry.content_type_id == content_type_id)
    if space_id:
        stmt = stmt.where(Entry.space_id == space_id)
    if status:
        stmt = stmt.where(Entry.status == status)
    return (await db.execute(stmt.order_by(Entry.updated_at.desc()))).scalars().all()


@router.post("", response_model=EntryOut, status_code=201)
async def create_entry(
    payload: EntryCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == payload.content_type_id,
                ContentType.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found")

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
        tenant_id=user.tenant_id,
        space_id=payload.space_id,
        content_type_id=payload.content_type_id,
        slug=payload.slug,
        fields=payload.fields,
        created_by=user.id,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    return entry


@router.get("/{entry_id}", response_model=EntryOut)
async def get_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return await _get_owned(db, entry_id, user)


@router.patch("/{entry_id}", response_model=EntryOut)
async def update_entry(
    entry_id: uuid.UUID,
    payload: EntryUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await _get_owned(db, entry_id, user)
    if payload.slug is not None:
        entry.slug = payload.slug
    if payload.fields is not None:
        # Merge semantics: only the provided keys change. Send {"fields": {"title": ...}}
        # from inline editing without clobbering other fields.
        entry.fields = {**(entry.fields or {}), **payload.fields}
    entry.version += 1
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
    return entry


@router.post("/{entry_id}/transition", response_model=EntryOut)
async def transition_entry(
    entry_id: uuid.UUID,
    payload: TransitionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await _get_owned(db, entry_id, user)
    target = payload.status

    if target not in ALLOWED_TRANSITIONS.get(entry.status, set()):
        raise HTTPException(
            status_code=422, detail=f"Cannot transition from '{entry.status}' to '{target}'"
        )

    if target == EntryStatus.published.value:
        errors = validate_fields(entry.content_type.fields, entry.fields or {})
        if errors:
            raise HTTPException(status_code=422, detail={"message": "Validation failed", "errors": errors})
        entry.published_fields = dict(entry.fields or {})
        entry.published_at = datetime.now(timezone.utc)
    elif entry.status == EntryStatus.published.value:
        # Leaving published state = unpublish.
        entry.published_fields = None
        entry.published_at = None

    entry.status = target
    entry.version += 1
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
    return entry


@router.delete("/{entry_id}", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    entry = await _get_owned(db, entry_id, user)
    await db.delete(entry)
    await db.commit()


async def _get_owned(db: AsyncSession, entry_id: uuid.UUID, user: User) -> Entry:
    entry = (
        await db.execute(
            select(Entry).where(Entry.id == entry_id, Entry.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry
