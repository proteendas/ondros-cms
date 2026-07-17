"""Schemas for space settings: API keys, webhooks, roles, user management."""
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# --- API keys ---------------------------------------------------------------

ApiKeyTypeLiteral = Literal["delivery", "preview", "management"]


class ApiKeyCreate(BaseModel):
    name: str
    description: str = ""
    type: ApiKeyTypeLiteral = "delivery"
    # Environment ids the key may access; empty = all environments of the space.
    environment_ids: list[uuid.UUID] = []


class ApiKeyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    environment_ids: list[uuid.UUID] | None = None
    enabled: bool | None = None


class ApiKeyOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID
    name: str
    description: str
    type: str
    token_prefix: str
    environment_ids: list[uuid.UUID]
    read_only: bool
    enabled: bool
    last_used_at: datetime | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ApiKeyCreatedOut(ApiKeyOut):
    """Returned exactly once, on creation — the only time the full token is visible."""

    access_token: str = ""  # filled in by the handler after model_validate(orm_obj)


# --- Webhooks ----------------------------------------------------------------


class WebhookFilters(BaseModel):
    content_types: list[str] = []  # api_ids; empty = all
    environments: list[str] = []   # environment keys; empty = all


class WebhookCreate(BaseModel):
    name: str
    url: str = Field(pattern=r"^https?://")
    secret: str = ""
    enabled: bool = True
    events: list[str] = []  # empty = all events
    filters: WebhookFilters = WebhookFilters()
    headers: dict[str, str] = {}


class WebhookUpdate(BaseModel):
    name: str | None = None
    url: str | None = Field(default=None, pattern=r"^https?://")
    secret: str | None = None
    enabled: bool | None = None
    events: list[str] | None = None
    filters: WebhookFilters | None = None
    headers: dict[str, str] | None = None


class WebhookOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID
    name: str
    url: str
    enabled: bool
    events: list[str]
    filters: WebhookFilters
    headers: dict[str, str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class WebhookDeliveryOut(BaseModel):
    id: uuid.UUID
    webhook_id: uuid.UUID
    event: str
    payload: dict[str, Any]
    response_status: int | None
    response_body: str
    success: bool
    duration_ms: int
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Roles & assignments ------------------------------------------------------


class RoleOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    permissions: list[str]
    is_system: bool

    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str
    description: str = ""
    permissions: list[str] = []


class RoleUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class RoleAssignmentCreate(BaseModel):
    user_id: uuid.UUID
    role_id: uuid.UUID
    space_id: uuid.UUID | None = None  # None = organization-wide


class RoleAssignmentOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    role_id: uuid.UUID
    space_id: uuid.UUID | None
    role: RoleOut

    model_config = {"from_attributes": True}


class UserSummaryOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str
    is_active: bool
    assignments: list[RoleAssignmentOut] = []

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: str
    password: str = Field(min_length=8)
    full_name: str = ""
    role_id: uuid.UUID | None = None       # optional initial org-wide role
    space_id: uuid.UUID | None = None      # scope the initial role to a space


# --- Media -------------------------------------------------------------------


class MediaAssetOut(BaseModel):
    id: uuid.UUID
    space_id: uuid.UUID | None
    environment_id: uuid.UUID | None
    filename: str
    mime_type: str
    size_bytes: int
    url: str
    width: int | None
    height: int | None
    title: str
    description: str
    alt_text: str
    tags: list[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class MediaAssetUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    alt_text: str | None = None
    tags: list[str] | None = None


class MediaListOut(BaseModel):
    items: list[MediaAssetOut]
    total: int
    skip: int
    limit: int
