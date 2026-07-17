"""Audit trail + entry version snapshots.

AuditLog rows are written by app.core.audit.record_audit for every mutating
operation (content, model, settings). EntryVersion snapshots are captured on
every entry save so editors can diff and restore (kept to the most recent 50
per entry).
"""
import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_tenant_created", "tenant_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Human-readable fallback ("api-key: Dev delivery key", "system") so rows
    # stay meaningful after user deletion.
    actor_label: Mapped[str] = mapped_column(String(255), default="")
    action: Mapped[str] = mapped_column(String(60), index=True)  # entry.update, api_key.create...
    resource_type: Mapped[str] = mapped_column(String(40), index=True)
    resource_id: Mapped[str] = mapped_column(String(64), default="")
    # Shallow diff: {"field": {"from": ..., "to": ...}} or arbitrary context.
    diff: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created_at_col()


class EntryVersion(Base):
    __tablename__ = "entry_versions"
    __table_args__ = (UniqueConstraint("entry_id", "version"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    entry_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("entries.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    slug: Mapped[str] = mapped_column(String(200), default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    fields: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
