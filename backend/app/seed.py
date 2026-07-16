"""Seed sample data: tenant, roles, admin user, space, content types, entries,
and a brand-voice guideline document (embedded if Azure OpenAI is configured).

Run inside Docker:   docker compose exec backend python -m app.seed
Run locally:         cd backend && python -m app.seed

Idempotent: skips seeding if the demo tenant already exists.

Login afterwards with  admin@example.com / admin123
"""
import asyncio
from datetime import datetime, timezone

from sqlalchemy import select

from app.ai.ingestion import ingest_document
from app.core.security import hash_password
from app.database import async_session_maker, init_db
from app.models import (
    ContentType,
    Entry,
    EntryStatus,
    GuidelineDocument,
    Role,
    Space,
    Tenant,
    User,
)

ARTICLE_FIELDS = [
    {
        "id": "title",
        "name": "Title",
        "type": "text",
        "validations": {"required": True, "max_length": 120},
        "help_text": "Headline shown on the page and in listings.",
        "ai_hint": "A punchy headline, sentence case, no clickbait.",
    },
    {
        "id": "excerpt",
        "name": "Excerpt",
        "type": "text",
        "validations": {"max_length": 200},
        "help_text": "Short teaser used on listing pages.",
        "ai_hint": "One or two sentences summarizing the article.",
    },
    {
        "id": "body",
        "name": "Body",
        "type": "richtext",
        "validations": {"required": True},
        "help_text": "Main article content.",
        "ai_hint": "Well-structured HTML with h2 sections and short paragraphs.",
    },
    {
        "id": "seo_description",
        "name": "SEO Description",
        "type": "text",
        "validations": {"max_length": 160},
        "ai_hint": "Meta description for search engines, max 160 chars.",
    },
]

LANDING_FIELDS = [
    {
        "id": "hero_title",
        "name": "Hero Title",
        "type": "text",
        "validations": {"required": True, "max_length": 80},
        "ai_hint": "Bold value proposition, under 8 words.",
    },
    {
        "id": "hero_subtitle",
        "name": "Hero Subtitle",
        "type": "text",
        "validations": {"max_length": 200},
    },
    {
        "id": "cta_label",
        "name": "CTA Label",
        "type": "text",
        "validations": {"required": True, "max_length": 30},
        "ai_hint": "Action verb first, e.g. 'Start building'.",
    },
    {
        "id": "body",
        "name": "Body",
        "type": "richtext",
        "validations": {},
    },
]

BRAND_GUIDELINES = """\
# Acme Brand Voice & Editorial Guidelines

## Voice
Our voice is confident, warm, and plain-spoken. We write like a knowledgeable
colleague, not a salesperson. We prefer short sentences and concrete language.
Avoid superlatives like "revolutionary", "game-changing", or "best-in-class".

## Style rules
- Use sentence case for all headings and titles. Never Title Case.
- Use the Oxford comma.
- Numbers one through nine are spelled out; 10 and above use digits.
- Avoid the passive voice where an active construction is possible.
- Never use exclamation marks in headings; use at most one per page body.

## Terminology
- Our product is "Acme Platform" on first mention, then "the platform".
- Say "customers", not "users", in marketing copy.
- Say "sign in", never "log in" or "login" (as a verb).

## SEO
- Meta descriptions must be 150-160 characters and include the primary keyword.
- Titles should be under 60 characters where possible.
- Every article should have exactly one H1; sections use H2/H3.

## Legal & compliance
- Never promise specific uptime, revenue, or performance outcomes.
- Do not mention competitor names in published content.
- Claims with numbers must be attributable to a public source.
"""

ARTICLE_BODY_HTML = """\
<h2>Why structured content matters</h2>
<p>Structured content separates what you say from where it appears. Editors model
content once, and every channel — web, app, email — consumes the same source of truth.</p>
<h2>How the platform helps</h2>
<p>Acme Platform pairs a flexible content model with live preview, so editors see
exactly what they ship. Guideline-aware AI keeps every draft on brand.</p>
<ul>
<li>Model content types without deployments</li>
<li>Preview drafts in the real site layout</li>
<li>Generate and audit copy against your own guidelines</li>
</ul>
<p>Sign in to explore the sample workspace and try inline editing in the preview pane.</p>
"""


