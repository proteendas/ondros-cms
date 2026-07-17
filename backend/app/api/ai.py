"""AI endpoints: guideline-aware generation, transformation, compliance, SEO,
titles, translation — plus /ai/status so the editor can show the active provider.

Thin HTTP layer over app.ai.services — keep business logic there.
All endpoints require auth + the use_ai capability; they return 503 until an
AI provider is configured (see .env.example: groq/gemini/ollama are free).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AIConfigurationError, get_ai_client
from app.ai.retrieval import retrieval_mode
from app.ai.services import (
    check_compliance,
    generate_entry_fields,
    generate_seo_meta,
    suggest_titles,
    transform_field,
    translate_fields,
)
from app.api.deps import Actor, ensure_can, get_actor
from app.core.permissions import Capability
from app.database import get_db
from app.schemas.ai import (
    AiStatusResponse,
    ComplianceCheckRequest,
    ComplianceCheckResponse,
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

router = APIRouter(prefix="/ai", tags=["ai"])


def _use_ai(actor: Actor = Depends(get_actor)) -> Actor:
    ensure_can(actor, Capability.USE_AI.value)
    return actor


@router.get("/status", response_model=AiStatusResponse)
async def ai_status(actor: Actor = Depends(get_actor)):
    """Which provider/model is active and how guideline retrieval runs."""
    client = get_ai_client()
    return AiStatusResponse(
        configured=client.is_configured,
        provider=client.provider,
        chat_model=client.chat_model,
        embeddings_enabled=client.supports_embeddings,
        retrieval_mode=retrieval_mode(),
    )


@router.post("/generate-entry", response_model=GenerateEntryResponse)
async def generate_entry(
    req: GenerateEntryRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Generate values for all (or selected) fields of a content type from a brief.
    Retrieves matching guidelines and injects them into the prompt."""
    try:
        return await generate_entry_fields(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/transform-field", response_model=TransformFieldResponse)
async def transform(
    req: TransformFieldRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Rewrite / shorten / expand / SEO-optimize / translate a single field value."""
    try:
        return await transform_field(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/check-compliance", response_model=ComplianceCheckResponse)
async def compliance(
    req: ComplianceCheckRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Audit an entry (or raw fields) against ingested brand/editorial guidelines."""
    try:
        return await check_compliance(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/suggest-titles", response_model=SuggestTitlesResponse)
async def titles(
    req: SuggestTitlesRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Suggest headline options from body text (guideline-aware)."""
    try:
        return await suggest_titles(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/seo-meta", response_model=SeoMetaResponse)
async def seo_meta(
    req: SeoMetaRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Generate SEO title/description/keywords from title + body + guidelines."""
    try:
        return await generate_seo_meta(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/translate-fields", response_model=TranslateFieldsResponse)
async def translate(
    req: TranslateFieldsRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(_use_ai),
):
    """Translate field values to another locale, respecting schema + guidelines."""
    try:
        return await translate_fields(db, actor, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))
