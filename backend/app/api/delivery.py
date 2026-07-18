"""Content Delivery + Preview API (the public, API-key-authenticated plane).

  GET /spaces/{space}/environments/{env}/delivery/entries
  GET /spaces/{space}/environments/{env}/delivery/entries/{entry_id}
  GET /spaces/{space}/environments/{env}/delivery/assets
  GET /spaces/{space}/environments/{env}/delivery/assets/{asset_id}

Auth: `Authorization: Bearer <token>` or `?access_token=` with a *delivery* or
*preview* API key (see /spaces/{id}/api-keys). Behavior by key type:

  delivery -> only `published` entries; serves the frozen published_fields.
  preview  -> also drafts/in-review; serves live draft fields + entry status.

Query features:
  content_type=<api_id>   filter by type
  slug=<slug>             exact slug match
  q=<text>                naive full-text search
  locale=<code|*>         resolve localized fields ("*" returns raw locale maps)
  include=<0..3>          resolve linked entries/assets into `includes`
  limit / skip / order    pagination (order: -published_at, updated_at, slug...)

Response shape (list):
  { items: [entry], total, skip, limit,
    includes: { Entry: [entry], Asset: [asset] } }
"""
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ContentKeyContext, _load_api_key, get_content_key
from app.core import richtext
from app.core.validation import MEDIA_TYPES, REFERENCE_TYPES
from app.database import get_db
from app.models import ContentType, Entry, EntryStatus, Environment, MediaAsset, Space

router = APIRouter(tags=["delivery"])
scoped = APIRouter(
    prefix="/spaces/{space_id}/environments/{environment}/delivery", tags=["delivery"]
)

ORDERABLE = {
    "published_at": Entry.published_at,
    "updated_at": Entry.updated_at,
    "created_at": Entry.created_at,
    "slug": Entry.slug,
}
MAX_INCLUDE_DEPTH = 3
MAX_INCLUDED_ENTITIES = 200


def _resolve_locale(
    field_defs: list[dict],
    fields: dict[str, Any],
    locale: str,
    default_locale: str,
    chain: dict[str, str | None] | None = None,
) -> dict[str, Any]:
    """Collapse localized {locale: value} maps into plain values, walking the
    space's configured fallback chain (locale -> fallback -> ... -> default;
    cycle-safe). locale="*" keeps the raw maps."""
    if locale == "*":
        return fields
    out: dict[str, Any] = {}
    localized_ids = {fd["id"] for fd in field_defs if fd.get("localized")}
    for key, value in (fields or {}).items():
        if key in localized_ids and isinstance(value, dict):
            resolved = None
            code: str | None = locale
            visited: set[str] = set()
            while code and code not in visited:
                visited.add(code)
                if code in value and value[code] not in (None, ""):
                    resolved = value[code]
                    break
                code = (chain or {}).get(code)
            if resolved is None:
                resolved = value.get(default_locale)
            out[key] = resolved
        else:
            out[key] = value
    return out


def _serialize_entry(
    entry: Entry, ctx: ContentKeyContext, locale: str, chain: dict[str, str | None] | None = None
) -> dict:
    ct = entry.content_type
    source = entry.published_fields if not ctx.include_drafts else (entry.fields or {})
    data = {
        "id": str(entry.id),
        "slug": entry.slug,
        "version": entry.version,
        "createdAt": entry.created_at.isoformat() if entry.created_at else None,
        "updatedAt": entry.updated_at.isoformat() if entry.updated_at else None,
        "publishedAt": entry.published_at.isoformat() if entry.published_at else None,
        "contentType": {
            "apiId": ct.api_id,
            "name": ct.name,
            "displayField": ct.display_field,
            # Schema ships with every entry so consumers can render fields
            # generically (identify references/media/localized) without a
            # second request.
            "fields": ct.fields,
        },
        "fields": _resolve_locale(
            ct.fields or [], source or {}, locale, ctx.space.default_locale, chain
        ),
    }
    if ctx.include_drafts:
        # Only preview responses expose workflow status.
        data["status"] = entry.status
    return data


def _serialize_asset(asset: MediaAsset) -> dict:
    return {
        "id": str(asset.id),
        "url": asset.url,
        "filename": asset.filename,
        "mimeType": asset.mime_type,
        "sizeBytes": asset.size_bytes,
        "width": asset.width,
        "height": asset.height,
        "title": asset.title,
        "altText": asset.alt_text,
        "description": asset.description,
    }


