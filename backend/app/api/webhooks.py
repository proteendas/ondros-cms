"""Webhook management: /spaces/{space_id}/webhooks (+ recent delivery log)."""
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, get_space, require_capability
from app.core.events import EVENT_TYPES
from app.core.permissions import Capability
from app.database import get_db
from app.models import Webhook, WebhookDelivery
from app.schemas.settings import WebhookCreate, WebhookDeliveryOut, WebhookOut, WebhookUpdate

router = APIRouter(prefix="/spaces/{space_id}/webhooks", tags=["webhooks"])

_manage = require_capability(Capability.MANAGE_WEBHOOKS.value)


@router.get("/event-types")
async def list_event_types():
    """All event types a webhook can subscribe to (for the settings UI)."""
    return {"events": EVENT_TYPES}


@router.get("", response_model=list[WebhookOut])
async def list_webhooks(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    await get_space(space_id, db, actor)
    stmt = select(Webhook).where(Webhook.space_id == space_id).order_by(Webhook.created_at.desc())
    return (await db.execute(stmt)).scalars().all()


@router.post("", response_model=WebhookOut, status_code=201)
async def create_webhook(
    space_id: uuid.UUID,
    payload: WebhookCreate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    await get_space(space_id, db, actor)
    _validate_events(payload.events)
    hook = Webhook(
        tenant_id=actor.tenant_id,
        space_id=space_id,
        name=payload.name,
        url=payload.url,
        secret=payload.secret,
        enabled=payload.enabled,
        events=payload.events,
        filters=payload.filters.model_dump(),
        headers=payload.headers,
    )
    db.add(hook)
    await db.commit()
    await db.refresh(hook)
    return hook


@router.patch("/{webhook_id}", response_model=WebhookOut)
async def update_webhook(
    space_id: uuid.UUID,
    webhook_id: uuid.UUID,
    payload: WebhookUpdate,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    hook = await _get_hook(db, space_id, webhook_id, actor)
    if payload.events is not None:
        _validate_events(payload.events)
        hook.events = payload.events
    for attr in ("name", "url", "secret", "enabled", "headers"):
        value = getattr(payload, attr)
        if value is not None:
            setattr(hook, attr, value)
    if payload.filters is not None:
        hook.filters = payload.filters.model_dump()
    await db.commit()
    await db.refresh(hook)
    return hook


@router.delete("/{webhook_id}", status_code=204)
async def delete_webhook(
    space_id: uuid.UUID,
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    hook = await _get_hook(db, space_id, webhook_id, actor)
    await db.delete(hook)
    await db.commit()


@router.get("/{webhook_id}/deliveries", response_model=list[WebhookDeliveryOut])
async def list_deliveries(
    space_id: uuid.UUID,
    webhook_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_manage),
):
    """Most recent delivery attempts (status codes, latency, response body)."""
    await _get_hook(db, space_id, webhook_id, actor)
    stmt = (
        select(WebhookDelivery)
        .where(WebhookDelivery.webhook_id == webhook_id)
        .order_by(WebhookDelivery.created_at.desc())
        .limit(50)
    )
    return (await db.execute(stmt)).scalars().all()


def _validate_events(events: list[str]) -> None:
    unknown = [e for e in events if e not in EVENT_TYPES]
    if unknown:
        raise HTTPException(status_code=422, detail=f"Unknown event types: {unknown}")


async def _get_hook(db: AsyncSession, space_id: uuid.UUID, webhook_id: uuid.UUID, actor: Actor) -> Webhook:
    await get_space(space_id, db, actor)
    hook = (
        await db.execute(select(Webhook).where(Webhook.id == webhook_id, Webhook.space_id == space_id))
    ).scalar_one_or_none()
    if hook is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    return hook
