"""Schemas for content types and entries.

FieldDef is the single source of truth for what a "field" is. The editor's
Content Type Builder produces these, DynamicEntryForm consumes them, and the
AI prompt builder serializes them so generations respect the schema.
Add a new field type by extending FieldType here and adding a renderer in
editor/src/components/DynamicEntryForm.tsx and preview EntryRenderer.
"""
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

FieldType = Literal[
    "text", "richtext", "number", "boolean", "date", "media", "reference", "slug", "select"
]


class FieldValidations(BaseModel):
    required: bool = False
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    min: float | None = None
    max: float | None = None
    allowed_values: list[str] | None = None  # for "select"


class FieldDef(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$", description="Machine name, used as key in Entry.fields")
    name: str
    type: FieldType = "text"
    validations: FieldValidations = FieldValidations()
    help_text: str = ""
    # Free-form hint injected into AI prompts, e.g. "Meta description, max 160 chars".
    ai_hint: str = ""


class ContentTypeCreate(BaseModel):
    name: str
    api_id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    space_id: uuid.UUID
    description: str = ""
    fields: list[FieldDef] = []


class ContentTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    fields: list[FieldDef] | None = None


class ContentTypeOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    space_id: uuid.UUID
    name: str
    api_id: str
    description: str
    fields: list[FieldDef]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EntryCreate(BaseModel):
    content_type_id: uuid.UUID
    space_id: uuid.UUID
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$")
    fields: dict[str, Any] = {}


class EntryUpdate(BaseModel):
    slug: str | None = None
    # Partial update: only provided keys are merged into Entry.fields.
    fields: dict[str, Any] | None = None


class TransitionRequest(BaseModel):
    status: Literal["draft", "in_review", "published", "archived"]


class EntryOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    space_id: uuid.UUID
    content_type_id: uuid.UUID
    slug: str
    status: str
    fields: dict[str, Any]
    published_fields: dict[str, Any] | None
    version: int
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None

    model_config = {"from_attributes": True}


class SpaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str

    model_config = {"from_attributes": True}
