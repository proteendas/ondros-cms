"""Ondros Code Sync — connect a space to the GitHub repository that renders it.

  GET    /spaces/{space_id}/code-sync                      state + connection
  GET    /spaces/{space_id}/code-sync/repositories         repos we can read
  POST   /spaces/{space_id}/code-sync/connect              choose repo + branch
  PATCH  /spaces/{space_id}/code-sync                      branch / preview URL
  POST   /spaces/{space_id}/code-sync/sync                 re-read the manifest
  DELETE /spaces/{space_id}/code-sync                      disconnect
  GET    /spaces/{space_id}/environments/{env}/code-sync/preview-target?entry_id=
  GET    /spaces/{space_id}/environments/{env}/delivery/code-sync   (API key)
  POST   /code-sync/github/webhook                         push -> re-sync

The preview itself is *not* rendered here. Like Adobe's Universal Editor, the
editor loads the project's own deployed site in an iframe and edits it in
place; this module's job is to know which site, which page, and which
component — and to say plainly when a space isn't connected yet so the editor
can offer "Connect with GitHub" instead of a broken frame.
"""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    Actor,
    ContentKeyContext,
    ensure_can,
    get_actor,
    get_content_key,
    get_environment,
    get_space,
)
from app.config import get_settings
from app.core import code_sync as manifests
from app.core import github_app
from app.core import preview_ticket
from app.core.audit import record_audit
from app.core.permissions import Capability
from app.core.validation import collect_linked_ids
from app.database import get_db
from app.models import ContentType, Entry, Environment, Space
from app.models.code_sync import CodeSyncConnection, CodeSyncStatus
from app.schemas.code_sync import (
    CodeSyncStateOut,
    ConnectionOut,
    ConnectRequest,
    DeliveryCodeSyncOut,
    PreviewTargetOut,
    RepositoryOut,
    SyncResult,
    UpdateConnectionRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["code-sync"])

# Connecting a repository is a space setting, so it rides on manage_settings
# rather than introducing a capability every existing role would have to learn.
_MANAGE = Capability.MANAGE_SETTINGS.value


# --- helpers -----------------------------------------------------------------


async def _get_connection(db: AsyncSession, space_id: uuid.UUID) -> CodeSyncConnection | None:
    return (
        await db.execute(select(CodeSyncConnection).where(CodeSyncConnection.space_id == space_id))
    ).scalar_one_or_none()


async def _default_environment_id(db: AsyncSession, space_id: uuid.UUID) -> uuid.UUID | None:
    """The environment whose content model a sync is reported against.

    Code Sync is space-scoped (one repository renders the space's site), but
    coverage only means something against one environment's content types —
    the default one, unless the caller names another.
    """
    return (
        await db.execute(
            select(Environment.id)
            .where(Environment.space_id == space_id)
            .order_by(Environment.is_default.desc(), Environment.created_at.asc())
            .limit(1)
        )
    ).scalar_one_or_none()


async def _require_connection(db: AsyncSession, space_id: uuid.UUID) -> CodeSyncConnection:
    conn = await _get_connection(db, space_id)
    if conn is None:
        raise HTTPException(status_code=404, detail="This space is not connected to a repository")
    return conn


def _state(conn: CodeSyncConnection | None, *, with_secret: bool = False) -> CodeSyncStateOut:
    """Feature state for the editor.

    ``with_secret`` gates the preview secret, which is a credential: anyone
    holding it can mint tickets and read every draft in the space. Only actors
    who may manage the connection see it, so an author reading this endpoint
    to find out whether preview works does not also receive it.
    """
    settings = get_settings()
    mode = settings.code_sync_mode
    out = ConnectionOut.model_validate(conn) if conn else None
    if out is not None and not with_secret:
        out.preview_secret = ""
    return CodeSyncStateOut(
        connected=bool(conn and conn.is_connected),
        configured=mode != "none",
        mode=mode,
        install_url=github_app.install_url() if mode == "app" else "",
        app_slug=settings.github_app_slug if mode == "app" else "",
        connection=out,
    )


