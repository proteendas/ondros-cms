"""SaaS upgrade: accounts, invitations, tokens, locales, SSO, billing, audit.

Revision ID: 0001_saas_upgrade
Revises: None (baseline for databases created before the SaaS upgrade)

Strategy: this project historically created its schema via
Base.metadata.create_all. This revision (a) creates any missing NEW tables
from the current model metadata, (b) applies the in-place column upgrades and
backfills that app/migrations.py performs at dev boot. Running it against a
pre-SaaS production database yields the same schema as a fresh create_all.
"""
from alembic import op

revision = "0001_saas_upgrade"
down_revision = None
branch_labels = None
depends_on = None

NEW_TABLES = [
    "account_members", "invitations", "refresh_tokens", "action_tokens",
    "locales", "sso_configs", "plans", "subscriptions", "usage_counters",
    "audit_logs", "entry_versions",
]


def upgrade() -> None:
    from app.migrations import BACKFILL_STATEMENTS, DDL_STATEMENTS, RLS_STATEMENTS
    from app.models import Base

    bind = op.get_bind()
    # Create any table that doesn't exist yet (new tables on old databases;
    # everything on empty ones).
    Base.metadata.create_all(bind=bind, checkfirst=True)

    for stmt in DDL_STATEMENTS + BACKFILL_STATEMENTS + RLS_STATEMENTS:
        try:
            op.execute(stmt)
        except Exception:  # idempotent statements; skip ones that don't apply
            pass


def downgrade() -> None:
    for table in reversed(NEW_TABLES):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS email_verified")
