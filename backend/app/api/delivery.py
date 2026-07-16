"""Content delivery API.

- /content/...          public, serves *published* content only.
- /preview/content/...  secret-gated, serves *draft* content for the preview app.

Both return the content type schema alongside values so the preview frontend
can render fields generically and stamp data-cms-field-id attributes.
"""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models import ContentType, Entry, EntryStatus, Space, Tenant

router = APIRouter(tags=["delivery"])
settings = get_settings()


def _serialize(entry: Entry, fields: dict[str, Any]) -> dict:
    ct = entry.content_type
    return {
        "id": str(entry.id),
        "slug": entry.slug,
        "status": entry.status,
        "version": entry.version,
        "updatedAt": entry.updated_at.isoformat() if entry.updated_at else None,
        "fields": fields or {},
        "contentType": {"apiId": ct.api_id, "name": ct.name, "fields": ct.fields},
    }


def _scoped_stmt(type_api_id: str, tenant: str | None, space: str | None):
    """Base delivery query, optionally narrowed by tenant/space slug.

    ContentType.api_id is only unique per space, so multi-tenant/multi-space
    installs MUST pass ?tenant= / ?space= (or, better for production: resolve
    the tenant from the request host or an API key and scope unconditionally).
    Without scoping, ties are broken deterministically by newest update.
    """
    stmt = (
        select(Entry)
        .join(ContentType, Entry.content_type_id == ContentType.id)
        .where(ContentType.api_id == type_api_id)
    )
    if tenant:
        stmt = stmt.join(Tenant, Entry.tenant_id == Tenant.id).where(Tenant.slug == tenant)
    if space:
        stmt = stmt.join(Space, Entry.space_id == Space.id).where(Space.slug == space)
    return stmt


async def _find_entry(
    db: AsyncSession,
    type_api_id: str,
    slug: str,
    tenant: str | None = None,
    space: str | None = None,
) -> Entry | None:
    stmt = (
        _scoped_stmt(type_api_id, tenant, space)
        .where(Entry.slug == slug)
        .order_by(Entry.updated_at.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


@router.get("/content/{type_api_id}")
async def list_published(
    type_api_id: str,
    tenant: str | None = None,
    space: str | None = None,
    limit: int = Query(default=50, le=200),
    db: AsyncSession = Depends(get_db),
):
    """List published entries of a type (for index/listing pages)."""
    stmt = (
        _scoped_stmt(type_api_id, tenant, space)
        .where(Entry.status == EntryStatus.published.value)
        .order_by(Entry.published_at.desc())
        .limit(limit)
    )
    entries = (await db.execute(stmt)).scalars().all()
    return {"items": [_serialize(e, e.published_fields or {}) for e in entries]}


@router.get("/content/{type_api_id}/{slug}")
async def get_published(
    type_api_id: str,
    slug: str,
    tenant: str | None = None,
    space: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    entry = await _find_entry(db, type_api_id, slug, tenant, space)
    if entry is None or entry.status != EntryStatus.published.value or entry.published_fields is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _serialize(entry, entry.published_fields)


@router.get("/preview/content/{type_api_id}/{slug}")
async def get_draft(
    type_api_id: str,
    slug: str,
    token: str = Query(...),
    tenant: str | None = None,
    space: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Draft content for the preview frontend. Guarded by the shared preview secret;
    swap for short-lived signed tokens (mint them in the editor session, scoped to
    one tenant + entry) for production.
    """
    if token != settings.preview_secret:
        raise HTTPException(status_code=401, detail="Invalid preview token")
    entry = await _find_entry(db, type_api_id, slug, tenant, space)
    if entry is None:
        raise HTTPException(status_code=404, detail="Not found")
    return _serialize(entry, entry.fields)