async def _sync(db: AsyncSession, conn: CodeSyncConnection, env_id: uuid.UUID | None) -> SyncResult:
    """Re-read the repo's manifest and report how well it covers the model."""

    async def fetch(path: str) -> str | None:
        return await github_app.get_file(
            conn.repo_full_name, path, conn.branch, conn.installation_id or None
        )

    async def list_dir(path: str) -> list[str]:
        entries = await github_app.list_directory(
            conn.repo_full_name, path, conn.branch, conn.installation_id or None
        )
        return [e["name"] for e in entries if e.get("type") == "dir"]

    # The model is an input to discovery: a repository with no manifest is
    # mapped by convention against the content types that actually exist.
    api_ids: list[str] = []
    if env_id is not None:
        api_ids = sorted(
            (
                await db.execute(
                    select(ContentType.api_id).where(ContentType.environment_id == env_id)
                )
            )
            .scalars()
            .all()
        )

    try:
        manifest, source, path = await manifests.discover(fetch, list_dir, api_ids)
    except (manifests.ManifestError, github_app.GitHubError) as exc:
        conn.status = CodeSyncStatus.error
        conn.last_error = str(exc)
        await db.commit()
        return SyncResult(status="error", error=str(exc))

    conn.manifest = manifest
    conn.manifest_source = source
    conn.manifest_path = path
    conn.status = CodeSyncStatus.connected
    conn.last_error = ""
    conn.last_synced_at = datetime.now(timezone.utc)
    # An explicit preview URL set in the editor wins; otherwise adopt the
    # manifest's, so a repo that declares one connects in a single step.
    if not conn.preview_base_url and manifest.get("previewUrl"):
        conn.preview_base_url = manifest["previewUrl"]
    await db.commit()
    await db.refresh(conn)

    mapped = {c["contentType"] for c in manifest["components"] if c.get("contentType")}
    unmapped = sorted(set(api_ids) - mapped) if api_ids else []
    unknown = sorted(mapped - set(api_ids)) if api_ids else []

    return SyncResult(
        status="connected",
        manifest_source=source,
        manifest_path=path,
        components=len(manifest["components"]),
        unmapped_content_types=unmapped,
        unknown_content_types=unknown,
    )


# --- management endpoints -----------------------------------------------------


