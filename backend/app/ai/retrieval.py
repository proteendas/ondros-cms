"""RAG retrieval over guideline chunks (pgvector cosine distance)."""
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import get_ai_client
from app.models import GuidelineChunk, GuidelineDocument


@dataclass
class RetrievedChunk:
    text: str
    document_title: str
    document_id: uuid.UUID
    chunk_index: int
    distance: float | None = None


async def retrieve_guideline_chunks(
    session: AsyncSession,
    query: str,
    tenant_id: uuid.UUID,
    space_id: uuid.UUID | None = None,
    content_type_api_id: str | None = None,
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """Embed `query`, return the top_k closest guideline chunks for this tenant.

    Scoping rules:
      - tenant_id always filters (hard boundary).
      - space: chunks from documents with matching space_id OR tenant-wide (NULL).
      - content type: applied post-query in Python against chunk.meta["content_types"]
        (empty list = applies to all types). Move into a JSONB @> filter if the
        chunk table grows large.
    """
    client = get_ai_client()
    if not client.is_configured or not query.strip():
        return []

    query_vec = (await client.embed([query]))[0]

    # Over-fetch so post-filtering by content type still leaves top_k results.
    fetch_n = top_k * 4
    distance = GuidelineChunk.embedding.cosine_distance(query_vec)
    stmt = (
        select(GuidelineChunk, GuidelineDocument, distance.label("distance"))
        .join(GuidelineDocument, GuidelineChunk.document_id == GuidelineDocument.id)
        .where(
            GuidelineDocument.tenant_id == tenant_id,
            GuidelineChunk.embedding.is_not(None),
        )
        .order_by(distance)
        .limit(fetch_n)
    )
    if space_id is not None:
        stmt = stmt.where(
            (GuidelineDocument.space_id == space_id) | (GuidelineDocument.space_id.is_(None))
        )

    rows = (await session.execute(stmt)).all()

    results: list[RetrievedChunk] = []
    for chunk, doc, dist in rows:
        applies_to = (chunk.meta or {}).get("content_types") or []
        if content_type_api_id and applies_to and content_type_api_id not in applies_to:
            continue
        results.append(
            RetrievedChunk(
                text=chunk.text,
                document_title=doc.title,
                document_id=doc.id,
                chunk_index=chunk.chunk_index,
                distance=float(dist) if dist is not None else None,
            )
        )
        if len(results) >= top_k:
            break
    return results
