"""Import every model so `Base.metadata` knows the full schema."""
from app.models.base import Base
from app.models.tenancy import Environment, Locale, Role, Space, Tenant, User, UserRoleAssignment
from app.models.accounts import (
    AccountMember,
    ActionToken,
    ActionTokenPurpose,
    Invitation,
    InvitationStatus,
    RefreshToken,
)
from app.models.content import ContentType, Entry, EntryStatus, MediaAsset
from app.models.api_keys import ApiKey, ApiKeyType
from app.models.webhooks import Webhook, WebhookDelivery
from app.models.sso import SSOConfig
from app.models.billing import Plan, Subscription, UsageCounter
from app.models.audit import AuditLog, EntryVersion
from app.models.guidelines import GuidelineChunk, GuidelineDocument

__all__ = [
    "Base",
    "Tenant",
    "User",
    "Role",
    "UserRoleAssignment",
    "Space",
    "Locale",
    "Environment",
    "AccountMember",
    "Invitation",
    "InvitationStatus",
    "RefreshToken",
    "ActionToken",
    "ActionTokenPurpose",
    "ContentType",
    "Entry",
    "EntryStatus",
    "MediaAsset",
    "ApiKey",
    "ApiKeyType",
    "Webhook",
    "WebhookDelivery",
    "SSOConfig",
    "Plan",
    "Subscription",
    "UsageCounter",
    "AuditLog",
    "EntryVersion",
    "GuidelineDocument",
    "GuidelineChunk",
]
