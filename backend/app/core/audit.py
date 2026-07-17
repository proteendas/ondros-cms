"""Audit trail + entry version snapshots (spec 006).

`record_audit` / `snapshot_entry` ADD rows to the caller's session — they
piggyback on the endpoint's own commit so audit rows are transactional with
the change they describe.
"""
import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, Entry, EntryVersion

VERSIONS_KEPT = 50


def _actor_fields(actor: Any) -> tuple[uuid.UUID | None, str]:
    """Duck-typed on app.api.deps.Actor to avoid a circular import."""
    if actor is None:
        return None, "system"
    user = getattr(actor, "user", None)
    if user is not None:
        return user.id, user.email
    api_key = getattr(actor, "api_key", None)
    if api_key is not None:
        return None, f"api-key: {api_key.name}"
    return None, "system"


def field_diff(before: dict | None, after: dict | None) -> dict:
    """Shallow per-key diff of two field dicts: {key: {"from": ..., "to": ...}}."""
    before, after = before or {}, after or {}
    diff: dict[str, dict] = {}
    for key in set(before) | set(after):
        if before.get(key) != after.get(key):
            diff[key] = {"from": before.get(key), "to": after.get(key)}
    return diff


def record_audit(
    db: AsyncSession,
    actor: Any,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | str | None = None,
    diff: dict | None = None,
    space_id: uuid.UUID | None = None,
    tenant_id: uuid.UUID | None = None,
) -> None:
    actor_id, actor_label = _actor_fields(actor)
    db.add(
        AuditLog(
            tenant_id=tenant_id or getattr(actor, "tenant_id", None),
            space_id=space_id,
            actor_id=actor_id,
            actor_label=actor_label,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id or ""),
            diff=diff or {},
        )
    )


async def snapshot_entry(db: AsyncSession, entry: Entry, actor: Any) -> None:
    """Store the entry's CURRENT state as an immutable version snapshot.

    Call BEFORE mutating + bumping entry.version, so snapshot.version matches
    the state it captures. Prunes to the most recent VERSIONS_KEPT."""
    existing = (
        await db.execute(
            select(EntryVersion.id).where(
                EntryVersion.entry_id == entry.id, EntryVersion.version == entry.version
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(
            EntryVersion(
                entry_id=entry.id,
                version=entry.version,
                slug=entry.slug,
                status=entry.status,
                fields=dict(entry.fields or {}),
                created_by=getattr(actor, "user_id", None),
            )
        )

    old_ids = (
        await db.execute(
            select(EntryVersion.id)
            .where(EntryVersion.entry_id == entry.id)
            .order_by(EntryVersion.version.desc())
            .offset(VERSIONS_KEPT)
        )
    ).scalars().all()
    if old_ids:
        await db.execute(delete(EntryVersion).where(EntryVersion.id.in_(old_ids)))
