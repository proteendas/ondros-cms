"""Test fixtures: real Postgres (pgvector image from docker-compose).

Tests use a separate `cms_test` database on the same server (created on the
fly). If Postgres is unreachable, the whole suite skips — start it with:
    docker compose up -d db

Run:  cd backend && pytest
"""
import os
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.permissions import SYSTEM_ROLES
from app.core.security import create_access_token, hash_api_token, hash_password
from app.database import get_db
from app.main import app
from app.models import (
    AccountMember,
    ApiKey,
    Base,
    ContentType,
    Environment,
    Locale,
    Role,
    Space,
    Tenant,
    User,
    UserRoleAssignment,
)

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://cms:cms@localhost:5432/cms_test"
)
ADMIN_DATABASE_URL = os.environ.get(
    "ADMIN_DATABASE_URL", "postgresql+asyncpg://cms:cms@localhost:5432/cms"
)


@pytest_asyncio.fixture(scope="session")
async def engine():
    eng = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool)
    try:
        async with eng.connect():
            pass
    except Exception:
        # Try to create the test database via the default one.
        try:
            admin = create_async_engine(
                ADMIN_DATABASE_URL, isolation_level="AUTOCOMMIT", poolclass=NullPool
            )
            async with admin.connect() as conn:
                await conn.execute(text("CREATE DATABASE cms_test"))
            await admin.dispose()
            async with eng.connect():
                pass
        except Exception:
            pytest.skip("Postgres is not available (docker compose up -d db)")
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def db_maker(engine):
    """Fresh schema per test."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture
async def client(db_maker):
    async def override_get_db():
        async with db_maker() as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
    app.dependency_overrides.clear()


DELIVERY_TOKEN = "cms_del_test-delivery-token"
PREVIEW_TOKEN = "cms_pre_test-preview-token"
SCOPED_DELIVERY_TOKEN = "cms_del_test-master-only-token"
MANAGEMENT_TOKEN = "cms_mgm_test-management-token"

ARTICLE_FIELDS = [
    {"id": "title", "name": "Title", "type": "text", "localized": True,
     "validations": {"required": True, "max_length": 120}},
    {"id": "body", "name": "Body", "type": "richtext", "localized": False, "validations": {}},
    {"id": "related", "name": "Related", "type": "reference_many",
     "allowed_content_types": ["article"], "validations": {}},
    {"id": "hero", "name": "Hero", "type": "reference",
     "allowed_content_types": ["hero"], "validations": {}},
]

HERO_FIELDS = [
    {"id": "heading", "name": "Heading", "type": "text",
     "validations": {"required": True}},
]


@pytest_asyncio.fixture
async def workspace(db_maker):
    """Tenant + space (en-US, fr) + master/staging envs + users of each role +
    API keys. Returns everything needed to drive the API in tests."""
    async with db_maker() as db:
        tenant = Tenant(name="T", slug=f"t-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.flush()

        roles = {}
        for name, preset in SYSTEM_ROLES.items():
            role = Role(tenant_id=tenant.id, name=name,
                        description=preset["description"],
                        permissions=preset["permissions"], is_system=True)
            db.add(role)
            roles[name] = role

        space = Space(
            tenant_id=tenant.id, name="Site", slug="site",
            locales=[{"code": "en-US", "name": "English"}, {"code": "fr", "name": "French"}],
            default_locale="en-US",
        )
        db.add(space)
        await db.flush()

        master = Environment(tenant_id=tenant.id, space_id=space.id,
                             key="master", name="Master", type="master", is_default=True)
        staging = Environment(tenant_id=tenant.id, space_id=space.id,
                              key="staging", name="Staging", type="staging")
        db.add_all([master, staging])
        await db.flush()

        # Locale rows (source of truth) matching the space's locales cache.
        db.add_all([
            Locale(tenant_id=tenant.id, space_id=space.id, code="en-US",
                   name="English", is_default=True, position=0),
            Locale(tenant_id=tenant.id, space_id=space.id, code="fr",
                   name="French", position=1),
        ])

        users = {}
        for role_name in ("ORG_ADMIN", "EDITOR", "AUTHOR", "VIEWER"):
            user = User(
                tenant_id=tenant.id,
                email=f"{role_name.lower()}-{uuid.uuid4().hex[:6]}@t.test",
                hashed_password=hash_password("pass12345"),
                full_name=role_name,
                email_verified=True,
            )
            db.add(user)
            await db.flush()
            db.add(UserRoleAssignment(
                user_id=user.id, role_id=roles[role_name].id,
                space_id=None if role_name == "ORG_ADMIN" else space.id,
            ))
            db.add(AccountMember(
                tenant_id=tenant.id, user_id=user.id, is_owner=role_name == "ORG_ADMIN",
            ))
            users[role_name] = user

        db.add_all([
            ApiKey(tenant_id=tenant.id, space_id=space.id, name="delivery",
                   type="delivery", token_prefix=DELIVERY_TOKEN[:16],
                   token_hash=hash_api_token(DELIVERY_TOKEN), environment_ids=[]),
            ApiKey(tenant_id=tenant.id, space_id=space.id, name="preview",
                   type="preview", token_prefix=PREVIEW_TOKEN[:16],
                   token_hash=hash_api_token(PREVIEW_TOKEN), environment_ids=[]),
            ApiKey(tenant_id=tenant.id, space_id=space.id, name="delivery-master-only",
                   type="delivery", token_prefix=SCOPED_DELIVERY_TOKEN[:16],
                   token_hash=hash_api_token(SCOPED_DELIVERY_TOKEN),
                   environment_ids=[str(master.id)]),
            ApiKey(tenant_id=tenant.id, space_id=space.id, name="management",
                   type="management", token_prefix=MANAGEMENT_TOKEN[:16],
                   token_hash=hash_api_token(MANAGEMENT_TOKEN),
                   environment_ids=[], read_only=False),
        ])

        article_ct = ContentType(
            tenant_id=tenant.id, space_id=space.id, environment_id=master.id,
            name="Article", api_id="article", display_field="title", fields=ARTICLE_FIELDS,
        )
        hero_ct = ContentType(
            tenant_id=tenant.id, space_id=space.id, environment_id=master.id,
            name="Hero", api_id="hero", display_field="heading", fields=HERO_FIELDS,
        )
        db.add_all([article_ct, hero_ct])
        await db.commit()

        tokens = {
            name: create_access_token(str(u.id), str(tenant.id), u.email)
            for name, u in users.items()
        }
        return {
            "tenant": tenant,
            "space": space,
            "master": master,
            "staging": staging,
            "users": users,
            "tokens": tokens,
            "article_ct": article_ct,
            "hero_ct": hero_ct,
        }


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}
