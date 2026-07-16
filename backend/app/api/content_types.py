import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models import ContentType, Space, User
from app.schemas.content import ContentTypeCreate, ContentTypeOut, ContentTypeUpdate, SpaceOut

router = APIRouter(prefix="/content-types", tags=["content-types"])


@router.get("", response_model=list[ContentTypeOut])
async def list_content_types(
    space_id: uuid.UUID | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    stmt = select(ContentType).where(ContentType.tenant_id == user.tenant_id)
    if space_id:
        stmt = stmt.where(ContentType.space_id == space_id)
    return (await db.execute(stmt.order_by(ContentType.name))).scalars().all()


@router.post("", response_model=ContentTypeOut, status_code=201)
async def create_content_type(
    payload: ContentTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    space = (
        await db.execute(
            select(Space).where(Space.id == payload.space_id, Space.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if space is None:
        raise HTTPException(status_code=404, detail="Space not found")

    duplicate = (
        await db.execute(
            select(ContentType).where(
                ContentType.space_id == payload.space_id, ContentType.api_id == payload.api_id
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail=f"api_id '{payload.api_id}' already exists in this space")

    ct = ContentType(
        tenant_id=user.tenant_id,
        space_id=payload.space_id,
        name=payload.name,
        api_id=payload.api_id,
        description=payload.description,
        fields=[f.model_dump() for f in payload.fields],
    )
    db.add(ct)
    await db.commit()
    await db.refresh(ct)
    return ct


@router.get("/{content_type_id}", response_model=ContentTypeOut)
async def get_content_type(
    content_type_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ct = await _get_owned(db, content_type_id, user)
    return ct


@router.put("/{content_type_id}", response_model=ContentTypeOut)
async def update_content_type(
    content_type_id: uuid.UUID,
    payload: ContentTypeUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ct = await _get_owned(db, content_type_id, user)
    if payload.name is not None:
        ct.name = payload.name
    if payload.description is not None:
        ct.description = payload.description
    if payload.fields is not None:
        # NOTE: renaming/removing field ids does not migrate existing Entry.fields.
        # Add a data-migration step here if you need destructive schema edits to be safe.
        ct.fields = [f.model_dump() for f in payload.fields]
    await db.commit()
    await db.refresh(ct)
    return ct


@router.delete("/{content_type_id}", status_code=204)
async def delete_content_type(
    content_type_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    ct = await _get_owned(db, content_type_id, user)
    await db.delete(ct)  # cascades to entries via FK ondelete
    await db.commit()


@router.get("/spaces/all", response_model=list[SpaceOut])
async def list_spaces(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Convenience endpoint for editor dropdowns."""
    stmt = select(Space).where(Space.tenant_id == user.tenant_id).order_by(Space.name)
    return (await db.execute(stmt)).scalars().all()


async def _get_owned(db: AsyncSession, content_type_id: uuid.UUID, user: User) -> ContentType:
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == content_type_id, ContentType.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found")
    return ct