def _collect_links(field_defs: list[dict], fields: dict[str, Any]) -> tuple[set[str], set[str]]:
    """Entry ids + asset ids linked from already-locale-resolved fields."""
    entry_ids: set[str] = set()
    asset_ids: set[str] = set()

    def _ids(value: Any) -> list[str]:
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            return [v for v in value if isinstance(v, str)]
        if isinstance(value, dict):  # locale="*": still a locale map
            out: list[str] = []
            for v in value.values():
                out.extend(_ids(v))
            return out
        return []

    def _add(target: set[str], candidate: str) -> None:
        try:
            uuid.UUID(candidate)
            target.add(candidate)
        except ValueError:
            pass

    for fd in field_defs:
        ftype = fd.get("type")
        raw = fields.get(fd["id"])
        if raw is None:
            continue

        if ftype == "richtext":
            # Entries/assets embedded or linked inside the doc (spec 015).
            # Value may be one doc, or a {locale: doc} map when locale="*".
            docs = [raw] if richtext.is_json_doc(raw) else (
                list(raw.values()) if isinstance(raw, dict) else []
            )
            for doc in docs:
                e_ids, a_ids = richtext.collect_ids(doc)
                for cid in e_ids:
                    _add(entry_ids, cid)
                for cid in a_ids:
                    _add(asset_ids, cid)
            continue

        if ftype not in REFERENCE_TYPES | MEDIA_TYPES:
            continue
        target = entry_ids if ftype in REFERENCE_TYPES else asset_ids
        for candidate in _ids(raw):
            _add(target, candidate)
    return entry_ids, asset_ids


def _base_stmt(ctx: ContentKeyContext):
    stmt = select(Entry).where(Entry.environment_id == ctx.environment.id)
    if not ctx.include_drafts:
        stmt = stmt.where(Entry.status == EntryStatus.published.value)
    else:
        stmt = stmt.where(Entry.status != EntryStatus.archived.value)
    return stmt


async def _resolve_includes(
    db: AsyncSession,
    ctx: ContentKeyContext,
    roots: list[dict],
    depth: int,
    locale: str,
    chain: dict[str, str | None] | None = None,
) -> dict[str, list[dict]]:
    """BFS over linked entries/assets up to `depth` levels."""
    included_entries: dict[str, dict] = {}
    included_assets: dict[str, dict] = {}
    seen_entry_ids = {r["id"] for r in roots}
    frontier = roots

    for _ in range(depth):
        want_entries: set[str] = set()
        want_assets: set[str] = set()
        for item in frontier:
            fdefs = item.get("contentType", {}).get("fields") or item.get("_field_defs") or []
            e_ids, a_ids = _collect_links(fdefs, item.get("fields") or {})
            want_entries.update(e_ids - seen_entry_ids - set(included_entries))
            want_assets.update(a_ids - set(included_assets))

        if len(included_entries) + len(included_assets) >= MAX_INCLUDED_ENTITIES:
            break

        new_items: list[dict] = []
        if want_entries:
            stmt = _base_stmt(ctx).where(
                Entry.id.in_({uuid.UUID(i) for i in want_entries})
            )
            for e in (await db.execute(stmt)).scalars().unique().all():
                data = _serialize_entry(e, ctx, locale, chain)
                # keep schema handy for the next BFS level even on delivery keys
                data["_field_defs"] = e.content_type.fields
                included_entries[data["id"]] = data
                new_items.append(data)
        if want_assets:
            stmt = select(MediaAsset).where(
                MediaAsset.id.in_({uuid.UUID(i) for i in want_assets}),
                MediaAsset.space_id == ctx.space.id,
            )
            for a in (await db.execute(stmt)).scalars().all():
                included_assets[str(a.id)] = _serialize_asset(a)

        if not new_items:
            break
        frontier = new_items

    for data in included_entries.values():
        data.pop("_field_defs", None)
    return {"Entry": list(included_entries.values()), "Asset": list(included_assets.values())}


