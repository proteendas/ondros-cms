"""Platform admin (spec 013): users.is_platform_admin + tenants.status.

Revision ID: 0002_platform_admin
Revises: 0001_saas_upgrade
"""
from alembic import op

revision = "0002_platform_admin"
down_revision = "0001_saas_upgrade"
branch_labels = None
depends_on = None

STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN DEFAULT FALSE",
    "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active'",
]


def upgrade() -> None:
    for stmt in STATEMENTS:
        op.execute(stmt)


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS is_platform_admin")
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS status")
