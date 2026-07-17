"""Content model API.

  GET/POST /spaces/{space_id}/environments/{environment}/content-types
  GET/PUT/DELETE /content-types/{content_type_id}   (id-addressed)

Content types are environment-scoped (cloning an environment copies the model).
The list endpoint annotates each type with its entry count for the model UI.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_actor, get_environment, require_capability, ensure_can
from app.core.events import emit
from app.core.permissions import Capability
from app.database import get_db
from app.models import ContentType, Entry, Environment
from app.schemas.content import ContentTypeCreate, ContentTypeOut, ContentTypeUpdate, FieldDef

router = APIRouter(tags=["content-types"])

_manage = require_capability(Capability.MANAGE_CONTENT_TYPES.value)
_read = require_capability(Capability.READ_CONTENT.value)


def _validate_field_defs(fields: list[FieldDef], display_field: str | None) -> None:
    ids = [f.id for f in fields]
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="Duplicate field ids in content type")
    if display_field and display_field not in ids:
        raise HTTPException(status_code=422, detail=f"display_field '{display_field}' is not a field id")
    for f in fields:
        if f.type == "select" and not (f.validations.allowed_values or []):
            raise HTTPException(
                status_code=422, detail=f"Field '{f.id}': select fields need validations.allowed_values"
            )


@router.get(
    "/spaces/{space_id}/environments/{environment}/content-types",
    response_model=list[ContentTypeOut],
)
async def list_content_types(
    space_id: uuid.UUID,
    environment: str,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_read),
):
    env = await get_environment(space_id, environment, db, actor)
    count_sq = (
        select(Entry.content_type_id, func.count(Entry.id).label("n"))
        .where(Entry.environment_id == env.id)
        .group_by(Entry.content_type_id)
        .subquery()
    )
    stmt = (
        select(ContentType, func.coalesce(count_sq.c.n, 0))
        .outerjoin(count_sq, ContentType.id == count_sq.c.content_type_id)
        .where(ContentType.environment_id == env.id)
        .order_by(ContentType.name)
    )
    rows = (await db.execute(stmt)).all()
    out = []
    for ct, n in rows:
        item = ContentTypeOut.model_validate(ct)
        item.entry_count = int(n)
        out.append(item)
    return out


@router.post(
    "/spaces/{space_id}/environments/{environment}/content-types",
    response_model=ContentTypeOut,
    status_code=201,
)
async def create_content_type(
    space_id: uuid.UUID,
    environment: str,
    payload: ContentTypeCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    env = await get_environment(space_id, environment, db, actor)
    _validate_field_defs(payload.fields, payload.display_field)

    duplicate = (
        await db.execute(
            select(ContentType).where(
                ContentType.environment_id == env.id, ContentType.api_id == payload.api_id
            )
        )
    ).scalar_one_or_none()
    if duplicate:
        raise HTTPException(
            status_code=409, detail=f"api_id '{payload.api_id}' already exists in this environment"
        )

    ct = ContentType(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        environment_id=env.id,
        name=payload.name,
        api_id=payload.api_id,
        description=payload.description,
        display_field=payload.display_field,
        fields=[f.model_dump() for f in payload.fields],
    )
    db.add(ct)
    await db.commit()
    await db.refresh(ct)
    emit(
        actor.tenant_id,
        space_id,
        "content_type.create",
        {"contentTypeId": str(ct.id), "apiId": ct.api_id, "name": ct.name},
        content_type_api_id=ct.api_id,
        environment_key=env.key,
    )
    return ct


@router.get("/content-types/{content_type_id}", response_model=ContentTypeOut)
async def get_content_type(
    content_type_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    ct = await _get_owned(db, content_type_id, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, ct.space_id)
    return ct


@router.put("/content-types/{content_type_id}", response_model=ContentTypeOut)
async def update_content_type(
    content_type_id: uuid.UUID,
    payload: ContentTypeUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    ct = await _get_owned(db, content_type_id, actor)
    ensure_can(actor, Capability.MANAGE_CONTENT_TYPES.value, ct.space_id)
    if payload.name is not None:
        ct.name = payload.name
    if payload.description is not None:
        ct.description = payload.description
    if payload.display_field is not None:
        ct.display_field = payload.display_field
    if payload.fields is not None:
        # NOTE: renaming/removing field ids does not migrate existing Entry.fields.
        # Add a data-migration step here if you need destructive schema edits to be safe.
        _validate_field_defs(payload.fields, payload.display_field or ct.display_field)
        ct.fields = [f.model_dump() for f in payload.fields]
    await db.commit()
    await db.refresh(ct)

    env = (
        await db.execute(select(Environment).where(Environment.id == ct.environment_id))
    ).scalar_one_or_none()
    emit(
        actor.tenant_id,
        ct.space_id,
        "content_type.update",
        {"contentTypeId": str(ct.id), "apiId": ct.api_id, "name": ct.name},
        content_type_api_id=ct.api_id,
        environment_key=env.key if env else None,
    )
    return ct


@router.delete("/content-types/{content_type_id}", status_code=204)
async def delete_content_type(
    content_type_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    ct = await _get_owned(db, content_type_id, actor)
    ensure_can(actor, Capability.MANAGE_CONTENT_TYPES.value, ct.space_id)
    api_id, space_id = ct.api_id, ct.space_id
    await db.delete(ct)  # cascades to entries via FK ondelete
    await db.commit()
    emit(
        actor.tenant_id,
        space_id,
        "content_type.delete",
        {"contentTypeId": str(content_type_id), "apiId": api_id},
        content_type_api_id=api_id,
    )


async def _get_owned(db: AsyncSession, content_type_id: uuid.UUID, actor: Actor) -> ContentType:
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == content_type_id, ContentType.tenant_id == actor.tenant_id
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found")
    return ct