@scoped.get("/entries")
async def list_entries(
    request: Request,
    space_id: uuid.UUID,
    environment: str,
    content_type: str | None = None,
    slug: str | None = None,
    q: str | None = None,
    locale: str | None = None,
    include: int = Query(default=1, ge=0, le=MAX_INCLUDE_DEPTH),
    order: str = "-published_at",
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: ContentKeyContext = Depends(get_content_key),
):
    stmt = _base_stmt(ctx)
    if content_type:
        stmt = stmt.join(ContentType, Entry.content_type_id == ContentType.id).where(
            ContentType.api_id == content_type
        )
    if slug:
        stmt = stmt.where(Entry.slug == slug)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Entry.slug.ilike(like), cast(Entry.fields, String).ilike(like)))

    # fields.<id>=<value> filters: exact match on plain values; localized
    # values match in any locale (JSON text containment on the quoted value).
    for param, value in request.query_params.items():
        if not param.startswith("fields.") or not value:
            continue
        fkey = param[len("fields."):]
        if not fkey.replace("_", "").isalnum():
            continue
        col = Entry.fields[fkey]
        quoted = '"' + value.replace("\\", "").replace('"', "") + '"'
        escaped = quoted.replace("%", r"\%").replace("_", r"\_")
        stmt = stmt.where(
            or_(col.astext == value, cast(col, String).ilike(f"%{escaped}%", escape="\\"))
        )

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()

    desc = order.startswith("-")
    col = ORDERABLE.get(order.lstrip("-"), Entry.published_at)
    stmt = (
        stmt.order_by(col.desc().nulls_last() if desc else col.asc())
        .offset(skip)
        .limit(limit)
    )
    entries = (await db.execute(stmt)).scalars().unique().all()

    from app.api.locales import fallback_chain_map

    chain = await fallback_chain_map(db, ctx.space.id)
    loc = locale or ctx.space.default_locale
    items = [_serialize_entry(e, ctx, loc, chain) for e in entries]
    includes: dict[str, list[dict]] = {"Entry": [], "Asset": []}
    if include > 0 and items:
        # Root items need field defs for link collection even on delivery keys.
        for item, e in zip(items, entries):
            item["_field_defs"] = e.content_type.fields
        includes = await _resolve_includes(db, ctx, items, include, loc, chain)
        for item in items:
            item.pop("_field_defs", None)

    return {"items": items, "total": total, "skip": skip, "limit": limit, "includes": includes}


@scoped.get("/entries/{entry_id}")
async def get_entry(
    space_id: uuid.UUID,
    environment: str,
    entry_id: uuid.UUID,
    locale: str | None = None,
    include: int = Query(default=1, ge=0, le=MAX_INCLUDE_DEPTH),
    db: AsyncSession = Depends(get_db),
    ctx: ContentKeyContext = Depends(get_content_key),
):
    stmt = _base_stmt(ctx).where(Entry.id == entry_id)
    entry = (await db.execute(stmt)).scalars().unique().one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")

    from app.api.locales import fallback_chain_map

    chain = await fallback_chain_map(db, ctx.space.id)
    loc = locale or ctx.space.default_locale
    item = _serialize_entry(entry, ctx, loc, chain)
    includes: dict[str, list[dict]] = {"Entry": [], "Asset": []}
    if include > 0:
        item["_field_defs"] = entry.content_type.fields
        includes = await _resolve_includes(db, ctx, [item], include, loc, chain)
        item.pop("_field_defs", None)
    return {**item, "includes": includes}


@scoped.get("/assets")
async def list_assets(
    space_id: uuid.UUID,
    environment: str,
    q: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    ctx: ContentKeyContext = Depends(get_content_key),
):
    stmt = select(MediaAsset).where(MediaAsset.space_id == space_id)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(MediaAsset.filename.ilike(like), MediaAsset.title.ilike(like)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(MediaAsset.created_at.desc()).offset(skip).limit(limit)
    assets = (await db.execute(stmt)).scalars().all()
    return {
        "items": [_serialize_asset(a) for a in assets],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@scoped.get("/assets/{asset_id}")
async def get_asset(
    space_id: uuid.UUID,
    environment: str,
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    ctx: ContentKeyContext = Depends(get_content_key),
):
    asset = (
        await db.execute(
            select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.space_id == space_id)
        )
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return _serialize_asset(asset)


@router.get("/token-info")
async def token_info(request: Request, db: AsyncSession = Depends(get_db)):
    """Resolve a delivery/preview token to its space + allowed environments.

    Lets consuming apps (e.g. the preview frontend) bootstrap from just a
    token, without hardcoding space UUIDs in their configuration.
    """
    token = request.query_params.get("access_token") or (
        request.headers.get("Authorization", "")[7:].strip()
        if request.headers.get("Authorization", "").lower().startswith("bearer ")
        else None
    )
    if not token:
        raise HTTPException(status_code=401, detail="Missing access token")
    key = await _load_api_key(db, token, {"delivery", "preview"})
    if key is None:
        raise HTTPException(status_code=401, detail="Invalid or disabled access token")

    space = (await db.execute(select(Space).where(Space.id == key.space_id))).scalar_one()
    envs_stmt = select(Environment).where(Environment.space_id == key.space_id)
    allowed = [str(e) for e in (key.environment_ids or [])]
    envs = (await db.execute(envs_stmt)).scalars().all()
    if allowed:
        envs = [e for e in envs if str(e.id) in allowed]
    default_env = next((e for e in envs if e.is_default), envs[0] if envs else None)
    return {
        "type": key.type,
        "spaceId": str(space.id),
        "spaceName": space.name,
        "defaultLocale": space.default_locale,
        "locales": space.locales,
        "environments": [{"id": str(e.id), "key": e.key, "isDefault": e.is_default} for e in envs],
        "defaultEnvironment": default_env.key if default_env else None,
    }


router.include_router(scoped)
