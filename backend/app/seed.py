"""Seed sample data: tenant, system roles, users, space (en-US + fr locales),
master environment, an assembly-style content model (landing page -> hero +
feature cards), entries with references + localization, API keys, and a
brand-voice guideline document (embedded when the AI provider supports it).

Run inside Docker:   docker compose exec backend python -m app.seed
Run locally:         cd backend && python -m app.seed

Idempotent: skips seeding if the demo tenant already exists.

Login afterwards with  admin@example.com / admin123  (org admin)
                       editor@example.com / editor123 (space editor)

DEV ONLY: the seeded API keys use deterministic tokens (overridable via
SEED_DELIVERY_TOKEN / SEED_PREVIEW_TOKEN env vars) so docker-compose can wire
the preview app automatically. Rotate them for anything public.
"""
import asyncio
import os
from datetime import datetime, timezone

from sqlalchemy import select

from app.ai.ingestion import ingest_document
from app.core.permissions import SYSTEM_ROLES
from app.core.security import hash_api_token, hash_password
from app.database import async_session_maker, init_db
from app.core.usage import DEFAULT_PLANS
from app.models import (
    AccountMember,
    ApiKey,
    ContentType,
    Entry,
    EntryStatus,
    Environment,
    GuidelineDocument,
    Locale,
    Plan,
    Role,
    Space,
    Tenant,
    User,
    UserRoleAssignment,
)

DEV_DELIVERY_TOKEN = os.environ.get("SEED_DELIVERY_TOKEN", "cms_del_dev-delivery-token-0000")
DEV_PREVIEW_TOKEN = os.environ.get("SEED_PREVIEW_TOKEN", "cms_pre_dev-preview-token-0000")

HERO_FIELDS = [
    {"id": "heading", "name": "Heading", "type": "text", "localized": True,
     "validations": {"required": True, "max_length": 80},
     "ai_hint": "Bold value proposition, under 8 words."},
    {"id": "subheading", "name": "Subheading", "type": "text", "localized": True,
     "validations": {"max_length": 200}},
    {"id": "cta_label", "name": "CTA Label", "type": "text",
     "validations": {"required": True, "max_length": 30},
     "ai_hint": "Action verb first, e.g. 'Start building'."},
    {"id": "image", "name": "Background Image", "type": "media"},
]

CARD_FIELDS = [
    {"id": "title", "name": "Title", "type": "text", "localized": True,
     "validations": {"required": True, "max_length": 60}},
    {"id": "body", "name": "Body", "type": "longtext", "localized": True,
     "validations": {"max_length": 400}},
    {"id": "icon", "name": "Icon name", "type": "select",
     "validations": {"allowed_values": ["zap", "shield", "globe", "layers", "sparkles"]}},
]

LANDING_FIELDS = [
    {"id": "title", "name": "Page Title", "type": "text",
     "validations": {"required": True, "max_length": 120}},
    {"id": "hero", "name": "Hero", "type": "reference", "allowed_content_types": ["hero"],
     "help_text": "The hero section shown at the top of the page."},
    {"id": "sections", "name": "Feature Cards", "type": "reference_many",
     "allowed_content_types": ["card"],
     "validations": {"max_items": 6},
     "help_text": "Ordered feature cards rendered below the hero."},
    {"id": "seo_description", "name": "SEO Description", "type": "text",
     "validations": {"max_length": 160},
     "ai_hint": "Meta description for search engines, max 160 chars."},
]

