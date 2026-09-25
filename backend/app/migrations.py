"""Lightweight, idempotent dev migrations.

`Base.metadata.create_all` only creates *missing tables*; it never adds columns
to existing ones. These statements upgrade a database created by the previous
version of this project (single-environment schema) in place:

  1. add new columns (IF NOT EXISTS),
  2. create a default "master" environment per space,
  3. backfill environment_id on content rows,
  4. migrate legacy users.role_id into user_role_assignments.

Every statement is safe to re-run. For real production deployments, replace
this module (and init_db's create_all) with Alembic.
"""
import logging
import re

from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.config import get_settings

logger = logging.getLogger(__name__)

# Plain DDL, executed one by one; failures on individual statements are logged
# and skipped so a partially-new database never blocks startup.
DDL_STATEMENTS = [
    # Spaces: locales
    "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS locales JSONB DEFAULT '[{\"code\": \"en-US\", \"name\": \"English (US)\"}]'::jsonb",
    "ALTER TABLE spaces ADD COLUMN IF NOT EXISTS default_locale VARCHAR(20) DEFAULT 'en-US'",
    # Roles: description + is_system
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''",
    "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE",
    # Content types: environment + display field
    "ALTER TABLE content_types ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES environments(id) ON DELETE CASCADE",
    "ALTER TABLE content_types ADD COLUMN IF NOT EXISTS display_field VARCHAR(100) DEFAULT ''",
    # Slugs moved into the content model (a field of type `slug`), so the
    # denormalized entries.slug mirror is NULL for types that don't model one.
    "ALTER TABLE entries ALTER COLUMN slug DROP NOT NULL",
    # Entries: environment + updated_by
    "ALTER TABLE entries ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES environments(id) ON DELETE CASCADE",
    "ALTER TABLE entries ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL",
    # Media assets: environment + rich metadata
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES environments(id) ON DELETE SET NULL",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width INTEGER",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height INTEGER",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS title VARCHAR(300) DEFAULT ''",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS description TEXT DEFAULT ''",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS alt_text VARCHAR(500) DEFAULT ''",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()",
    # Guidelines: environment scoping
    "ALTER TABLE guideline_documents ADD COLUMN IF NOT EXISTS environment_id UUID REFERENCES environments(id) ON DELETE CASCADE",
    # --- SaaS upgrade (spec 001/003): email verification flag.
    # DEFAULT TRUE grandfathers existing rows; new ORM inserts default to False.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT TRUE",
    "ALTER TABLE users ALTER COLUMN email_verified SET DEFAULT FALSE",
    # --- Code Sync (spec 020): columns added after the table shipped.
    "ALTER TABLE code_sync_connections ADD COLUMN IF NOT EXISTS manifest_path VARCHAR(300) DEFAULT ''",
    "ALTER TABLE code_sync_connections ADD COLUMN IF NOT EXISTS preview_base_url VARCHAR(500) DEFAULT ''",
    "ALTER TABLE code_sync_connections ADD COLUMN IF NOT EXISTS preview_secret VARCHAR(80) DEFAULT ''",
    # --- Platform admin (spec 013): operator flag + account suspension.
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'",
]

# Tables carrying tenant_id get RLS policies (second line of defense — active
# once the app connects as a non-owner role such as cms_app; spec 001).
_RLS_TABLES = [
    "spaces", "environments", "locales", "content_types", "entries",
    "media_assets", "api_keys", "webhooks", "guideline_documents", "roles",
    "code_sync_connections",
    "account_members", "invitations", "refresh_tokens", "sso_configs",
    "subscriptions", "usage_counters", "audit_logs",
]

