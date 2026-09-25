"""Schemas for Ondros Code Sync (spec 020)."""
import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class RepositoryOut(BaseModel):
    fullName: str
    name: str
    private: bool = False
    defaultBranch: str = "main"
    htmlUrl: str = ""
    owner: str = ""


class ManifestComponent(BaseModel):
    id: str
    title: str
    contentType: str
    block: str = ""
    template: str = ""
    fields: list[dict] = []
    source: str = ""


class ManifestOut(BaseModel):
    previewUrl: str = ""
    routes: dict[str, str] = {}
    components: list[ManifestComponent] = []


class ConnectionOut(BaseModel):
    """What the editor needs to render the Code Sync panel and the preview."""

    id: uuid.UUID
    space_id: uuid.UUID
    provider: str
    installation_id: str
    account_login: str
    repo_full_name: str
    branch: str
    preview_base_url: str
    # The site copies this into ONDROS_PREVIEW_SECRET to verify preview
    # tickets. Only ever returned to an authenticated space admin.
    preview_secret: str = ""
    manifest: ManifestOut
    manifest_source: str
    manifest_path: str
    status: str
    last_error: str
    last_synced_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CodeSyncStateOut(BaseModel):
    """Whole-feature state — answers "can this space preview at all?".

    ``connected`` false with ``configured`` false means the *server* has no
    GitHub App set up, which is a different problem from a space that simply
    hasn't connected a repository yet; the editor says so differently.
    """

    connected: bool
    configured: bool
    mode: str  # app | token | none
    install_url: str = ""
    app_slug: str = ""
    connection: ConnectionOut | None = None


class ConnectRequest(BaseModel):
    repo_full_name: str = Field(pattern=r"^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")
    branch: str = Field(default="main", min_length=1, max_length=200)
    # Overrides the manifest's previewUrl; useful for branch deploys.
    preview_base_url: str = ""
    installation_id: str = ""


class UpdateConnectionRequest(BaseModel):
    branch: str | None = None
    preview_base_url: str | None = None


class SyncResult(BaseModel):
    status: str
    manifest_source: str = ""
    manifest_path: str = ""
    components: int = 0
    # Content types in this environment with no component to render them, and
    # components pointing at a content type that doesn't exist. Surfaced in the
    # editor because they are the two ways a preview silently renders nothing.
    unmapped_content_types: list[str] = []
    unknown_content_types: list[str] = []
    error: str = ""


class PreviewTargetOut(BaseModel):
    """Where the editor should point the preview iframe for one entry.

    mode:
      page       the entry is a page; ``url`` renders it on the project's site
      component  the entry is a block; ``url`` is a page that references it and
                 ``focus_entry_id`` tells the bridge which component to reveal
      orphan     a block that no page references yet — nothing can render it
      unroutable a page whose slug is still blank
    """

    mode: str
    url: str = ""
    path: str = ""
    content_type: str = ""
    component_id: str = ""
    focus_entry_id: str = ""
    host_entry_id: str = ""
    host_title: str = ""
    message: str = ""
    # Short-lived signed ticket authorizing the site to render drafts. Empty
    # for modes with no URL, and for a connection with no secret yet.
    preview_token: str = ""


class DeliveryCodeSyncOut(BaseModel):
    """Public (API-key authenticated) view used by a connected site's bridge."""

    connected: bool
    previewUrl: str = ""
    routes: dict[str, str] = {}
    components: list[ManifestComponent] = []
