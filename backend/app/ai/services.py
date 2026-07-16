"""AI service layer: orchestrates RAG retrieval + prompt building + LLM calls.

API routers call these functions; they never talk to the LLM client directly.
"""
import json
import logging
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import get_ai_client
from app.ai.prompts import (
    build_compliance_messages,
    build_generate_entry_messages,
    build_transform_messages,
)
from app.ai.retrieval import RetrievedChunk, retrieve_guideline_chunks
from app.models import ContentType, Entry, User
from app.schemas.ai import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ComplianceIssue,
    GenerateEntryRequest,
    GenerateEntryResponse,
    TransformFieldRequest,
    TransformFieldResponse,
)

logger = logging.getLogger(__name__)


def _parse_json_response(raw: str) -> dict:
    """Parse LLM JSON output, tolerating markdown fences and stray prose."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass  # e.g. truncated output: brace blob found but still invalid
        raise HTTPException(status_code=502, detail="AI returned malformed JSON")


def _excerpts(chunks: list[RetrievedChunk], limit: int = 300) -> list[str]:
    return [f"{c.document_title}: {c.text[:limit]}" for c in chunks]


async def _get_content_type(db: AsyncSession, content_type_id: uuid.UUID, user: User) -> ContentType:
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == content_type_id, ContentType.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found")
    return ct


async def generate_entry_fields(
    db: AsyncSession, user: User, req: GenerateEntryRequest
) -> GenerateEntryResponse:
    ct = await _get_content_type(db, req.content_type_id, user)

    # Retrieve guidelines relevant to both the brief and the content type.
    chunks = await retrieve_guideline_chunks(
        db,
        query=f"{ct.name}: {req.brief}",
        tenant_id=user.tenant_id,
        space_id=req.space_id or ct.space_id,
        content_type_api_id=ct.api_id,
    )

    messages = build_generate_entry_messages(ct, req.brief, chunks, req.field_ids or None)
    raw = await get_ai_client().chat(messages, temperature=0.6, json_mode=True)
    fields = _parse_json_response(raw)

    # Keep only known field ids (the model occasionally adds commentary keys).
    known_ids = {f["id"] for f in ct.fields}
    fields = {k: v for k, v in fields.items() if k in known_ids}

    return GenerateEntryResponse(fields=fields, guidelines_used=_excerpts(chunks))


async def transform_field(
    db: AsyncSession, user: User, req: TransformFieldRequest
) -> TransformFieldResponse:
    field_context = ""
    ct: ContentType | None = None
    if req.content_type_id:
        ct = await _get_content_type(db, req.content_type_id, user)
        if req.field_id:
            fd = next((f for f in ct.fields if f["id"] == req.field_id), None)
            if fd:
                v = fd.get("validations") or {}
                max_len = f", max {v['max_length']} chars" if v.get("max_length") else ""
                field_context = f"{fd['name']} ({fd['type']}{max_len}). {fd.get('ai_hint', '')}"

    chunks = await retrieve_guideline_chunks(
        db,
        query=req.text[:500],
        tenant_id=user.tenant_id,
        content_type_api_id=ct.api_id if ct else None,
    )

    messages = build_transform_messages(req.text, req.mode, req.instruction, chunks, field_context)
    result = await get_ai_client().chat(messages, temperature=0.5)
    return TransformFieldResponse(text=result.strip(), guidelines_used=_excerpts(chunks))


async def check_compliance(
    db: AsyncSession, user: User, req: ComplianceCheckRequest
) -> ComplianceCheckResponse:
    # Resolve the fields + content type either from an entry or from the raw payload.
    if req.entry_id:
        entry = (
            await db.execute(
                select(Entry).where(Entry.id == req.entry_id, Entry.tenant_id == user.tenant_id)
            )
        ).scalar_one_or_none()
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        ct = entry.content_type
        fields = entry.fields or {}
    elif req.content_type_id is not None and req.fields is not None:
        ct = await _get_content_type(db, req.content_type_id, user)
        fields = req.fields
    else:
        raise HTTPException(
            status_code=422, detail="Provide either entry_id or (content_type_id + fields)"
        )

    # Use the actual content as the retrieval query so the most relevant rules surface.
    query_text = " ".join(str(v) for v in fields.values())[:800] or ct.name
    chunks = await retrieve_guideline_chunks(
        db,
        query=query_text,
        tenant_id=user.tenant_id,
        space_id=ct.space_id,
        content_type_api_id=ct.api_id,
        top_k=8,
    )

    messages = build_compliance_messages(ct, fields, chunks)
    raw = await get_ai_client().chat(messages, temperature=0.1, json_mode=True)
    parsed = _parse_json_response(raw)

    issues = []
    for item in parsed.get("issues", []):
        try:
            issues.append(ComplianceIssue(**item))
        except Exception:
            logger.warning("Skipping malformed compliance issue: %r", item)

    return ComplianceCheckResponse(
        passed=bool(parsed.get("passed", not issues)),
        issues=issues,
        guidelines_used=_excerpts(chunks),
    )
