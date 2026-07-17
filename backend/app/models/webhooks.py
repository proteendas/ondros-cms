"""Webhooks: outbound HTTP notifications on content events.

Events are dot-namespaced strings (see app.core.events.EVENT_TYPES):
  entry.create, entry.update, entry.publish, entry.unpublish, entry.archive,
  entry.delete, content_type.create, content_type.update, content_type.delete,
  asset.create, asset.update, asset.delete, environment.create

``filters`` narrows delivery: {"content_types": ["article"], "environments": ["master"]}
(empty/missing = match everything). Payloads are signed with HMAC-SHA256 of the
body using ``secret``; consumers verify via the X-CMS-Signature header.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at_col, updated_at_col, uuid_pk


class Webhook(Base):
    __tablename__ = "webhooks"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    url: Mapped[str] = mapped_column(String(1000))
    secret: Mapped[str] = mapped_column(String(200), default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # Subscribed event types; empty = all events.
    events: Mapped[list] = mapped_column(JSONB, default=list)
    # {"content_types": [api_id, ...], "environments": [key, ...]}
    filters: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Extra headers sent with every delivery: {"X-Custom": "value"}
    headers: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        back_populates="webhook", cascade="all, delete-orphan", passive_deletes=True
    )


class WebhookDelivery(Base):
    """Log of one delivery attempt, shown in the webhook settings UI."""

    __tablename__ = "webhook_deliveries"

    id: Mapped[uuid.UUID] = uuid_pk()
    webhook_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("webhooks.id", ondelete="CASCADE"), index=True
    )
    event: Mapped[str] = mapped_column(String(100))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Truncated response body / error message for debugging.
    response_body: Mapped[str] = mapped_column(Text, default="")
    success: Mapped[bool] = mapped_column(Boolean, default=False)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = created_at_col()

    webhook: Mapped[Webhook] = relationship(back_populates="deliveries")
