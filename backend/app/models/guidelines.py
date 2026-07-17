"""Guideline documents and their embedded chunks (RAG source material).

A GuidelineDocument is raw text (brand voice, legal rules, SEO checklists...).
Ingestion (app.ai.ingestion) splits it into GuidelineChunks and stores an
embedding per chunk in a pgvector column. Retrieval (app.ai.retrieval) does a
cosine-distance top-k over those vectors.

embedding is nullable so documents can be stored before Azure OpenAI is
configured; re-run ingestion later to backfill vectors.
"""
import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.config import get_settings
from app.models.base import Base, created_at_col, uuid_pk

EMBEDDING_DIM = get_settings().embedding_dim


class GuidelineDocument(Base):
    __tablename__ = "guideline_documents"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    # Optional space scoping; NULL = applies tenant-wide.
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True
    )
    # Optional environment scoping; NULL = applies to every environment.
    environment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("environments.id", ondelete="CASCADE"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(300))
    source_type: Mapped[str] = mapped_column(String(30), default="text")  # text | upload | url
    original_text: Mapped[str] = mapped_column(Text)
    # pending -> ingested | failed
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # Optional list of content type api_ids this guideline applies to; empty = all.
    content_types: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = created_at_col()

    chunks: Mapped[list["GuidelineChunk"]] = relationship(
        back_populates="document", cascade="all, delete-orphan", passive_deletes=True
    )


class GuidelineChunk(Base):
    __tablename__ = "guideline_chunks"

    id: Mapped[uuid.UUID] = uuid_pk()
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("guideline_documents.id", ondelete="CASCADE"), index=True
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    embedding: Mapped[list | None] = mapped_column(Vector(EMBEDDING_DIM), nullable=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict)

    document: Mapped[GuidelineDocument] = relationship(back_populates="chunks")
