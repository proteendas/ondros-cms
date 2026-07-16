"""AI endpoints: guideline-aware generation, transformation, compliance.

Thin HTTP layer over app.ai.services — keep business logic there.
All endpoints require auth; they return 503 until Azure OpenAI is configured.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import AIConfigurationError
from app.ai.services import check_compliance, generate_entry_fields, transform_field
from app.api.deps import get_current_user
from app.database import get_db
from app.models import User
from app.schemas.ai import (
    ComplianceCheckRequest,
    ComplianceCheckResponse,
    GenerateEntryRequest,
    GenerateEntryResponse,
    TransformFieldRequest,
    TransformFieldResponse,
)

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/generate-entry", response_model=GenerateEntryResponse)
async def generate_entry(
    req: GenerateEntryRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Generate values for all (or selected) fields of a content type from a brief.
    Retrieves matching guidelines from pgvector and injects them into the prompt.
    """
    try:
        return await generate_entry_fields(db, user, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/transform-field", response_model=TransformFieldResponse)
async def transform(
    req: TransformFieldRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Rewrite / shorten / expand / SEO-optimize a single field value."""
    try:
        return await transform_field(db, user, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.post("/check-compliance", response_model=ComplianceCheckResponse)
async def compliance(
    req: ComplianceCheckRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Audit an entry (or raw fields) against ingested brand/editorial guidelines."""
    try:
        return await check_compliance(db, user, req)
    except AIConfigurationError as e:
        raise HTTPException(status_code=503, detail=str(e))
