import uuid
from typing import Any, Literal

from pydantic import BaseModel


class GenerateEntryRequest(BaseModel):
    content_type_id: uuid.UUID
    # Editorial brief, e.g. "Launch post for our new API rate-limit feature, upbeat tone".
    brief: str
    space_id: uuid.UUID | None = None
    environment_id: uuid.UUID | None = None
    # Target locale for the generated copy (defaults to the space's default locale).
    locale: str | None = None
    # Restrict generation to these field ids; empty = all fields in the content type.
    field_ids: list[str] = []


class GenerateEntryResponse(BaseModel):
    fields: dict[str, Any]
    # Guideline excerpts that were retrieved and injected into the prompt (transparency/debugging).
    guidelines_used: list[str] = []


TransformMode = Literal["rewrite", "shorten", "expand", "seo", "translate", "custom"]


class TransformFieldRequest(BaseModel):
    text: str
    mode: TransformMode = "rewrite"
    # Required when mode == "custom"; optional extra steering otherwise.
    # For mode == "translate", put the target locale here (e.g. "fr").
    instruction: str = ""
    # Optional context so RAG can scope guidelines and prompts know the field's role.
    content_type_id: uuid.UUID | None = None
    field_id: str | None = None
    entry_id: uuid.UUID | None = None
    locale: str | None = None


class TransformFieldResponse(BaseModel):
    text: str
    guidelines_used: list[str] = []


class ComplianceCheckRequest(BaseModel):
    # Either an entry_id (draft fields are checked) ...
    entry_id: uuid.UUID | None = None
    # ... or raw fields + content_type_id for unsaved content.
    content_type_id: uuid.UUID | None = None
    fields: dict[str, Any] | None = None
    locale: str | None = None


class ComplianceIssue(BaseModel):
    field_id: str
    severity: Literal["info", "warning", "error"]
    message: str
    guideline_excerpt: str = ""
    suggestion: str = ""


class ComplianceCheckResponse(BaseModel):
    passed: bool
    issues: list[ComplianceIssue] = []
    guidelines_used: list[str] = []


# --- AI helper endpoints ------------------------------------------------------


class SuggestTitlesRequest(BaseModel):
    body: str
    content_type_id: uuid.UUID | None = None
    count: int = 5
    locale: str | None = None


class SuggestTitlesResponse(BaseModel):
    titles: list[str]


class SeoMetaRequest(BaseModel):
    title: str = ""
    body: str
    content_type_id: uuid.UUID | None = None
    locale: str | None = None


class SeoMetaResponse(BaseModel):
    seo_title: str
    seo_description: str
    keywords: list[str] = []
    guidelines_used: list[str] = []


class TranslateFieldsRequest(BaseModel):
    """Translate a set of field values to a target locale, guideline-aware.

    fields: {field_id: value} in the source locale (plain values, not locale dicts).
    """

    content_type_id: uuid.UUID
    fields: dict[str, Any]
    source_locale: str
    target_locale: str


class TranslateFieldsResponse(BaseModel):
    fields: dict[str, Any]
    guidelines_used: list[str] = []


class AiStatusResponse(BaseModel):
    configured: bool
    provider: str
    chat_model: str = ""
    embeddings_enabled: bool = False
    # How guideline retrieval works right now: "vector" | "keyword" | "disabled"
    retrieval_mode: str = "disabled"
