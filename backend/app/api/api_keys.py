"""API key management: /spaces/{space_id}/api-keys

The full token is returned exactly once (on create / regenerate); afterwards
only ``token_prefix`` is visible. Keys are space-scoped; delivery/preview keys
can additionally be restricted to specific environments.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_space, require_capability
from app.core.permissions import Capability
from app.core.security import generate_api_token
from app.database import get_db
from app.models import ApiKey, Environment
from app.schemas.settings import ApiKeyCreate, ApiKeyCreatedOut, ApiKeyOut, ApiKeyUpdate

router = APIRouter(prefix="/spaces/{space_id}/api-keys", tags=["api-keys"])

_manage_keys = require_capability(Capability.MANAGE_API_KEYS.value)


async def _validate_environments(
    db: AsyncSession, space_id: uuid.UUID, environment_ids: list[uuid.UUID]
) -> None:
    if not environment_ids:
        return
    found = (
        await db.execute(
            select(Environment.id).where(
                Environment.space_id == space_id, Environment.id.in_(environment_ids)
            )
        )
    ).scalars().all()
    missing = set(environment_ids) - set(found)
    if missing:
        raise HTTPException(
            status_code=422, detail=f"Environments not in this space: {[str(m) for m in missing]}"
        )


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(
    space_id: uuid.UUID,
    type: str | None = Query(default=None, pattern="^(delivery|preview|management)$"),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_keys),
):
    await get_space(space_id, db, actor)
    stmt = select(ApiKey).where(ApiKey.space_id == space_id).order_by(ApiKey.created_at.desc())
    if type:
        stmt = stmt.where(ApiKey.type == type)
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=ApiKeyCreatedOut, status_code=201)
async def create_api_key(
    space_id: uuid.UUID,
    payload: ApiKeyCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_keys),
):
    await get_space(space_id, db, actor)
    await _validate_environments(db, space_id, payload.environment_ids)

    token, prefix, token_hash = generate_api_token(payload.type)
    key = ApiKey(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        name=payload.name,
        description=payload.description,
        type=payload.type,
        token_prefix=prefix,
        token_hash=token_hash,
        environment_ids=[str(e) for e in payload.environment_ids],
        read_only=payload.type != "management",
        created_by=actor.user_id,
    )
    db.add(key)
    await db.commit()
    await db.refresh(key)
    out = ApiKeyCreatedOut.model_validate(key)
    out.access_token = token
    return out


@router.patch("/{key_id}", response_model=ApiKeyOut)
async def update_api_key(
    space_id: uuid.UUID,
    key_id: uuid.UUID,
    payload: ApiKeyUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_keys),
):
    key = await _get_key(db, space_id, key_id, actor)
    if payload.name is not None:
        key.name = payload.name
    if payload.description is not None:
        key.description = payload.description
    if payload.environment_ids is not None:
        await _validate_environments(db, space_id, payload.environment_ids)
        key.environment_ids = [str(e) for e in payload.environment_ids]
    if payload.enabled is not None:
        key.enabled = payload.enabled
    await db.commit()
    await db.refresh(key)
    return key


@router.post("/{key_id}/regenerate", response_model=ApiKeyCreatedOut)
async def regenerate_api_key(
    space_id: uuid.UUID,
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_keys),
):
    """Invalidate the current token and mint a new one (returned once)."""
    key = await _get_key(db, space_id, key_id, actor)
    token, prefix, token_hash = generate_api_token(key.type)
    key.token_prefix = prefix
    key.token_hash = token_hash
    await db.commit()
    await db.refresh(key)
    out = ApiKeyCreatedOut.model_validate(key)
    out.access_token = token
    return out


@router.delete("/{key_id}", status_code=204)
async def delete_api_key(
    space_id: uuid.UUID,
    key_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage_keys),
):
    key = await _get_key(db, space_id, key_id, actor)
    await db.delete(key)
    await db.commit()


async def _get_key(db: AsyncSession, space_id: uuid.UUID, key_id: uuid.UUID, actor: Actor) -> ApiKey:
    await get_space(space_id, db, actor)
    key = (
        await db.execute(select(ApiKey).where(ApiKey.id == key_id, ApiKey.space_id == space_id))
    ).scalar_one_or_none()
    if key is None:
        raise HTTPException(status_code=404, detail="API key not found")
    return key
