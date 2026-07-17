"""Media asset API backed by local disk.

  POST   /spaces/{space_id}/environments/{environment}/media   upload (multipart)
  GET    /spaces/{space_id}/media                              list + filters
  GET    /media/{asset_id}                                     detail
  PATCH  /media/{asset_id}                                     edit metadata
  DELETE /media/{asset_id}
  GET    /media/{asset_id}/variant?w=&h=&fmt=                  resized image variant

Files live under settings.media_root and are served by the StaticFiles mount
at /files (see app.main). To use S3/Azure Blob instead, replace the save /
delete / variant helpers and store the object URL in MediaAsset.url.

Image uploads get width/height extracted server-side (Pillow). Variants are
resized on demand and cached to disk next to the original.
"""
import io
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, ensure_can, get_actor, get_environment, require_capability
from app.core.events import emit
from app.core.permissions import Capability
from app.database import get_db
from app.models import MediaAsset
from app.schemas.settings import MediaAssetOut, MediaAssetUpdate, MediaListOut

router = APIRouter(tags=["media"])

IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
VARIANT_FORMATS = {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP"}


def _settings():
    from app.config import get_settings

    return get_settings()


def _image_dimensions(data: bytes) -> tuple[int | None, int | None]:
    try:
        from PIL import Image

        with Image.open(io.BytesIO(data)) as img:
            return img.width, img.height
    except Exception:  # not an image Pillow can read / Pillow missing
        return None, None


@router.post(
    "/spaces/{space_id}/environments/{environment}/media",
    response_model=MediaAssetOut,
    status_code=201,
)
async def upload_media(
    space_id: uuid.UUID,
    environment: str,
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.MANAGE_MEDIA.value)),
):
    env = await get_environment(space_id, environment, db, actor)
    settings = _settings()
    media_dir = Path(settings.media_root)
    media_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "upload.bin").suffix.lower()
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    dest = media_dir / stored_name

    data = await file.read()
    from app.core import usage
    from app.core.audit import record_audit

    await usage.ensure_within_limit(db, actor.tenant_id, "storage_bytes", adding=len(data))
    dest.write_bytes(data)

    mime = file.content_type or "application/octet-stream"
    width, height = _image_dimensions(data) if mime in IMAGE_TYPES else (None, None)

    asset = MediaAsset(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        environment_id=env.id,
        filename=file.filename or stored_name,
        mime_type=mime,
        size_bytes=len(data),
        url=f"/files/{stored_name}",
        width=width,
        height=height,
        title=Path(file.filename or stored_name).stem,
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(asset)
    await db.flush()
    record_audit(db, actor, "asset.create", "asset", asset.id,
                 diff={"filename": asset.filename, "sizeBytes": len(data)}, space_id=space_id)
    await db.commit()
    await db.refresh(asset)
    emit(
        actor.tenant_id,
        space_id,
        "asset.create",
        {"assetId": str(asset.id), "filename": asset.filename, "url": asset.url},
        environment_key=env.key,
    )
    return asset


@router.get("/spaces/{space_id}/media", response_model=MediaListOut)
async def list_media(
    space_id: uuid.UUID,
    q: str | None = Query(default=None, description="Search filename/title/alt text"),
    kind: str | None = Query(default=None, pattern="^(image|video|file)$"),
    tag: str | None = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(require_capability(Capability.READ_CONTENT.value)),
):
    stmt = select(MediaAsset).where(
        MediaAsset.tenant_id == actor.tenant_id, MediaAsset.space_id == space_id
    )
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                MediaAsset.filename.ilike(like),
                MediaAsset.title.ilike(like),
                MediaAsset.alt_text.ilike(like),
                MediaAsset.description.ilike(like),
            )
        )
    if kind == "image":
        stmt = stmt.where(MediaAsset.mime_type.like("image/%"))
    elif kind == "video":
        stmt = stmt.where(MediaAsset.mime_type.like("video/%"))
    elif kind == "file":
        stmt = stmt.where(
            ~MediaAsset.mime_type.like("image/%"), ~MediaAsset.mime_type.like("video/%")
        )
    if tag:
        stmt = stmt.where(cast(MediaAsset.tags, String).ilike(f'%"{tag}"%'))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    stmt = stmt.order_by(MediaAsset.created_at.desc()).offset(skip).limit(limit)
    items = (await db.execute(stmt)).scalars().all()
    return MediaListOut(items=items, total=total, skip=skip, limit=limit)


