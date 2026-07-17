"""Content event bus + async webhook dispatcher.

API handlers call `emit(...)` after a successful mutation. Dispatch happens in
a background asyncio task with its own DB session, so request latency is never
tied to webhook endpoints. Each attempt is logged as a WebhookDelivery row
(pruned to the most recent per webhook) for the settings UI.

Payloads are signed: X-CMS-Signature: sha256=<hmac_sha256(secret, body)>.
"""
import asyncio
import hashlib
import hmac
import json
import logging
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import delete, select

from app.models import Webhook, WebhookDelivery

logger = logging.getLogger(__name__)

EVENT_TYPES = [
    "entry.create",
    "entry.update",
    "entry.publish",
    "entry.unpublish",
    "entry.archive",
    "entry.delete",
    "content_type.create",
    "content_type.update",
    "content_type.delete",
    "asset.create",
    "asset.update",
    "asset.delete",
    "environment.create",
]

DELIVERY_TIMEOUT_S = 10
MAX_DELIVERIES_KEPT = 50
_MAX_BODY_LOGGED = 2000

# Keep references so tasks aren't garbage-collected mid-flight.
_background_tasks: set[asyncio.Task] = set()


def emit(
    tenant_id: uuid.UUID,
    space_id: uuid.UUID,
    event: str,
    payload: dict[str, Any],
    *,
    content_type_api_id: str | None = None,
    environment_key: str | None = None,
) -> None:
    """Fire-and-forget: schedule webhook dispatch for one event."""
    try:
        task = asyncio.create_task(
            _dispatch(tenant_id, space_id, event, payload, content_type_api_id, environment_key)
        )
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    except RuntimeError:  # no running loop (sync tests) — skip silently
        logger.debug("No event loop; skipping webhook dispatch for %s", event)


def _matches(webhook: Webhook, event: str, ct_api_id: str | None, env_key: str | None) -> bool:
    if webhook.events and event not in webhook.events:
        return False
    filters = webhook.filters or {}
    allowed_cts = filters.get("content_types") or []
    if allowed_cts and ct_api_id and ct_api_id not in allowed_cts:
        return False
    allowed_envs = filters.get("environments") or []
    if allowed_envs and env_key and env_key not in allowed_envs:
        return False
    return True


def sign_payload(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def _dispatch(
    tenant_id: uuid.UUID,
    space_id: uuid.UUID,
    event: str,
    payload: dict[str, Any],
    ct_api_id: str | None,
    env_key: str | None,
) -> None:
    # Local import avoids a circular import (database -> models -> ... -> events).
    from app.database import async_session_maker

    try:
        async with async_session_maker() as db:
            hooks = (
                (
                    await db.execute(
                        select(Webhook).where(
                            Webhook.tenant_id == tenant_id,
                            Webhook.space_id == space_id,
                            Webhook.enabled.is_(True),
                        )
                    )
                )
                .scalars()
                .all()
            )
            hooks = [h for h in hooks if _matches(h, event, ct_api_id, env_key)]
            if not hooks:
                return

            envelope = {
                "event": event,
                "spaceId": str(space_id),
                "environment": env_key,
                "contentType": ct_api_id,
                "payload": payload,
            }
            body = json.dumps(envelope, default=str).encode("utf-8")

            async with httpx.AsyncClient(timeout=DELIVERY_TIMEOUT_S) as client:
                for hook in hooks:
                    await _deliver(db, client, hook, event, envelope, body)
    except Exception:  # noqa: BLE001 - webhook failures must never break the app
        logger.exception("Webhook dispatch failed for event %s", event)


async def _deliver(db, client: httpx.AsyncClient, hook: Webhook, event: str, envelope: dict, body: bytes) -> None:
    headers = {
        "Content-Type": "application/json",
        "X-CMS-Event": event,
        "X-CMS-Webhook-Id": str(hook.id),
        **(hook.headers or {}),
    }
    if hook.secret:
        headers["X-CMS-Signature"] = sign_payload(hook.secret, body)

    started = time.monotonic()
    status_code: int | None = None
    response_body = ""
    success = False
    try:
        resp = await client.post(hook.url, content=body, headers=headers)
        status_code = resp.status_code
        response_body = resp.text[:_MAX_BODY_LOGGED]
        success = 200 <= resp.status_code < 300
    except httpx.HTTPError as exc:
        response_body = f"{type(exc).__name__}: {exc}"[:_MAX_BODY_LOGGED]

    db.add(
        WebhookDelivery(
            webhook_id=hook.id,
            event=event,
            payload=envelope,
            response_status=status_code,
            response_body=response_body,
            success=success,
            duration_ms=int((time.monotonic() - started) * 1000),
        )
    )
    await db.commit()

    # Prune history so the log table stays small.
    old_ids = (
        await db.execute(
            select(WebhookDelivery.id)
            .where(WebhookDelivery.webhook_id == hook.id)
            .order_by(WebhookDelivery.created_at.desc())
            .offset(MAX_DELIVERIES_KEPT)
        )
    ).scalars().all()
    if old_ids:
        await db.execute(delete(WebhookDelivery).where(WebhookDelivery.id.in_(old_ids)))
        await db.commit()
