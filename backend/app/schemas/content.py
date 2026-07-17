"""Schemas for content types, entries, spaces and environments.

FieldDef is the single source of truth for what a "field" is. The editor's
Content Type Builder produces these, DynamicEntryForm consumes them, and the
AI prompt builder serializes them so generations respect the schema.

Field type catalog (Contentful mapping in parentheses):
  text            short single-line text        (Symbol / ShortText)
  longtext        multi-line plain text         (Text / LongText)
  richtext        HTML rich text                (RichText)
  number          int or float                  (Number)
  boolean                                        (Boolean)
  datetime        ISO-8601 string               (DateTime)
  select          one of allowed_values         (Enum)
  media           MediaAsset id                 (Link->Asset)
  media_many      ordered MediaAsset id list    (Array<Link->Asset>)
  reference       Entry id                      (Link->Entry)
  reference_many  ordered Entry id list — the "assembly" building block
  json            arbitrary JSON                (Object)
  slug            URL-safe string
  date            legacy alias of datetime (kept for old content models)

Localized fields (localized=True) store {locale_code: value} dicts in
Entry.fields; the delivery API resolves them via ?locale=.
"""
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

FieldType = Literal[
    "text",
    "longtext",
    "richtext",
    "number",
    "boolean",
    "datetime",
    "date",  # legacy alias of datetime
    "select",
    "media",
    "media_many",
    "reference",
    "reference_many",
    "json",
    "slug",
]

# Types whose stored value is an entry id (or list of ids) — used by
# reference-integrity validation and the delivery API's include resolver.
REFERENCE_TYPES = {"reference", "reference_many"}
MEDIA_TYPES = {"media", "media_many"}


class FieldValidations(BaseModel):
    required: bool = False
    min_length: int | None = None
    max_length: int | None = None
    pattern: str | None = None
    min: float | None = None
    max: float | None = None
    allowed_values: list[str] | None = None  # for "select"
    # For reference_many / media_many: bounds on the number of linked items.
    min_items: int | None = None
    max_items: int | None = None


class FieldDef(BaseModel):
    id: str = Field(pattern=r"^[a-z][a-z0-9_]*$", description="Machine name, used as key in Entry.fields")
    name: str
    type: FieldType = "text"
    localized: bool = False
    validations: FieldValidations = FieldValidations()
    # For reference / reference_many: content type api_ids allowed as targets.
    # Empty list = any content type in the environment.
    allowed_content_types: list[str] = []
    help_text: str = ""
    # Free-form hint injected into AI prompts, e.g. "Meta description, max 160 chars".
    ai_hint: str = ""


class ContentTypeCreate(BaseModel):
    name: str
    api_id: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    description: str = ""
    display_field: str = ""
    fields: list[FieldDef] = []


class ContentTypeUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    display_field: str | None = None
    fields: list[FieldDef] | None = None


class ContentTypeOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    space_id: uuid.UUID
    environment_id: uuid.UUID
    name: str
    api_id: str
    description: str
    display_field: str
    fields: list[FieldDef]
    created_at: datetime
    updated_at: datetime
    # Populated by the list endpoint (number of entries using this type).
    entry_count: int | None = None

    model_config = {"from_attributes": True}


class EntryCreate(BaseModel):
    content_type_id: uuid.UUID
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$")
    fields: dict[str, Any] = {}


class EntryUpdate(BaseModel):
    slug: str | None = None
    # Partial update: only provided keys are merged into Entry.fields.
    fields: dict[str, Any] | None = None


class TransitionRequest(BaseModel):
    status: Literal["draft", "in_review", "published", "archived"]


class BulkActionRequest(BaseModel):
    entry_ids: list[uuid.UUID]
    action: Literal["publish", "unpublish", "archive", "delete"]


class BulkActionResult(BaseModel):
    succeeded: list[uuid.UUID] = []
    failed: dict[str, str] = {}  # entry id -> error message


class EntryOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID
    space_id: uuid.UUID
    environment_id: uuid.UUID
    content_type_id: uuid.UUID
    slug: str
    status: str
    fields: dict[str, Any]
    published_fields: dict[str, Any] | None
    version: int
    created_by: uuid.UUID | None
    updated_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    published_at: datetime | None

    model_config = {"from_attributes": True}


class EntryListOut(BaseModel):
    items: list[EntryOut]
    total: int
    skip: int
    limit: int


# --- Spaces & environments -------------------------------------------------


class LocaleDef(BaseModel):
    code: str = Field(pattern=r"^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$")  # en, en-US, pt-BR
    name: str = ""


class SpaceCreate(BaseModel):
    name: str
    slug: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$")
    locales: list[LocaleDef] = [LocaleDef(code="en-US", name="English (US)")]
    default_locale: str = "en-US"


class SpaceUpdate(BaseModel):
    name: str | None = None
    locales: list[LocaleDef] | None = None
    default_locale: str | None = None


class EnvironmentOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID
    key: str
    name: str
    type: str
    is_default: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class SpaceOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    locales: list[LocaleDef]
    default_locale: str
    environments: list[EnvironmentOut] = []

    model_config = {"from_attributes": True}


class EnvironmentCreate(BaseModel):
    key: str = Field(pattern=r"^[a-z0-9][a-z0-9\-]*$", max_length=64)
    name: str
    type: Literal["master", "staging", "dev"] = "dev"
    # Clone content model and/or entries from an existing environment.
    clone_from_environment_id: uuid.UUID | None = None
    clone_content_types: bool = True
    clone_entries: bool = True


class EnvironmentCloneStats(BaseModel):
    content_types: int = 0
    entries: int = 0