@router.get("/spaces/{space_id}/code-sync", response_model=CodeSyncStateOut)
async def get_code_sync(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    space = await get_space(space_id, db, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, space.id)
    return _state(
        await _get_connection(db, space_id), with_secret=actor.can(_MANAGE, space.id)
    )


@router.get("/spaces/{space_id}/code-sync/repositories", response_model=list[RepositoryOut])
async def list_repositories(
    space_id: uuid.UUID,
    installation_id: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    ensure_can(actor, _MANAGE, space_id)
    conn = await _get_connection(db, space_id)
    install = installation_id or (conn.installation_id if conn else "")
    try:
        return await github_app.list_repositories(install or None)
    except github_app.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@router.post("/spaces/{space_id}/code-sync/connect", response_model=CodeSyncStateOut)
async def connect(
    space_id: uuid.UUID,
    payload: ConnectRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Point this space at a repository and read its manifest straight away."""
    await get_space(space_id, db, actor)
    ensure_can(actor, _MANAGE, space_id)
    if get_settings().code_sync_mode == "none":
        raise HTTPException(
            status_code=503,
            detail=(
                "Code Sync is not configured on this server. Set GITHUB_APP_ID and "
                "GITHUB_APP_PRIVATE_KEY (or GITHUB_TOKEN for local development)."
            ),
        )

    conn = await _get_connection(db, space_id)
    if conn is None:
        conn = CodeSyncConnection(
            tenant_id=actor.tenant_id, space_id=space_id, created_by=actor.user_id
        )
        db.add(conn)
    if not conn.preview_secret:
        conn.preview_secret = preview_ticket.generate_secret()
    conn.repo_full_name = payload.repo_full_name
    conn.branch = payload.branch
    conn.installation_id = payload.installation_id or conn.installation_id
    conn.account_login = payload.repo_full_name.split("/", 1)[0]
    if payload.preview_base_url:
        conn.preview_base_url = payload.preview_base_url.rstrip("/")
    conn.status = CodeSyncStatus.pending
    await db.flush()

    await _sync(db, conn, await _default_environment_id(db, space_id))

    record_audit(db, actor, "code_sync.connect", "space", space_id,
                 diff={"repo": conn.repo_full_name, "branch": conn.branch}, space_id=space_id)
    await db.commit()
    await db.refresh(conn)
    return _state(conn, with_secret=True)


@router.patch("/spaces/{space_id}/code-sync", response_model=CodeSyncStateOut)
async def update_connection(
    space_id: uuid.UUID,
    payload: UpdateConnectionRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    ensure_can(actor, _MANAGE, space_id)
    conn = await _require_connection(db, space_id)
    if payload.branch is not None:
        conn.branch = payload.branch
    if payload.preview_base_url is not None:
        conn.preview_base_url = payload.preview_base_url.rstrip("/")
    await db.commit()
    await db.refresh(conn)
    return _state(conn, with_secret=True)


@router.post("/spaces/{space_id}/code-sync/sync", response_model=SyncResult)
async def sync_now(
    space_id: uuid.UUID,
    environment: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    ensure_can(actor, _MANAGE, space_id)
    conn = await _require_connection(db, space_id)
    env_id = None
    if environment:
        env_id = (await get_environment(space_id, environment, db, actor)).id
    return await _sync(db, conn, env_id)


@router.delete("/spaces/{space_id}/code-sync", status_code=204)
async def disconnect(
    space_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    await get_space(space_id, db, actor)
    ensure_can(actor, _MANAGE, space_id)
    conn = await _require_connection(db, space_id)
    record_audit(db, actor, "code_sync.disconnect", "space", space_id,
                 diff={"repo": conn.repo_full_name}, space_id=space_id)
    await db.delete(conn)
    await db.commit()


# --- preview resolution --------------------------------------------------------


@router.get(
    "/spaces/{space_id}/environments/{environment}/code-sync/preview-target",
    response_model=PreviewTargetOut,
)
async def preview_target(
    space_id: uuid.UUID,
    environment: str,
    entry_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Which URL on the project's site shows this entry.

    A page resolves to its own route. A block has no page of its own, so —
    exactly as the Universal Editor does — it is previewed inside a page that
    references it, with the component highlighted.
    """
    env = await get_environment(space_id, environment, db, actor)
    ensure_can(actor, Capability.READ_CONTENT.value, space_id)
    conn = await _get_connection(db, space_id)
    if conn is None or not conn.is_connected:
        raise HTTPException(status_code=409, detail="This space is not connected to a repository")
    if not conn.preview_base_url:
        raise HTTPException(
            status_code=409,
            detail=(
                "No deployment URL for this project. Add previewUrl to the repo's "
                "manifest, or set it under Settings -> Code Sync."
            ),
        )

    entry = (
        await db.execute(
            select(Entry).where(Entry.id == entry_id, Entry.environment_id == env.id)
        )
    ).scalar_one_or_none()
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found in this environment")

    api_id = entry.content_type.api_id
    component = conn.components_by_content_type.get(api_id, {})
    base = conn.preview_base_url.rstrip("/")

    # Authorizes the site to render drafts for this request only. Minted here
    # because this endpoint already proved the caller may read the space; the
    # ticket expires in minutes, so a shared preview URL stops working.
    ticket = (
        preview_ticket.mint(
            conn.preview_secret,
            environment=env.key,
            subject=str(getattr(actor, "user_id", "") or ""),
        )
        if conn.preview_secret
        else ""
    )

    def _page(host: Entry, focus: Entry | None) -> PreviewTargetOut:
        path = manifests.route_for(conn.manifest, host.content_type.api_id, host.slug or "")
        return PreviewTargetOut(
            mode="page" if focus is None else "component",
            url=f"{base}{path}",
            path=path,
            content_type=api_id,
            component_id=component.get("id", ""),
            focus_entry_id=str(focus.id) if focus else "",
            host_entry_id=str(host.id),
            host_title=host.slug or host.content_type.name,
            preview_token=ticket,
        )

    if entry.content_type.slug_field:
        if not entry.slug:
            return PreviewTargetOut(
                mode="unroutable",
                content_type=api_id,
                component_id=component.get("id", ""),
                message=(
                    f"Fill in the '{entry.content_type.slug_field}' field to give this "
                    f"entry a URL on the site."
                ),
            )
        return _page(entry, None)

    host = await _find_referencing_page(db, env.id, entry)
    if host is None:
        return PreviewTargetOut(
            mode="orphan",
            content_type=api_id,
            component_id=component.get("id", ""),
            focus_entry_id=str(entry.id),
            message=(
                f"No page references this {entry.content_type.name} yet. Add it to a page "
                f"to see it rendered by your project."
            ),
        )
    return _page(host, entry)


async def _find_referencing_page(
    db: AsyncSession, environment_id: uuid.UUID, block: Entry
) -> Entry | None:
    """The first routable page whose fields link to this block.

    Published pages win over drafts — a block usually looks right in the page
    it actually ships on. Reference scanning reuses the validation helper, so
    links nested in groups and rich text count the same way they do elsewhere.
    """
    block_id = str(block.id)
    candidates = (
        (
            await db.execute(
                select(Entry)
                .where(Entry.environment_id == environment_id, Entry.slug.isnot(None))
                .order_by(Entry.status.desc(), Entry.updated_at.desc())
                .limit(500)
            )
        )
        .scalars()
        .unique()
        .all()
    )
    for candidate in candidates:
        if not candidate.content_type.slug_field:
            continue
        by_field, _ = collect_linked_ids(candidate.content_type.fields or [], candidate.fields or {})
        if any(block_id in ids for ids in by_field.values()):
            return candidate
    return None


# --- delivery plane (read by a connected site's bridge) ------------------------


@router.get(
    "/spaces/{space_id}/environments/{environment}/delivery/code-sync",
    response_model=DeliveryCodeSyncOut,
)
async def delivery_code_sync(
    space_id: uuid.UUID,
    environment: str,
    db: AsyncSession = Depends(get_db),
    ctx: ContentKeyContext = Depends(get_content_key),
):
    """The manifest, readable with a delivery/preview API key.

    A connected site loads this to learn its own component mapping without
    needing management credentials in the browser.
    """
    conn = await _get_connection(db, ctx.space.id)
    if conn is None or not conn.is_connected:
        return DeliveryCodeSyncOut(connected=False)
    manifest = conn.manifest or {}
    return DeliveryCodeSyncOut(
        connected=True,
        previewUrl=conn.preview_base_url,
        routes=manifest.get("routes", {}),
        components=manifest.get("components", []),
    )


# --- GitHub webhook -------------------------------------------------------------


@router.post("/code-sync/github/webhook", status_code=202)
async def github_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Re-sync on push, and drop connections whose installation was removed."""
    body = await request.body()
    if not github_app.verify_webhook(body, request.headers.get("X-Hub-Signature-256")):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = request.headers.get("X-GitHub-Event", "")
    payload = await request.json()

    if event == "installation" and payload.get("action") in ("deleted", "suspend"):
        installation_id = str((payload.get("installation") or {}).get("id", ""))
        if installation_id:
            rows = (
                await db.execute(
                    select(CodeSyncConnection).where(
                        CodeSyncConnection.installation_id == installation_id
                    )
                )
            ).scalars().all()
            for conn in rows:
                conn.status = CodeSyncStatus.error
                conn.last_error = "The GitHub App installation was removed."
            await db.commit()
        return {"handled": event}

    if event == "push":
        repo = (payload.get("repository") or {}).get("full_name", "")
        ref = payload.get("ref", "")  # refs/heads/<branch>
        branch = ref.rsplit("/", 1)[-1] if ref else ""
        rows = (
            await db.execute(
                select(CodeSyncConnection).where(
                    CodeSyncConnection.repo_full_name == repo,
                    CodeSyncConnection.branch == branch,
                )
            )
        ).scalars().all()
        for conn in rows:
            await _sync(db, conn, await _default_environment_id(db, conn.space_id))
        return {"handled": "push", "connections": len(rows)}

    return {"handled": "ignored", "event": event}


# --- GitHub App installation callback --------------------------------------------


@router.get("/code-sync/github/callback")
async def github_callback(
    installation_id: str = Query(default=""),
    setup_action: str = Query(default=""),
    state: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Where GitHub returns after someone installs the App.

    ``state`` carries the space id so the installation lands on the right
    space. No user session is guaranteed here (GitHub opens this in a fresh
    tab), so this only records the installation and bounces back to the
    editor, which finishes the job with an authenticated call.
    """
    settings = get_settings()
    redirect_to = f"{settings.frontend_url}/settings/code-sync"
    if installation_id and state:
        try:
            space_id = uuid.UUID(state)
        except ValueError:
            space_id = None
        if space_id is not None:
            space = (await db.execute(select(Space).where(Space.id == space_id))).scalar_one_or_none()
            if space is not None:
                conn = await _get_connection(db, space_id)
                if conn is None:
                    conn = CodeSyncConnection(tenant_id=space.tenant_id, space_id=space_id)
                    db.add(conn)
                if not conn.preview_secret:
                    conn.preview_secret = preview_ticket.generate_secret()
                conn.installation_id = installation_id
                if not conn.repo_full_name:
                    conn.status = CodeSyncStatus.pending
                try:
                    account = await github_app.installation_account(installation_id)
                    conn.account_login = account.get("login", "")
                except github_app.GitHubError as exc:
                    logger.warning("Code Sync: could not read installation %s: %s", installation_id, exc)
                await db.commit()

    from fastapi.responses import RedirectResponse

    separator = "&" if "?" in redirect_to else "?"
    return RedirectResponse(
        f"{redirect_to}{separator}installation_id={installation_id}&setup_action={setup_action}"
    )