@router.get("/media/{asset_id}", response_model=MediaAssetOut)
async def get_media(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    asset = await _get_owned(db, asset_id, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, asset.space_id)
    return asset


@router.patch("/media/{asset_id}", response_model=MediaAssetOut)
async def update_media(
    asset_id: uuid.UUID,
    payload: MediaAssetUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    asset = await _get_owned(db, asset_id, actor)
    ensure_can(actor, Capability.MANAGE_MEDIA.value, asset.space_id)
    for attr in ("title", "description", "alt_text", "tags"):
        value = getattr(payload, attr)
        if value is not None:
            setattr(asset, attr, value)
    asset.updated_by = actor.user_id
    await db.commit()
    await db.refresh(asset)
    if asset.space_id:
        emit(
            actor.tenant_id,
            asset.space_id,
            "asset.update",
            {"assetId": str(asset.id), "filename": asset.filename},
        )
    return asset


@router.delete("/media/{asset_id}", status_code=204)
async def delete_media(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    asset = await _get_owned(db, asset_id, actor)
    ensure_can(actor, Capability.MANAGE_MEDIA.value, asset.space_id)
    media_root = Path(_settings().media_root)
    stored = media_root / Path(asset.url).name
    stored.unlink(missing_ok=True)
    for variant in media_root.glob(f"{stored.stem}__*"):  # cached variants
        variant.unlink(missing_ok=True)
    payload = {"assetId": str(asset.id), "filename": asset.filename}
    space_id = asset.space_id
    await db.delete(asset)
    await db.commit()
    if space_id:
        emit(actor.tenant_id, space_id, "asset.delete", payload)


@router.get("/media/{asset_id}/variant")
async def image_variant(
    asset_id: uuid.UUID,
    w: int | None = Query(default=None, ge=16, le=4000),
    h: int | None = Query(default=None, ge=16, le=4000),
    fmt: str = Query(default="webp", pattern="^(jpeg|png|webp)$"),
    db: AsyncSession = Depends(get_db),
):
    """Resized image variant, cached on disk. Public (no auth) like /files —
    it only serves what the static mount already exposes, in different sizes."""
    asset = (
        await db.execute(select(MediaAsset).where(MediaAsset.id == asset_id))
    ).scalar_one_or_none()
    if asset is None or not asset.mime_type.startswith("image/"):
        raise HTTPException(status_code=404, detail="Image not found")

    try:
        from PIL import Image
    except ImportError:
        raise HTTPException(status_code=501, detail="Image variants require Pillow")

    media_root = Path(_settings().media_root)
    original = media_root / Path(asset.url).name
    if not original.exists():
        raise HTTPException(status_code=404, detail="File missing on disk")

    cache_name = f"{original.stem}__{w or 'auto'}x{h or 'auto'}.{fmt}"
    cached = media_root / cache_name
    if not cached.exists():
        with Image.open(original) as img:
            img = img.convert("RGBA" if fmt == "png" else "RGB")
            target_w = w or (img.width * (h or img.height) // img.height)
            target_h = h or (img.height * (w or img.width) // img.width)
            img.thumbnail((target_w, target_h))
            img.save(cached, VARIANT_FORMATS[fmt], quality=85)
    return FileResponse(cached, media_type=f"image/{fmt}")


async def _get_owned(db: AsyncSession, asset_id: uuid.UUID, actor: Actor) -> MediaAsset:
    asset = (
        await db.execute(
            select(MediaAsset).where(
                MediaAsset.id == asset_id, MediaAsset.tenant_id == actor.tenant_id
            )
        )
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return asset