RLS_STATEMENTS = (
    [f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY" for t in _RLS_TABLES]
    + [
        f"DO $$ BEGIN CREATE POLICY tenant_isolation ON {t} "
        f"USING (tenant_id::text = current_setting('app.current_account_id', true)); "
        f"EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        for t in _RLS_TABLES
    ]
)
# Backfills run after DDL. Each is independent and idempotent.
BACKFILL_STATEMENTS = [
    # Every existing connection needs a preview secret: without one the site
    # has nothing to verify a preview ticket against, so its editor preview
    # would silently fall back to published content. The customer copies this
    # value into their site's ONDROS_PREVIEW_SECRET.
    """
    UPDATE code_sync_connections
    SET preview_secret = 'ondros_pv_' || replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_')
    WHERE preview_secret IS NULL OR preview_secret = ''
    """,
    # One "master" environment per space that has none yet.
    """
    INSERT INTO environments (id, tenant_id, space_id, key, name, type, is_default, created_at)
    SELECT gen_random_uuid(), s.tenant_id, s.id, 'master', 'Master', 'master', TRUE, NOW()
    FROM spaces s
    WHERE NOT EXISTS (SELECT 1 FROM environments e WHERE e.space_id = s.id)
    """,
    # Point orphaned content rows at their space's default environment.
    """
    UPDATE content_types ct SET environment_id = e.id
    FROM environments e
    WHERE ct.environment_id IS NULL AND e.space_id = ct.space_id AND e.is_default
    """,
    """
    UPDATE entries en SET environment_id = e.id
    FROM environments e
    WHERE en.environment_id IS NULL AND e.space_id = en.space_id AND e.is_default
    """,
    """
    UPDATE media_assets m SET environment_id = e.id
    FROM environments e
    WHERE m.environment_id IS NULL AND m.space_id IS NOT NULL
      AND e.space_id = m.space_id AND e.is_default
    """,
    # Legacy single-role users -> org-wide role assignments.
    """
    INSERT INTO user_role_assignments (id, user_id, role_id, space_id, created_at)
    SELECT gen_random_uuid(), u.id, u.role_id, NULL, NOW()
    FROM users u
    WHERE u.role_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_role_assignments a
        WHERE a.user_id = u.id AND a.role_id = u.role_id AND a.space_id IS NULL
      )
    """,
    # --- Slug-as-a-field (see ContentType.slug_field) -------------------------
    # Entries used to carry a mandatory slug column with nothing in the content
    # model behind it. Give every type whose entries actually have slugs a real
    # `slug` field so authors can keep editing them, ...
    """
    UPDATE content_types ct
    SET fields = coalesce(ct.fields, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', 'slug', 'name', 'Slug', 'type', 'slug', 'localized', false,
          'validations', jsonb_build_object('required', true),
          'allowed_content_types', '[]'::jsonb, 'rich_text', null,
          'help_text', 'URL segment for this entry.', 'ai_hint', '', 'fields', '[]'::jsonb))
    WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(ct.fields, '[]'::jsonb)) f
            WHERE f->>'type' = 'slug' OR f->>'id' = 'slug')
      AND EXISTS (
            SELECT 1 FROM entries e
            WHERE e.content_type_id = ct.id AND e.slug IS NOT NULL AND e.slug <> '')
    """,
    # ... and copy each entry's slug into that field (draft + published copies)
    # so the field value and the mirror agree from the first save onward.
    """
    UPDATE entries e
    SET fields = jsonb_set(coalesce(e.fields, '{}'::jsonb), ARRAY[sf.field_id], to_jsonb(e.slug), true)
    FROM (
        SELECT ct.id AS ct_id,
               (SELECT f->>'id' FROM jsonb_array_elements(coalesce(ct.fields, '[]'::jsonb)) f
                WHERE f->>'type' = 'slug' LIMIT 1) AS field_id
        FROM content_types ct
    ) sf
    WHERE e.content_type_id = sf.ct_id AND sf.field_id IS NOT NULL
      AND e.slug IS NOT NULL AND e.slug <> ''
      AND NOT (coalesce(e.fields, '{}'::jsonb) ? sf.field_id)
    """,
    """
    UPDATE entries e
    SET published_fields = jsonb_set(e.published_fields, ARRAY[sf.field_id], to_jsonb(e.slug), true)
    FROM (
        SELECT ct.id AS ct_id,
               (SELECT f->>'id' FROM jsonb_array_elements(coalesce(ct.fields, '[]'::jsonb)) f
                WHERE f->>'type' = 'slug' LIMIT 1) AS field_id
        FROM content_types ct
    ) sf
    WHERE e.content_type_id = sf.ct_id AND sf.field_id IS NOT NULL
      AND e.published_fields IS NOT NULL
      AND e.slug IS NOT NULL AND e.slug <> ''
      AND NOT (e.published_fields ? sf.field_id)
    """,
    # Types that model no slug have no URL: clear the orphaned mirror.
    """
    UPDATE entries e SET slug = NULL
    FROM content_types ct
    WHERE e.content_type_id = ct.id AND e.slug IS NOT NULL
      AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(coalesce(ct.fields, '[]'::jsonb)) f
            WHERE f->>'type' = 'slug')
    """,
    # SaaS upgrade: every existing user becomes a member (owner) of their tenant.
    """
    INSERT INTO account_members (id, tenant_id, user_id, is_owner, created_at)
    SELECT gen_random_uuid(), u.tenant_id, u.id, TRUE, NOW()
    FROM users u
    WHERE NOT EXISTS (
        SELECT 1 FROM account_members m WHERE m.tenant_id = u.tenant_id AND m.user_id = u.id
    )
    """,
    # SaaS upgrade: materialize Locale rows from the spaces.locales JSONB cache.
    """
    INSERT INTO locales (id, tenant_id, space_id, code, name, is_default, is_active, position, created_at)
    SELECT gen_random_uuid(), s.tenant_id, s.id, loc->>'code', COALESCE(loc->>'name', loc->>'code'),
           (loc->>'code') = s.default_locale, TRUE, ord - 1, NOW()
    FROM spaces s, jsonb_array_elements(s.locales) WITH ORDINALITY AS t(loc, ord)
    WHERE NOT EXISTS (SELECT 1 FROM locales l WHERE l.space_id = s.id)
    """,
]


_SAFE_IDENT = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")


def app_role_statements() -> list[str]:
    """DDL that provisions the non-owner `cms_app` login used to activate RLS.

    Opt-in: it only runs when DB_APP_ROLE_PASSWORD is set, because creating a
    LOGIN role is *not* ordinary DDL on managed Postgres. Neon intercepts
    CREATE/ALTER ROLE and forwards it to its control plane, which enforces a
    password policy and reports a failure at COMMIT — too late for the
    per-statement SAVEPOINT in run_dev_migrations to contain it, so a weak password there took
    down the whole init_db transaction (and with it app startup).

    Nothing connects as this role yet; it exists so an operator can point
    DATABASE_URL at it to make the tenant_isolation policies bite.
    """
    settings = get_settings()
    password = settings.db_app_role_password
    if not password:
        return []
    role = settings.db_app_role
    if not _SAFE_IDENT.fullmatch(role):
        logger.warning("DB_APP_ROLE %r is not a plain identifier; skipping role setup", role)
        return []
    # Role DDL takes no bind parameters, so the password is interpolated as a
    # SQL literal — refuse the two characters that could break out of it.
    if "'" in password or "\\" in password:
        logger.warning("DB_APP_ROLE_PASSWORD may not contain quotes or backslashes; skipping role setup")
        return []
    return [
        f"DO $$ BEGIN CREATE ROLE {role} LOGIN PASSWORD '{password}'; "
        f"EXCEPTION WHEN duplicate_object THEN NULL; END $$",
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {role}",
    ]


async def run_app_role_setup(engine: AsyncEngine) -> None:
    """Provision the RLS login role, each statement in its own transaction.

    Deliberately *not* part of `run_dev_migrations`' transaction: a managed
    provider can reject role DDL when the surrounding transaction commits, and
    that rollback would take the schema with it. Here the worst case is a
    logged warning.
    """
    from sqlalchemy import text

    for stmt in app_role_statements():
        try:
            async with engine.begin() as conn:
                await conn.execute(text(stmt))
        except Exception as exc:  # noqa: BLE001 - never block startup on role setup
            logger.warning("App role setup statement skipped: %s", exc)


async def run_dev_migrations(conn: AsyncConnection) -> None:
    from sqlalchemy import text

    for stmt in DDL_STATEMENTS + BACKFILL_STATEMENTS + RLS_STATEMENTS:
        try:
            # SAVEPOINT per statement: in Postgres a failed statement aborts the
            # surrounding transaction, which would roll back create_all too.
            async with conn.begin_nested():
                await conn.execute(text(stmt))
        except Exception as exc:  # noqa: BLE001 - never block startup on a single statement
            # Expected e.g. when users.role_id no longer exists on fresh databases.
            logger.debug("Dev migration statement skipped: %s (%s)", " ".join(stmt.split()[0:4]), exc)
