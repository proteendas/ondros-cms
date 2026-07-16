import uuid
from datetime import datetime

from pydantic import BaseModel


class GuidelineCreate(BaseModel):
    title: str
    text: str
    space_id: uuid.UUID | None = None
    # Content type api_ids this guideline applies to; empty list = applies to all.
    content_types: list[str] = []


class GuidelineOut(BaseModel):
    id: uuid.UUID
    title: str
    source_type: str
    status: str
    content_types: list
    space_id: uuid.UUID | None
    created_at: datetime
    chunk_count: int = 0

    model_config = {"from_attributes": True}


class GuidelineSearchHit(BaseModel):
    document_id: uuid.UUID
    document_title: str
    chunk_index: int
    text: str
    distance: float | None = None
