"""Guideline document management + ingestion into pgvector."""
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.ingestion import extract_text, ingest_document
from app.ai.retrieval import retrieve_guideline_chunks
from app.api.deps import get_current_user
from app.database import get_db
from app.models import GuidelineChunk, GuidelineDocument, User
from app.schemas.guidelines import GuidelineCreate, GuidelineOut, GuidelineSearchHit

router = APIRouter(prefix="/guidelines", tags=["guidelines"])


async def _to_out(db: AsyncSession, doc: GuidelineDocument) -> GuidelineOut:
    count = (
        await db.execute(
            select(func.count(GuidelineChunk.id)).where(GuidelineChunk.document_id == doc.id)
        )
    ).scalar_one()
    out = GuidelineOut.model_validate(doc)
    out.chunk_count = count
    return out


@router.get("", response_model=list[GuidelineOut])
async def list_guidelines(
    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    docs = (
        (
            await db.execute(
                select(GuidelineDocument)
                .where(GuidelineDocument.tenant_id == user.tenant_id)
                .order_by(GuidelineDocument.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [await _to_out(db, d) for d in docs]


@router.post("", response_model=GuidelineOut, status_code=201)
async def create_guideline(
    payload: GuidelineCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a guideline from raw text and ingest it (chunk + embed) immediately."""
    doc = GuidelineDocument(
        tenant_id=user.tenant_id,
        space_id=payload.space_id,
        title=payload.title,
        source_type="text",
        original_text=payload.text,
        content_types=payload.content_types,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    await ingest_document(db, doc)
    await db.refresh(doc)
    return await _to_out(db, doc)


@router.post("/upload", response_model=GuidelineOut, status_code=201)
async def upload_guideline(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    content_types: str = Form(default=""),  # comma-separated api_ids
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload a guideline file (txt/md/html; extend extract_text for PDF/DOCX)."""
    raw = await file.read()
    text = extract_text(file.filename or "upload.txt", raw)
    if not text:
        raise HTTPException(status_code=422, detail="Could not extract any text from the file")

    doc = GuidelineDocument(
        tenant_id=user.tenant_id,
        title=title or (file.filename or "Untitled guideline"),
        source_type="upload",
        original_text=text,
        content_types=[s.strip() for s in content_types.split(",") if s.strip()],
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)

    await ingest_document(db, doc)
    await db.refresh(doc)
    return await _to_out(db, doc)


@router.post("/{guideline_id}/ingest", response_model=GuidelineOut)
async def reingest_guideline(
    guideline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Re-run chunking + embedding (e.g. after configuring Azure OpenAI)."""
    doc = await _get_owned(db, guideline_id, user)
    await ingest_document(db, doc)
    await db.refresh(doc)
    return await _to_out(db, doc)


@router.delete("/{guideline_id}", status_code=204)
async def delete_guideline(
    guideline_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    doc = await _get_owned(db, guideline_id, user)
    await db.delete(doc)
    await db.commit()


@router.get("/search", response_model=list[GuidelineSearchHit])
async def search_guidelines(
    q: str,
    content_type: str | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Debug endpoint: see exactly which chunks RAG would retrieve for a query."""
    chunks = await retrieve_guideline_chunks(
        db, query=q, tenant_id=user.tenant_id, content_type_api_id=content_type, top_k=10
    )
    return [
        GuidelineSearchHit(
            document_id=c.document_id,
            document_title=c.document_title,
            chunk_index=c.chunk_index,
            text=c.text,
            distance=c.distance,
        )
        for c in chunks
    ]


async def _get_owned(db: AsyncSession, guideline_id: uuid.UUID, user: User) -> GuidelineDocument:
    doc = (
        await db.execute(
            select(GuidelineDocument).where(
                GuidelineDocument.id == guideline_id,
                GuidelineDocument.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Guideline not found")
    return doc
