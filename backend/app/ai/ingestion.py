"""Guideline ingestion: extract text -> chunk -> embed -> store in pgvector.

Pipeline entry point is `ingest_document`. It is idempotent: re-running deletes
old chunks and rebuilds them (use after editing the document or switching
embedding models).
"""
import logging
import re

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AIConfigurationError, get_ai_client
from app.models import GuidelineChunk, GuidelineDocument

logger = logging.getLogger(__name__)

CHUNK_SIZE = 1200  # characters; ~300 tokens. Tune with your embedding model.
CHUNK_OVERLAP = 200
EMBED_BATCH_SIZE = 64


def extract_text(filename: str, raw: bytes) -> str:
    """Turn an uploaded file into plain text.

    Handles UTF-8 text formats (txt/md/html — tags stripped naively).
    Extend for PDFs (pypdf), Word (python-docx), etc.:

        if filename.endswith(".pdf"):
            from pypdf import PdfReader
            return "\\n".join(p.extract_text() for p in PdfReader(io.BytesIO(raw)).pages)
    """
    text = raw.decode("utf-8", errors="replace")
    if filename.lower().endswith((".html", ".htm")):
        text = re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", " ", text)
        text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"[ \t]+", " ", text).strip()


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Paragraph-aware sliding window.

    Splits on blank lines first, then packs paragraphs into chunks of roughly
    chunk_size characters, carrying `overlap` characters of context between
    consecutive chunks so retrieval doesn't lose sentences cut at boundaries.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    current = ""

    for para in paragraphs:
        # A single paragraph larger than chunk_size gets hard-split.
        while len(para) > chunk_size:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(para[:chunk_size])
            para = para[chunk_size - overlap :]
        if len(current) + len(para) + 2 > chunk_size and current:
            chunks.append(current)
            current = current[-overlap:] if overlap else ""
        current = f"{current}\n\n{para}".strip() if current else para

    if current:
        chunks.append(current)
    return chunks


async def ingest_document(session: AsyncSession, document: GuidelineDocument) -> int:
    """Chunk + embed a guideline document. Returns the number of chunks stored.

    If Azure OpenAI is not configured, chunks are stored WITHOUT embeddings and
    the document is left in status 'pending' — call again once configured.
    """
    await session.execute(delete(GuidelineChunk).where(GuidelineChunk.document_id == document.id))

    chunks = chunk_text(document.original_text)
    client = get_ai_client()

    embeddings: list[list[float] | None] = [None] * len(chunks)
    if client.is_configured and chunks:
        try:
            for start in range(0, len(chunks), EMBED_BATCH_SIZE):
                batch = chunks[start : start + EMBED_BATCH_SIZE]
                embeddings[start : start + len(batch)] = await client.embed(batch)
            document.status = "ingested"
        except AIConfigurationError:
            document.status = "pending"
        except Exception:
            logger.exception("Embedding failed for guideline %s", document.id)
            document.status = "failed"
    else:
        document.status = "pending"

    for i, chunk in enumerate(chunks):
        session.add(
            GuidelineChunk(
                document_id=document.id,
                chunk_index=i,
                text=chunk,
                embedding=embeddings[i],
                meta={"content_types": document.content_types or []},
            )
        )
    await session.commit()
    return len(chunks)
