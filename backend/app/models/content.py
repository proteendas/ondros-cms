"""Content models.

ContentType.fields holds the schema as JSON (list of field definitions, see
app.schemas.content.FieldDef). Entry.fields holds the *draft* values keyed by
field id; published_fields holds the frozen copy served by the delivery API.
This draft/published split is what powers "preview vs live".
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at_col, updated_at_col, uuid_pk


class ContentType(Base):
    __tablename__ = "content_types"
    __table_args__ = (UniqueConstraint("space_id", "api_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    # Stable machine name used in delivery URLs: /content/{api_id}/{slug}
    api_id: Mapped[str] = mapped_column(String(100), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    # List of FieldDef dicts: [{"id": "title", "name": "Title", "type": "text", ...}]
    fields: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()


class EntryStatus(str, enum.Enum):
    draft = "draft"
    in_review = "in_review"
    published = "published"
    archived = "archived"


class Entry(Base):
    __tablename__ = "entries"
    __table_args__ = (UniqueConstraint("content_type_id", "slug"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    content_type_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("content_types.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(200), index=True)
    status: Mapped[str] = mapped_column(String(20), default=EntryStatus.draft.value, index=True)
    # Draft values, keyed by field id.
    fields: Mapped[dict] = mapped_column(JSONB, default=dict)
    # Frozen copy created on publish; what the public delivery API serves.
    published_fields: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    content_type: Mapped[ContentType] = relationship(lazy="joined")


class MediaAsset(Base):
    """Minimal local-disk media storage. Swap `path` handling in app.api.media
    for S3/Azure Blob by replacing the save/delete functions there.
    """

    __tablename__ = "media_assets"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spaces.id", ondelete="SET NULL"), nullable=True
    )
    filename: Mapped[str] = mapped_column(String(500))
    mime_type: Mapped[str] = mapped_column(String(150), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    # Public URL path (served by StaticFiles mount at /files).
    url: Mapped[str] = mapped_column(String(1000))
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = created_at_col()
