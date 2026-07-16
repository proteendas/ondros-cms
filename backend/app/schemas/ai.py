import uuid
from typing import Any, Literal

from pydantic import BaseModel


class GenerateEntryRequest(BaseModel):
    content_type_id: uuid.UUID
    # Editorial brief, e.g. "Launch post for our new API rate-limit feature, upbeat tone".
    brief: str
    space_id: uuid.UUID | None = None
    # Restrict generation to these field ids; empty = all fields in the content type.
    field_ids: list[str] = []


class GenerateEntryResponse(BaseModel):
    fields: dict[str, Any]
    # Guideline excerpts that were retrieved and injected into the prompt (transparency/debugging).
    guidelines_used: list[str] = []


TransformMode = Literal["rewrite", "shorten", "expand", "seo", "custom"]


class TransformFieldRequest(BaseModel):
    text: str
    mode: TransformMode = "rewrite"
    # Required when mode == "custom"; optional extra steering otherwise.
    instruction: str = ""
    # Optional context so RAG can scope guidelines and prompts know the field's role.
    content_type_id: uuid.UUID | None = None
    field_id: str | None = None
    entry_id: uuid.UUID | None = None


class TransformFieldResponse(BaseModel):
    text: str
    guidelines_used: list[str] = []


class ComplianceCheckRequest(BaseModel):
    # Either an entry_id (draft fields are checked) ...
    entry_id: uuid.UUID | None = None
    # ... or raw fields + content_type_id for unsaved content.
    content_type_id: uuid.UUID | None = None
    fields: dict[str, Any] | None = None


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
