"""Ondros Code Sync: the link between a space and the GitHub repository that
renders its site.

The editor's preview works the way Adobe's Universal Editor does — it does not
render content itself, it loads the *project's own site* in an iframe and edits
it in place. To do that it needs three things from the repo, which this row
holds:

  1. which repository/branch is the source of truth (``repo_full_name``),
  2. where that project is deployed (``preview_base_url``), so a page can be
     opened at its real URL,
  3. the component manifest (``manifest``) that says which block renders which
     content type, and how each content type's entries map onto routes.

``manifest`` is the *normalized* form produced by app.core.code_sync from
whichever manifest the repo happens to ship (Ondros or AEM Universal Editor
flavored); ``manifest_source`` records which one it came from.
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, updated_at_col, uuid_pk


class CodeSyncStatus(str):
    """Not an enum column on purpose — new states shouldn't need a migration."""

    pending = "pending"      # app installed, no repository chosen yet
    connected = "connected"  # repository chosen and manifest synced
    error = "error"          # last sync failed; see last_error


class CodeSyncConnection(Base):
    __tablename__ = "code_sync_connections"
    # One repository per space: the space's site is one project.
    __table_args__ = (UniqueConstraint("space_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)

    provider: Mapped[str] = mapped_column(String(30), default="github")
    # GitHub App installation that grants access. Empty when the deployment is
    # running on the personal-access-token dev fallback.
    installation_id: Mapped[str] = mapped_column(String(50), default="")
    account_login: Mapped[str] = mapped_column(String(200), default="")
    repo_full_name: Mapped[str] = mapped_column(String(300), default="")
    branch: Mapped[str] = mapped_column(String(200), default="main")

    # Where the project is deployed. The manifest may declare it; an explicit
    # value set in the editor wins, because branch deploys move around.
    preview_base_url: Mapped[str] = mapped_column(String(500), default="")

    # Normalized manifest: {"routes": {...}, "components": [...], ...}
    manifest: Mapped[dict] = mapped_column(JSONB, default=dict)
    manifest_source: Mapped[str] = mapped_column(String(30), default="")  # ondros | aem | ""
    manifest_path: Mapped[str] = mapped_column(String(300), default="")

    status: Mapped[str] = mapped_column(String(20), default=CodeSyncStatus.pending, index=True)
    last_error: Mapped[str] = mapped_column(Text, default="")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    @property
    def is_connected(self) -> bool:
        return bool(self.repo_full_name) and self.status == CodeSyncStatus.connected

    @property
    def components_by_content_type(self) -> dict[str, dict]:
        return {
            c["contentType"]: c
            for c in (self.manifest or {}).get("components", [])
            if c.get("contentType")
        }
