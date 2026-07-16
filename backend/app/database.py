"""Async SQLAlchemy engine/session setup and first-run schema creation.

For real deployments, replace `init_db`'s create_all with Alembic migrations —
the model layout is migration-friendly (no implicit server defaults beyond timestamps).
"""
from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(settings.database_url, echo=False, pool_pre_ping=True)
async_session_maker = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session


async def init_db() -> None:
    from app.models import Base  # imported here so all models are registered

    async with engine.begin() as conn:
        # pgvector must exist before create_all touches the Vector column.
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.create_all)