async def seed() -> None:
    await init_db()
    async with async_session_maker() as db:
        existing = (
            await db.execute(select(Tenant).where(Tenant.slug == "acme"))
        ).scalar_one_or_none()
        if existing:
            print("Seed data already present (tenant 'acme' exists) — nothing to do.")
            return

        tenant = Tenant(name="Acme Inc", slug="acme")
        db.add(tenant)
        await db.flush()

        admin_role = Role(tenant_id=tenant.id, name="admin", permissions=["*"])
        editor_role = Role(
            tenant_id=tenant.id,
            name="editor",
            permissions=["entries:read", "entries:write", "entries:publish", "ai:use"],
        )
        db.add_all([admin_role, editor_role])
        await db.flush()

        admin = User(
            tenant_id=tenant.id,
            email="admin@example.com",
            hashed_password=hash_password("admin123"),
            full_name="Admin",
            role_id=admin_role.id,
        )
        db.add(admin)

        space = Space(tenant_id=tenant.id, name="Marketing Site", slug="marketing")
        db.add(space)
        await db.flush()

        article_ct = ContentType(
            tenant_id=tenant.id,
            space_id=space.id,
            name="Article",
            api_id="article",
            description="Blog articles and announcements.",
            fields=ARTICLE_FIELDS,
        )
        landing_ct = ContentType(
            tenant_id=tenant.id,
            space_id=space.id,
            name="Landing Page",
            api_id="landing_page",
            description="Campaign landing pages.",
            fields=LANDING_FIELDS,
        )
        db.add_all([article_ct, landing_ct])
        await db.flush()

        published_fields = {
            "title": "Welcome to the Acme content platform",
            "excerpt": "A quick tour of structured content, live preview, and guideline-aware AI.",
            "body": ARTICLE_BODY_HTML,
            "seo_description": "See how Acme Platform combines structured content, live preview, and guideline-aware AI to help teams ship on-brand pages faster.",
        }
        published = Entry(
            tenant_id=tenant.id,
            space_id=space.id,
            content_type_id=article_ct.id,
            slug="welcome",
            status=EntryStatus.published.value,
            fields=published_fields,
            published_fields=dict(published_fields),
            published_at=datetime.now(timezone.utc),
            created_by=admin.id,
        )
        draft = Entry(
            tenant_id=tenant.id,
            space_id=space.id,
            content_type_id=article_ct.id,
            slug="drafting-with-ai",
            status=EntryStatus.draft.value,
            fields={
                "title": "Drafting with AI (work in progress)",
                "excerpt": "",
                "body": "<p>Use the AI sidebar to generate this article from a brief.</p>",
                "seo_description": "",
            },
            created_by=admin.id,
        )
        db.add_all([published, draft])

        guideline = GuidelineDocument(
            tenant_id=tenant.id,
            space_id=space.id,
            title="Acme brand voice & editorial guidelines",
            source_type="text",
            original_text=BRAND_GUIDELINES,
            content_types=[],  # applies to all content types
        )
        db.add(guideline)
        await db.commit()

        n_chunks = await ingest_document(db, guideline)
        await db.refresh(guideline)
        if guideline.status == "ingested":
            print(f"Guidelines ingested and embedded ({n_chunks} chunks).")
        else:
            print(
                f"Guidelines stored ({n_chunks} chunks) but NOT embedded "
                f"(status={guideline.status}). Configure Azure OpenAI and call "
                "POST /guidelines/{id}/ingest to embed."
            )

        print("Seed complete. Login: admin@example.com / admin123")
        print("Published sample: /content/article/welcome")


if __name__ == "__main__":
    asyncio.run(seed())
