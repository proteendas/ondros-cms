"""FastAPI application entrypoint.

Router map (three API planes):

  Management (JWT or management API key):
    /auth/*                          login, JWT issuance, current user
    /spaces/*                        spaces, environments (+cloning)
    /spaces/{id}/api-keys/*          API key management
    /spaces/{id}/webhooks/*          webhooks + delivery log
    /spaces/{id}/environments/{env}/content-types  content model
    /spaces/{id}/environments/{env}/entries        entry CRUD + bulk
    /spaces/{id}/environments/{env}/media          uploads
    /entries/{id}[/publish|...]      id-addressed entry ops
    /media/{id}[/variant]            id-addressed asset ops
    /users, /roles, /role-assignments  org administration
    /ai/*                            generate, transform, compliance, SEO, translate
    /guidelines/*                    guideline docs + RAG ingestion

  Delivery/Preview (delivery or preview API key):
    /spaces/{id}/environments/{env}/delivery/entries|assets

  Realtime:
    /ws/entries/{id}                 live updates WebSocket
"""
import logging
import time
import uuid as uuid_mod
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import (
    accounts,
    ai,
    api_keys,
    audit,
    auth,
    billing,
    content_types,
    delivery,
    entries,
    guidelines,
    locales,
    media,
    spaces,
    sso,
    users,
    webhooks,
    ws,
)
from app.config import get_settings
from app.database import init_db

settings = get_settings()

logging.basicConfig(
    level=getattr(logging, settings.log_level.upper(), logging.INFO),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("cms")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # First-run convenience: create pgvector extension + tables + dev migrations.
    # Replace with Alembic migrations for hardened production deployments.
    await init_db()
    Path(settings.media_root).mkdir(parents=True, exist_ok=True)
    ai_provider = settings.resolved_ai_provider
    logger.info("AI provider: %s", ai_provider if ai_provider != "none" else "none (AI disabled)")
    yield


app = FastAPI(
    title=settings.app_name,
    version="2.0.0",
    lifespan=lifespan,
    description=(
        "Contentful-style headless CMS: spaces, environments, content modeling with "
        "references and localization, delivery/preview/management APIs, webhooks, "
        "and guideline-aware AI."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    """Structured request log + request id + catch-all error handler."""
    request_id = uuid_mod.uuid4().hex[:12]
    started = time.monotonic()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("[%s] Unhandled error on %s %s", request_id, request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": request_id},
        )
    duration_ms = int((time.monotonic() - started) * 1000)
    if not request.url.path.startswith(("/files", "/health")):
        logger.info(
            "[%s] %s %s -> %s (%dms)",
            request_id, request.method, request.url.path, response.status_code, duration_ms,
        )
    response.headers["X-Request-Id"] = request_id
    return response


app.include_router(auth.router)
app.include_router(accounts.router)
app.include_router(sso.router)
app.include_router(billing.router)
app.include_router(spaces.router)
app.include_router(locales.router)
app.include_router(audit.router)
app.include_router(api_keys.router)
app.include_router(webhooks.router)
app.include_router(content_types.router)
app.include_router(entries.router)
app.include_router(media.router)
app.include_router(delivery.router)
app.include_router(ai.router)
app.include_router(guidelines.router)
app.include_router(users.router)
app.include_router(ws.router)

app.mount("/files", StaticFiles(directory=settings.media_root, check_dir=False), name="files")


@app.get("/health")
async def health():
    return {"status": "ok"}
