"""Minimal media upload API backed by local disk.

Files are stored under settings.media_root and served by the StaticFiles mount
at /files (see app.main). To use S3/Azure Blob instead, replace _save/_delete
and set MediaAsset.url to the object URL.
"""
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.config import get_settings
from app.database import get_db
from app.models import MediaAsset, User

router = APIRouter(prefix="/media", tags=["media"])
settings = get_settings()


@router.post("", status_code=201)
async def upload_media(
    file: UploadFile,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    media_dir = Path(settings.media_root)
    media_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "upload.bin").suffix
    stored_name = f"{uuid.uuid4().hex}{suffix}"
    dest = media_dir / stored_name
    with dest.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    asset = MediaAsset(
        tenant_id=user.tenant_id,
        filename=file.filename or stored_name,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=dest.stat().st_size,
        url=f"/files/{stored_name}",
    )
    db.add(asset)
    await db.commit()
    await db.refresh(asset)
    return {
        "id": str(asset.id),
        "filename": asset.filename,
        "url": asset.url,
        "mimeType": asset.mime_type,
        "sizeBytes": asset.size_bytes,
    }


@router.get("")
async def list_media(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    stmt = (
        select(MediaAsset)
        .where(MediaAsset.tenant_id == user.tenant_id)
        .order_by(MediaAsset.created_at.desc())
    )
    assets = (await db.execute(stmt)).scalars().all()
    return {
        "items": [
            {"id": str(a.id), "filename": a.filename, "url": a.url, "mimeType": a.mime_type}
            for a in assets
        ]
    }


@router.delete("/{asset_id}", status_code=204)
async def delete_media(
    asset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    asset = (
        await db.execute(
            select(MediaAsset).where(MediaAsset.id == asset_id, MediaAsset.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if asset is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    stored = Path(settings.media_root) / Path(asset.url).name
    stored.unlink(missing_ok=True)
    await db.delete(asset)
    await db.commit()
