"""SSO configuration per account (OIDC now, SAML surface reserved).

One row per identity provider. `email_domain` restricts which addresses may
authenticate through (and be JIT-provisioned by) this config; `enforced`
blocks password login for that domain entirely.
"""
import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, created_at_col, updated_at_col, uuid_pk


class SSOConfig(Base):
    __tablename__ = "sso_configs"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    provider_type: Mapped[str] = mapped_column(String(10), default="oidc")  # oidc | saml
    name: Mapped[str] = mapped_column(String(200), default="")  # "Okta", "Entra ID"...
    # --- OIDC ---
    discovery_url: Mapped[str] = mapped_column(String(1000), default="")
    client_id: Mapped[str] = mapped_column(String(500), default="")
    # NOTE: plaintext for the MVP; wrap with KMS/fernet before production (spec 002).
    client_secret: Mapped[str] = mapped_column(String(500), default="")
    # --- SAML (runtime requires python3-saml; see app/api/sso.py) ---
    metadata_xml: Mapped[str] = mapped_column(Text, default="")
    # --- Behavior ---
    email_domain: Mapped[str] = mapped_column(String(255), default="", index=True)  # "" = any
    default_role_name: Mapped[str] = mapped_column(String(100), default="EDITOR")  # JIT role
    enforced: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()
