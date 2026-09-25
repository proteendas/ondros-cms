"""The slug-as-a-field migration must not cost an existing site its URLs.

Before this change every entry carried a mandatory `slug` column with nothing
in the content model behind it. The backfill in app.migrations gives those
types a real `slug` field and copies each entry's slug into it, so authors can
keep editing the value and routes keep resolving.
"""
import uuid

import pytest
from sqlalchemy import select, text

from app.migrations import BACKFILL_STATEMENTS, DDL_STATEMENTS
from app.models import ContentType, Entry

pytestmark = pytest.mark.asyncio

LEGACY_FIELDS = [
    {"id": "title", "name": "Title", "type": "text", "validations": {"required": True}},
]


async def _run_migrations(db) -> None:
    for stmt in DDL_STATEMENTS + BACKFILL_STATEMENTS:
        try:
            async with db.begin_nested():
                await db.execute(text(stmt))
        except Exception:  # mirrors run_dev_migrations' per-statement tolerance
            pass


async def test_backfill_turns_legacy_slugs_into_a_slug_field(db_maker, workspace):
    ws = workspace
    async with db_maker() as db:
        legacy = ContentType(
            tenant_id=ws["tenant"].id, space_id=ws["space"].id,
            environment_id=ws["master"].id, name="Legacy Page", api_id=f"legacy_{uuid.uuid4().hex[:6]}",
            display_field="title", fields=list(LEGACY_FIELDS),
        )
        db.add(legacy)
        await db.flush()
        entry = Entry(
            tenant_id=ws["tenant"].id, space_id=ws["space"].id,
            environment_id=ws["master"].id, content_type_id=legacy.id,
            slug="about-us", status="published",
            fields={"title": "About us"}, published_fields={"title": "About us"},
        )
        db.add(entry)
        await db.commit()
        legacy_id, entry_id = legacy.id, entry.id

    async with db_maker() as db:
        await _run_migrations(db)
        await db.commit()

    async with db_maker() as db:
        ct = (await db.execute(select(ContentType).where(ContentType.id == legacy_id))).scalar_one()
        migrated = (await db.execute(select(Entry).where(Entry.id == entry_id))).scalar_one()

    # The type now models the slug the entries already had...
    assert ct.slug_field == "slug"
    # ...the value is editable as a field, in both the draft and published copy...
    assert migrated.fields["slug"] == "about-us"
    assert migrated.published_fields["slug"] == "about-us"
    # ...and the route is unchanged.
    assert migrated.slug == "about-us"


async def test_backfill_leaves_a_type_with_no_slugged_entries_alone(db_maker, workspace):
    ws = workspace
    async with db_maker() as db:
        block = ContentType(
            tenant_id=ws["tenant"].id, space_id=ws["space"].id,
            environment_id=ws["master"].id, name="Legacy Block",
            api_id=f"legacyblock_{uuid.uuid4().hex[:6]}", display_field="title",
            fields=list(LEGACY_FIELDS),
        )
        db.add(block)
        await db.commit()
        block_id = block.id

    async with db_maker() as db:
        await _run_migrations(db)
        await db.commit()

    async with db_maker() as db:
        ct = (await db.execute(select(ContentType).where(ContentType.id == block_id))).scalar_one()
    assert ct.slug_field is None
