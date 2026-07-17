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

from sqlalchemy.ext.asyncio import AsyncConnection

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
]

# Tables carrying tenant_id get RLS policies (second line of defense — active
# once the app connects as a non-owner role such as cms_app; spec 001).
_RLS_TABLES = [
    "spaces", "environments", "locales", "content_types", "entries",
    "media_assets", "api_keys", "webhooks", "guideline_documents", "roles",
    "account_members", "invitations", "refresh_tokens", "sso_configs",
    "subscriptions", "usage_counters", "audit_logs",
]

RLS_STATEMENTS = (
    ["DO $$ BEGIN CREATE ROLE cms_app LOGIN PASSWORD 'cms_app'; EXCEPTION WHEN duplicate_object THEN NULL; END $$"]
    + ["GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cms_app"]
    + [f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY" for t in _RLS_TABLES]
    + [
        f"DO $$ BEGIN CREATE POLICY tenant_isolation ON {t} "
        f"USING (tenant_id::text = current_setting('app.current_account_id', true)); "
        f"EXCEPTION WHEN duplicate_object THEN NULL; END $$"
        for t in _RLS_TABLES
    ]
)

# Backfills run after DDL. Each is independent and idempotent.
BACKFILL_STATEMENTS = [
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
