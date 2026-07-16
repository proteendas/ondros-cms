"""FastAPI application entrypoint.

Router map:
  /auth/*            login, JWT issuance, current user
  /content-types/*   content model CRUD
  /entries/*         entry CRUD + workflow transitions
  /content/*         public delivery API (published content)
  /preview/content/* secret-gated draft content for the preview app
  /ai/*              generate-entry, transform-field, check-compliance
  /guidelines/*      guideline docs + pgvector ingestion
  /media/*           uploads (served from /files/*)
  /ws/entries/{id}   live updates WebSocket
"""
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import ai, auth, content_types, delivery, entries, guidelines, media, ws
from app.config import get_settings
from app.database import init_db

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # First-run convenience: create pgvector extension + tables.
    # Replace with Alembic migrations for production.
    await init_db()
    Path(settings.media_root).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(content_types.router)
app.include_router(entries.router)
app.include_router(delivery.router)
app.include_router(ai.router)
app.include_router(guidelines.router)
app.include_router(media.router)
app.include_router(ws.router)

app.mount("/files", StaticFiles(directory=settings.media_root, check_dir=False), name="files")


@app.get("/health")
async def health():
    return {"status": "ok"}
