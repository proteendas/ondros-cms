"""AI service layer: orchestrates RAG retrieval + prompt building + LLM calls.

API routers call these functions; they never talk to the LLM client directly.
All functions take the management-plane Actor so retrieval is tenant-scoped.
"""
import json
import logging
import re
import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor
from app.ai.client import get_ai_client
from app.ai.prompts import (
    build_compliance_messages,
    build_generate_entry_messages,
    build_seo_meta_messages,
    build_suggest_titles_messages,
    build_transform_messages,
    build_translate_messages,
)
from app.ai.retrieval import RetrievedChunk, retrieve_guideline_chunks
from app.models import ContentType, Entry
from app.schemas.ai import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    ComplianceIssue,
    GenerateEntryRequest,
    GenerateEntryResponse,
    SeoMetaRequest,
    SeoMetaResponse,
    SuggestTitlesRequest,
    SuggestTitlesResponse,
    TransformFieldRequest,
    TransformFieldResponse,
    TranslateFieldsRequest,
    TranslateFieldsResponse,
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


async def _get_content_type(
    db: AsyncSession, content_type_id: uuid.UUID, actor: Actor
) -> ContentType:
    ct = (
        await db.execute(
            select(ContentType).where(
                ContentType.id == content_type_id, ContentType.tenant_id == actor.tenant_id
            )
        )
    ).scalar_one_or_none()
    if ct is None:
        raise HTTPException(status_code=404, detail="Content type not found")
    return ct


async def generate_entry_fields(
    db: AsyncSession, actor: Actor, req: GenerateEntryRequest
) -> GenerateEntryResponse:
    ct = await _get_content_type(db, req.content_type_id, actor)

    # Retrieve guidelines relevant to both the brief and the content type.
    chunks = await retrieve_guideline_chunks(
        db,
        query=f"{ct.name}: {req.brief}",
        tenant_id=actor.tenant_id,
        space_id=req.space_id or ct.space_id,
        content_type_api_id=ct.api_id,
    )

    brief = req.brief
    if req.locale:
        brief += f"\n\nWrite all content in the locale '{req.locale}'."
    messages = build_generate_entry_messages(ct, brief, chunks, req.field_ids or None)
    raw = await get_ai_client().chat(messages, temperature=0.6, json_mode=True)
    fields = _parse_json_response(raw)

    # Keep only known field ids (the model occasionally adds commentary keys).
    known_ids = {f["id"] for f in ct.fields}
    fields = {k: v for k, v in fields.items() if k in known_ids}

    return GenerateEntryResponse(fields=fields, guidelines_used=_excerpts(chunks))


async def transform_field(
    db: AsyncSession, actor: Actor, req: TransformFieldRequest
) -> TransformFieldResponse:
    field_context = ""
    ct: ContentType | None = None
    if req.content_type_id:
        ct = await _get_content_type(db, req.content_type_id, actor)
        if req.field_id:
            fd = next((f for f in ct.fields if f["id"] == req.field_id), None)
            if fd:
                v = fd.get("validations") or {}
                max_len = f", max {v['max_length']} chars" if v.get("max_length") else ""
                field_context = f"{fd['name']} ({fd['type']}{max_len}). {fd.get('ai_hint', '')}"

    chunks = await retrieve_guideline_chunks(
        db,
        query=req.text[:500],
        tenant_id=actor.tenant_id,
        content_type_api_id=ct.api_id if ct else None,
    )

    messages = build_transform_messages(req.text, req.mode, req.instruction, chunks, field_context)
    result = await get_ai_client().chat(messages, temperature=0.5)
    return TransformFieldResponse(text=result.strip(), guidelines_used=_excerpts(chunks))


async def check_compliance(
    db: AsyncSession, actor: Actor, req: ComplianceCheckRequest
) -> ComplianceCheckResponse:
    # Resolve the fields + content type either from an entry or from the raw payload.
    if req.entry_id:
        entry = (
            await db.execute(
                select(Entry).where(Entry.id == req.entry_id, Entry.tenant_id == actor.tenant_id)
            )
        ).scalar_one_or_none()
        if entry is None:
            raise HTTPException(status_code=404, detail="Entry not found")
        ct = entry.content_type
        fields = entry.fields or {}
    elif req.content_type_id is not None and req.fields is not None:
        ct = await _get_content_type(db, req.content_type_id, actor)
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
        tenant_id=actor.tenant_id,
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


async def suggest_titles(
    db: AsyncSession, actor: Actor, req: SuggestTitlesRequest
) -> SuggestTitlesResponse:
    ct = await _get_content_type(db, req.content_type_id, actor) if req.content_type_id else None
    chunks = await retrieve_guideline_chunks(
        db,
        query=f"titles headlines {req.body[:400]}",
        tenant_id=actor.tenant_id,
        space_id=ct.space_id if ct else None,
        content_type_api_id=ct.api_id if ct else None,
    )
    count = max(1, min(req.count, 10))
    raw = await get_ai_client().chat(
        build_suggest_titles_messages(req.body, count, req.locale, chunks),
        temperature=0.8,
        json_mode=True,
    )
    parsed = _parse_json_response(raw)
    titles = [str(t) for t in parsed.get("titles", [])][:count]
    return SuggestTitlesResponse(titles=titles)


async def generate_seo_meta(db: AsyncSession, actor: Actor, req: SeoMetaRequest) -> SeoMetaResponse:
    ct = await _get_content_type(db, req.content_type_id, actor) if req.content_type_id else None
    chunks = await retrieve_guideline_chunks(
        db,
        query=f"SEO meta description keywords {req.title} {req.body[:300]}",
        tenant_id=actor.tenant_id,
        space_id=ct.space_id if ct else None,
        content_type_api_id=ct.api_id if ct else None,
    )
    raw = await get_ai_client().chat(
        build_seo_meta_messages(req.title, req.body, req.locale, chunks),
        temperature=0.4,
        json_mode=True,
    )
    parsed = _parse_json_response(raw)
    return SeoMetaResponse(
        seo_title=str(parsed.get("seo_title", ""))[:120],
        seo_description=str(parsed.get("seo_description", ""))[:300],
        keywords=[str(k) for k in parsed.get("keywords", [])][:8],
        guidelines_used=_excerpts(chunks),
    )


async def translate_fields(
    db: AsyncSession, actor: Actor, req: TranslateFieldsRequest
) -> TranslateFieldsResponse:
    ct = await _get_content_type(db, req.content_type_id, actor)
    chunks = await retrieve_guideline_chunks(
        db,
        query=f"tone terminology translation {req.target_locale}",
        tenant_id=actor.tenant_id,
        space_id=ct.space_id,
        content_type_api_id=ct.api_id,
    )
    # Only translate string-ish values; ids/booleans/numbers pass through untouched.
    translatable = {
        k: v for k, v in req.fields.items() if isinstance(v, str) and v.strip()
    }
    if not translatable:
        return TranslateFieldsResponse(fields=req.fields)

    raw = await get_ai_client().chat(
        build_translate_messages(ct, translatable, req.source_locale, req.target_locale, chunks),
        temperature=0.3,
        json_mode=True,
    )
    parsed = _parse_json_response(raw)
    out = dict(req.fields)
    for k in translatable:
        if isinstance(parsed.get(k), str):
            out[k] = parsed[k]
    return TranslateFieldsResponse(fields=out, guidelines_used=_excerpts(chunks))
