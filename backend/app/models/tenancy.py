"""Multi-tenancy models: Tenant (organization) -> Spaces -> Environments, plus
Users, Roles and scoped role assignments.

Hierarchy (Contentful-style):
  Tenant (organization)
    └── Space ("Marketing Site")
          └── Environment ("master", "staging", ...)

Every content row carries tenant_id + space_id + environment_id so queries can
always be scoped. Roles are assigned to users either org-wide or per space via
UserRoleAssignment; capability checks live in app.core.permissions.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at_col, uuid_pk

DEFAULT_LOCALES = [{"code": "en-US", "name": "English (US)"}]


class Tenant(Base):
    """The organization. Multi-org installs create one Tenant per org."""

    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    # Platform-level lifecycle (spec 013): suspended accounts are blocked on
    # every API plane (management, delivery, preview) with 403 account_suspended.
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | suspended
    created_at: Mapped[datetime] = created_at_col()


class Role(Base):
    """Named bundle of capability strings (see app.core.permissions.Capability).

    ``permissions`` example: ["manage_entries", "publish_entries"] or ["*"].
    ``is_system`` roles (ORG_ADMIN, SPACE_ADMIN, EDITOR, AUTHOR, VIEWER) are
    seeded per tenant and cannot be deleted from the UI.
    """

    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("tenant_id", "name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(Text, default="")
    permissions: Mapped[list] = mapped_column(JSONB, default=list)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    # Platform operators (spec 013): grants /platform/* access. Not tied to
    # any Account — orthogonal to tenant roles.
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at_col()

    # All role assignments (org-level and space-level). Loaded eagerly because
    # permission checks need them on every authenticated request.
    assignments: Mapped[list["UserRoleAssignment"]] = relationship(
        back_populates="user", lazy="selectin", cascade="all, delete-orphan"
    )


class UserRoleAssignment(Base):
    """Grants a Role to a User either org-wide (space_id NULL) or for one Space."""

    __tablename__ = "user_role_assignments"
    __table_args__ = (UniqueConstraint("user_id", "role_id", "space_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), index=True)
    # NULL = organization-wide assignment.
    space_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("spaces.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = created_at_col()

    user: Mapped[User] = relationship(back_populates="assignments")
    role: Mapped[Role] = relationship(lazy="joined")


class Space(Base):
    __tablename__ = "spaces"
    __table_args__ = (UniqueConstraint("tenant_id", "slug"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(100))
    # Locales available for localized fields: [{"code": "en-US", "name": "..."}]
    locales: Mapped[list] = mapped_column(JSONB, default=lambda: list(DEFAULT_LOCALES))
    default_locale: Mapped[str] = mapped_column(String(20), default="en-US")
    created_at: Mapped[datetime] = created_at_col()

    environments: Mapped[list["Environment"]] = relationship(
        back_populates="space", lazy="selectin", cascade="all, delete-orphan"
    )


class Locale(Base):
    """First-class locale rows per space (source of truth).

    `spaces.locales` / `spaces.default_locale` remain as a denormalized cache
    for read paths; app.api.locales.sync_space_locale_cache rebuilds them
    after every mutation. `fallback_locale_id` forms per-locale fallback
    chains used by the delivery API (cycle-safe walk).
    """

    __tablename__ = "locales"
    __table_args__ = (UniqueConstraint("space_id", "code"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(20))  # en-US, hi-IN, fr-FR ...
    name: Mapped[str] = mapped_column(String(100), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    fallback_locale_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("locales.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = created_at_col()


class Environment(Base):
    """Isolated content branch within a space (master / staging / dev).

    Content types AND entries are environment-scoped, so cloning an
    environment copies the content model and the content (Contentful model).
    ``key`` is the stable identifier used in API paths, e.g. "master".
    """

    __tablename__ = "environments"
    __table_args__ = (UniqueConstraint("space_id", "key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    space_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("spaces.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(64))  # "master", "staging", "dev-jane"
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(20), default="dev")  # master | staging | dev
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at_col()

    space: Mapped[Space] = relationship(back_populates="environments")