ARTICLE_FIELDS = [
    {"id": "title", "name": "Title", "type": "text", "localized": True,
     "validations": {"required": True, "max_length": 120},
     "help_text": "Headline shown on the page and in listings.",
     "ai_hint": "A punchy headline, sentence case, no clickbait."},
    {"id": "excerpt", "name": "Excerpt", "type": "text", "localized": True,
     "validations": {"max_length": 200},
     "help_text": "Short teaser used on listing pages.",
     "ai_hint": "One or two sentences summarizing the article."},
    {"id": "body", "name": "Body", "type": "richtext", "localized": True,
     "validations": {"required": True},
     "help_text": "Main article content.",
     "ai_hint": "Well-structured HTML with h2 sections and short paragraphs."},
    {"id": "published_date", "name": "Publish Date", "type": "datetime"},
    {"id": "seo_description", "name": "SEO Description", "type": "text",
     "validations": {"max_length": 160},
     "ai_hint": "Meta description for search engines, max 160 chars."},
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

## Localization
- French copy uses the informal "vous" for business audiences.
- Keep product names in English in all locales.

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

ARTICLE_BODY_HTML_FR = """\
<h2>Pourquoi le contenu structuré compte</h2>
<p>Le contenu structuré sépare ce que vous dites de l'endroit où cela apparaît.
Les éditeurs modélisent le contenu une seule fois, et chaque canal consomme la
même source de vérité.</p>
<h2>Comment la plateforme vous aide</h2>
<p>Acme Platform associe un modèle de contenu flexible à un aperçu en direct.</p>
"""


async def seed_plans(db) -> None:
    """Idempotent: create the built-in plans if the table is empty."""
    if (await db.execute(select(Plan))).scalars().first() is not None:
        return
    for i, (key, preset) in enumerate(DEFAULT_PLANS.items()):
        db.add(Plan(key=key, name=preset["name"], price_month_usd=preset["price_month_usd"],
                    limits=preset["limits"], position=i))
    await db.commit()
    print(f"Plans seeded: {', '.join(DEFAULT_PLANS)}")


async def seed() -> None:
    await init_db()
    async with async_session_maker() as db:
        await seed_plans(db)
        existing = (
            await db.execute(select(Tenant).where(Tenant.slug == "acme"))
        ).scalar_one_or_none()
        if existing:
            print("Seed data already present (tenant 'acme' exists) — nothing to do.")
            return

        tenant = Tenant(name="Acme Inc", slug="acme")
        db.add(tenant)
        await db.flush()

        # System roles
        roles: dict[str, Role] = {}
        for name, preset in SYSTEM_ROLES.items():
            role = Role(
                tenant_id=tenant.id,
                name=name,
                description=preset["description"],
                permissions=preset["permissions"],
                is_system=True,
            )
            db.add(role)
            roles[name] = role
        await db.flush()

        # Space with two locales + master environment
        space = Space(
            tenant_id=tenant.id,
            name="Marketing Site",
            slug="marketing",
            locales=[
                {"code": "en-US", "name": "English (US)"},
                {"code": "fr", "name": "French"},
            ],
            default_locale="en-US",
        )
        db.add(space)
        await db.flush()

        master = Environment(
            tenant_id=tenant.id, space_id=space.id,
            key="master", name="Master", type="master", is_default=True,
        )
        db.add(master)
        await db.flush()

        # First-class locale rows (spaces.locales stays as the synced cache).
        db.add_all([
            Locale(tenant_id=tenant.id, space_id=space.id, code="en-US",
                   name="English (US)", is_default=True, position=0),
            Locale(tenant_id=tenant.id, space_id=space.id, code="fr",
                   name="French", position=1),
        ])

        # Users: org admin + space-scoped editor (pre-verified for local dev)
        admin = User(
            tenant_id=tenant.id,
            email="admin@example.com",
            hashed_password=hash_password("admin123"),
            full_name="Ada Admin",
            email_verified=True,
        )
        editor = User(
            tenant_id=tenant.id,
            email="editor@example.com",
            hashed_password=hash_password("editor123"),
            full_name="Evan Editor",
            email_verified=True,
        )
        db.add_all([admin, editor])
        await db.flush()
        db.add_all([
            UserRoleAssignment(user_id=admin.id, role_id=roles["ORG_ADMIN"].id, space_id=None),
            UserRoleAssignment(user_id=editor.id, role_id=roles["EDITOR"].id, space_id=space.id),
            AccountMember(tenant_id=tenant.id, user_id=admin.id, is_owner=True),
            AccountMember(tenant_id=tenant.id, user_id=editor.id),
        ])

        # API keys with deterministic dev tokens (see module docstring)
        db.add_all([
            ApiKey(
                tenant_id=tenant.id, space_id=space.id,
                name="Dev delivery key", description="Seeded for local development",
                type="delivery",
                token_prefix=DEV_DELIVERY_TOKEN[:16],
                token_hash=hash_api_token(DEV_DELIVERY_TOKEN),
                environment_ids=[], created_by=admin.id,
            ),
            ApiKey(
                tenant_id=tenant.id, space_id=space.id,
                name="Dev preview key", description="Seeded for local development",
                type="preview",
                token_prefix=DEV_PREVIEW_TOKEN[:16],
                token_hash=hash_api_token(DEV_PREVIEW_TOKEN),
                environment_ids=[], created_by=admin.id,
            ),
        ])

        # Content model: hero + card (blocks) and landing_page (assembly) + article
        def ct(name: str, api_id: str, fields: list, description: str, display_field: str) -> ContentType:
            obj = ContentType(
                tenant_id=tenant.id, space_id=space.id, environment_id=master.id,
                name=name, api_id=api_id, description=description,
                display_field=display_field, fields=fields,
            )
            db.add(obj)
            return obj

        hero_ct = ct("Hero Section", "hero", HERO_FIELDS,
                     "Reusable hero blocks for landing pages.", "heading")
        card_ct = ct("Feature Card", "card", CARD_FIELDS,
                     "Small reusable feature/benefit cards.", "title")
        landing_ct = ct("Landing Page", "landing_page", LANDING_FIELDS,
                        "Campaign landing pages assembled from hero + cards.", "title")
        article_ct = ct("Article", "article", ARTICLE_FIELDS,
                        "Blog articles and announcements.", "title")
        await db.flush()

        now = datetime.now(timezone.utc)

        def entry(ct_obj: ContentType, slug: str, fields: dict, published: bool = True) -> Entry:
            obj = Entry(
                tenant_id=tenant.id, space_id=space.id, environment_id=master.id,
                content_type_id=ct_obj.id, slug=slug,
                status=EntryStatus.published.value if published else EntryStatus.draft.value,
                fields=fields,
                published_fields=dict(fields) if published else None,
                published_at=now if published else None,
                created_by=admin.id, updated_by=admin.id,
            )
            db.add(obj)
            return obj

        hero_entry = entry(hero_ct, "homepage-hero", {
            "heading": {"en-US": "Ship on-brand content faster", "fr": "Publiez du contenu fidèle à votre marque"},
            "subheading": {"en-US": "Model, edit, preview, and publish from one place.",
                           "fr": "Modélisez, éditez, prévisualisez et publiez au même endroit."},
            "cta_label": "Start building",
        })
        card_entries = [
            entry(card_ct, "card-modeling", {
                "title": {"en-US": "Flexible content modeling", "fr": "Modélisation flexible"},
                "body": {"en-US": "Nested references, reusable blocks, and localized fields without deployments.",
                         "fr": "Références imbriquées, blocs réutilisables et champs localisés."},
                "icon": "layers",
            }),
            entry(card_ct, "card-preview", {
                "title": {"en-US": "Live visual preview", "fr": "Aperçu visuel en direct"},
                "body": {"en-US": "Edit inline in the real layout and watch drafts update instantly.",
                         "fr": "Éditez directement dans la vraie mise en page."},
                "icon": "zap",
            }),
            entry(card_ct, "card-ai", {
                "title": {"en-US": "Guideline-aware AI", "fr": "IA consciente des directives"},
                "body": {"en-US": "Generate, rewrite, and audit copy against your own brand rules.",
                         "fr": "Générez et vérifiez vos contenus selon vos règles de marque."},
                "icon": "sparkles",
            }),
        ]
        await db.flush()

        entry(landing_ct, "home", {
            "title": "Acme Platform — structured content, delivered",
            "hero": str(hero_entry.id),
            "sections": [str(c.id) for c in card_entries],
            "seo_description": "Acme Platform combines structured content modeling, live visual preview, and guideline-aware AI so teams ship on-brand pages faster.",
        })

        entry(article_ct, "welcome", {
            "title": {"en-US": "Welcome to the Acme content platform",
                      "fr": "Bienvenue sur la plateforme de contenu Acme"},
            "excerpt": {"en-US": "A quick tour of structured content, live preview, and guideline-aware AI.",
                        "fr": "Un tour rapide du contenu structuré et de l'aperçu en direct."},
            "body": {"en-US": ARTICLE_BODY_HTML, "fr": ARTICLE_BODY_HTML_FR},
            "published_date": now.isoformat(),
            "seo_description": "See how Acme Platform combines structured content, live preview, and guideline-aware AI to help teams ship on-brand pages faster.",
        })
        entry(article_ct, "drafting-with-ai", {
            "title": {"en-US": "Drafting with AI (work in progress)"},
            "excerpt": {},
            "body": {"en-US": "<p>Use the AI sidebar to generate this article from a brief.</p>"},
            "seo_description": "",
        }, published=False)

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
            print(f"Guidelines ingested and embedded ({n_chunks} chunks, vector retrieval).")
        elif guideline.status == "ingested_keyword":
            print(f"Guidelines ingested ({n_chunks} chunks, keyword retrieval — provider has no embeddings).")
        else:
            print(
                f"Guidelines stored ({n_chunks} chunks) but NOT embedded (status={guideline.status}). "
                "Configure an AI provider and call POST /guidelines/{id}/ingest to embed."
            )

        print("Seed complete.")
        print("  Logins:   admin@example.com / admin123   (org admin)")
        print("            editor@example.com / editor123 (space editor)")
        print(f"  Space:    {space.id} (marketing), environment: master")
        print(f"  Delivery token: {DEV_DELIVERY_TOKEN}")
        print(f"  Preview token:  {DEV_PREVIEW_TOKEN}")
        print("  Try: GET /spaces/{space_id}/environments/master/delivery/entries"
              "?content_type=landing_page&include=2&access_token=<delivery token>")


if __name__ == "__main__":
    asyncio.run(seed())
