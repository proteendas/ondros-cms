"""API keys for the delivery, preview and management APIs.

Tokens look like ``cms_del_<random>`` / ``cms_pre_<random>`` / ``cms_mgm_<random>``.
Only a SHA-256 hash is stored; the full token is returned exactly once, on
creation. ``token_prefix`` keeps the first characters for display in the UI.

Scoping:
  - Every key belongs to one space.
  - ``environment_ids`` (list of UUID strings) restricts delivery/preview keys
    to specific environments; empty list = all environments in the space.
  - ``type`` controls what the key can see:
      delivery   -> published content only
      preview    -> draft + published content
      management -> full CRUD (still restricted to its space)
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, uuid_pk


class ApiKeyType(str, enum.Enum):
    delivery = "delivery"
    preview = "preview"
    management = "management"


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    type: Mapped[str] = mapped_column(String(20), default=ApiKeyType.delivery.value, index=True)
    token_prefix: Mapped[str] = mapped_column(String(24))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Allowed environment ids (as strings). Empty = every environment in the space.
    environment_ids: Mapped[list] = mapped_column(JSONB, default=list)
    read_only: Mapped[bool] = mapped_column(Boolean, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
