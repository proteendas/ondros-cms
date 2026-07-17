"""Capability catalog + built-in role presets.

A Role stores a list of capability strings (or ["*"] for everything).
Users get roles via UserRoleAssignment either org-wide (space_id NULL) or per
space. `user_capabilities(user, space_id)` computes the effective set for a
request; FastAPI dependencies in app.api.deps enforce it.
"""
import enum
import uuid

from app.models import User


class Capability(str, enum.Enum):
    MANAGE_CONTENT_TYPES = "manage_content_types"
    MANAGE_ENTRIES = "manage_entries"          # create / edit / delete drafts
    PUBLISH_ENTRIES = "publish_entries"        # publish / unpublish / archive
    MANAGE_MEDIA = "manage_media"
    MANAGE_SETTINGS = "manage_settings"        # space settings, locales
    MANAGE_ENVIRONMENTS = "manage_environments"
    MANAGE_API_KEYS = "manage_api_keys"
    MANAGE_WEBHOOKS = "manage_webhooks"
    MANAGE_USERS = "manage_users"              # org-level: users + role assignments
    MANAGE_SPACES = "manage_spaces"            # org-level: create/delete spaces
    USE_AI = "use_ai"
    READ_CONTENT = "read_content"


# Built-in roles seeded per tenant. Contentful-spirit: org admin > space admin
# > editor (can publish) > author (drafts only) > viewer (read only).
SYSTEM_ROLES: dict[str, dict] = {
    "ORG_ADMIN": {
        "description": "Full access to the organization, all spaces and settings.",
        "permissions": ["*"],
    },
    "SPACE_ADMIN": {
        "description": "Full control of assigned spaces: model, content, settings, keys.",
        "permissions": [
            Capability.MANAGE_CONTENT_TYPES.value,
            Capability.MANAGE_ENTRIES.value,
            Capability.PUBLISH_ENTRIES.value,
            Capability.MANAGE_MEDIA.value,
            Capability.MANAGE_SETTINGS.value,
            Capability.MANAGE_ENVIRONMENTS.value,
            Capability.MANAGE_API_KEYS.value,
            Capability.MANAGE_WEBHOOKS.value,
            Capability.USE_AI.value,
            Capability.READ_CONTENT.value,
        ],
    },
    "EDITOR": {
        "description": "Create, edit and publish content and media.",
        "permissions": [
            Capability.MANAGE_ENTRIES.value,
            Capability.PUBLISH_ENTRIES.value,
            Capability.MANAGE_MEDIA.value,
            Capability.USE_AI.value,
            Capability.READ_CONTENT.value,
        ],
    },
    "AUTHOR": {
        "description": "Create and edit drafts; cannot publish.",
        "permissions": [
            Capability.MANAGE_ENTRIES.value,
            Capability.MANAGE_MEDIA.value,
            Capability.USE_AI.value,
            Capability.READ_CONTENT.value,
        ],
    },
    "VIEWER": {
        "description": "Read-only access to content.",
        "permissions": [Capability.READ_CONTENT.value],
    },
}


def user_capabilities(
    user: User, space_id: uuid.UUID | None = None, account_id: uuid.UUID | None = None
) -> set[str]:
    """Effective capability set for a user in the context of one space.

    Org-wide assignments always apply; space assignments apply when the
    request targets that space (or when no space context is given, e.g.
    listing spaces the user can see). When `account_id` is given (multi-account
    users), only roles belonging to that account count.
    """
    caps: set[str] = set()
    for a in user.assignments:
        if account_id is not None and a.role.tenant_id != account_id:
            continue
        if a.space_id is None or space_id is None or a.space_id == space_id:
            caps.update(a.role.permissions or [])
    return caps


def has_capability(user: User, capability: str, space_id: uuid.UUID | None = None) -> bool:
    caps = user_capabilities(user, space_id)
    return "*" in caps or capability in caps


def accessible_space_ids(user: User) -> list[uuid.UUID] | None:
    """Space ids the user may touch. None = all spaces in the tenant (org-wide role)."""
    if any(a.space_id is None for a in user.assignments):
        return None
    return sorted({a.space_id for a in user.assignments if a.space_id is not None})
