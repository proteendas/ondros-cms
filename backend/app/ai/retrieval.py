"""RAG retrieval over guideline chunks.

Two modes, selected automatically:

  vector   -> provider supports embeddings AND chunks were embedded:
              pgvector cosine-distance top-k (best quality).
  keyword  -> chat-only providers (groq, openrouter) or unembedded chunks:
              term-overlap scoring over the chunk text (works everywhere).

Both modes apply the same scoping: tenant (hard boundary), optional space
(space match OR tenant-wide docs), optional content type (post-filter on
chunk.meta["content_types"]).
"""
import re
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


def retrieval_mode() -> str:
    client = get_ai_client()
    if not client.is_configured:
        return "disabled"
    return "vector" if client.supports_embeddings else "keyword"


def _scoped_stmt(tenant_id: uuid.UUID, space_id: uuid.UUID | None):
    stmt = (
        select(GuidelineChunk, GuidelineDocument)
        .join(GuidelineDocument, GuidelineChunk.document_id == GuidelineDocument.id)
        .where(GuidelineDocument.tenant_id == tenant_id)
    )
    if space_id is not None:
        stmt = stmt.where(
            (GuidelineDocument.space_id == space_id) | (GuidelineDocument.space_id.is_(None))
        )
    return stmt


def _passes_ct_filter(chunk: GuidelineChunk, content_type_api_id: str | None) -> bool:
    applies_to = (chunk.meta or {}).get("content_types") or []
    return not (content_type_api_id and applies_to and content_type_api_id not in applies_to)


_WORD_RE = re.compile(r"[a-zA-Z][a-zA-Z0-9\-]{2,}")


def _keyword_score(query_terms: set[str], text: str) -> float:
    if not query_terms:
        return 0.0
    text_terms = {w.lower() for w in _WORD_RE.findall(text)}
    overlap = len(query_terms & text_terms)
    return overlap / len(query_terms)


async def retrieve_guideline_chunks(
    session: AsyncSession,
    query: str,
    tenant_id: uuid.UUID,
    space_id: uuid.UUID | None = None,
    content_type_api_id: str | None = None,
    top_k: int = 5,
) -> list[RetrievedChunk]:
    """Return the top_k most relevant guideline chunks for this tenant."""
    client = get_ai_client()
    if not client.is_configured or not query.strip():
        return []

    if client.supports_embeddings:
        try:
            return await _vector_search(
                session, query, tenant_id, space_id, content_type_api_id, top_k
            )
        except Exception:
            # Dimension mismatch (EMBEDDING_DIM vs model), unembedded chunks,
            # provider hiccup... degrade gracefully.
            pass
    return await _keyword_search(session, query, tenant_id, space_id, content_type_api_id, top_k)


async def _vector_search(
    session: AsyncSession,
    query: str,
    tenant_id: uuid.UUID,
    space_id: uuid.UUID | None,
    content_type_api_id: str | None,
    top_k: int,
) -> list[RetrievedChunk]:
    query_vec = (await get_ai_client().embed([query]))[0]

    # Over-fetch so post-filtering by content type still leaves top_k results.
    distance = GuidelineChunk.embedding.cosine_distance(query_vec)
    stmt = (
        _scoped_stmt(tenant_id, space_id)
        .add_columns(distance.label("distance"))
        .where(GuidelineChunk.embedding.is_not(None))
        .order_by(distance)
        .limit(top_k * 4)
    )
    rows = (await session.execute(stmt)).all()

    results: list[RetrievedChunk] = []
    for chunk, doc, dist in rows:
        if not _passes_ct_filter(chunk, content_type_api_id):
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


async def _keyword_search(
    session: AsyncSession,
    query: str,
    tenant_id: uuid.UUID,
    space_id: uuid.UUID | None,
    content_type_api_id: str | None,
    top_k: int,
) -> list[RetrievedChunk]:
    """Term-overlap ranking; fine at guideline scale (hundreds of chunks)."""
    query_terms = {w.lower() for w in _WORD_RE.findall(query)}
    rows = (await session.execute(_scoped_stmt(tenant_id, space_id).limit(500))).all()

    scored: list[tuple[float, GuidelineChunk, GuidelineDocument]] = []
    for chunk, doc in rows:
        if not _passes_ct_filter(chunk, content_type_api_id):
            continue
        score = _keyword_score(query_terms, chunk.text)
        if score > 0:
            scored.append((score, chunk, doc))
    scored.sort(key=lambda t: t[0], reverse=True)

    return [
        RetrievedChunk(
            text=chunk.text,
            document_title=doc.title,
            document_id=doc.id,
            chunk_index=chunk.chunk_index,
            distance=1.0 - score,  # keep the "lower is better" convention
        )
        for score, chunk, doc in scored[:top_k]
    ]
