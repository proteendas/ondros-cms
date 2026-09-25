"""Ondros Code Sync: manifest reading and preview resolution.

Nothing here talks to GitHub — manifest discovery takes a fetcher, so the two
supported repository layouts are exercised directly.
"""
import pytest

from app.core import code_sync as manifests
from app.models.code_sync import CodeSyncConnection, CodeSyncStatus
from tests.conftest import DELIVERY_TOKEN, auth

pytestmark = pytest.mark.asyncio


ONDROS_MANIFEST = """
{
  "previewUrl": "https://site.example.com",
  "routes": {"article": "/blog/{slug}"},
  "components": [
    {"id": "article", "title": "Article", "contentType": "article", "block": "article",
     "fields": [{"name": "title", "label": "Title", "component": "text"}]},
    {"id": "hero", "title": "Hero", "contentType": "hero", "block": "hero"}
  ]
}
"""

AEM_MANIFEST = """
{
  "groups": [
    {"id": "blocks", "title": "Blocks", "components": [
      {"id": "hero", "title": "Hero", "model": "hero"},
      {"id": "teaser", "title": "Teaser", "model": "teaser",
       "plugins": {"ondros": {"contentType": "card", "block": "cards"}}}
    ]}
  ]
}
"""

AEM_MODELS = """
[{"id": "hero", "fields": [
    {"component": "text", "name": "heading", "label": "Heading"},
    {"component": "richtext", "name": "body", "label": "Body"}]}]
"""


def _fetcher(files: dict[str, str]):
    async def fetch(path: str) -> str | None:
        return files.get(path)

    return fetch


# --- manifest discovery --------------------------------------------------------


async def test_discovers_the_ondros_manifest():
    manifest, source, path = await manifests.discover(
        _fetcher({"ondros/component-definition.json": ONDROS_MANIFEST})
    )
    assert source == "ondros"
    assert path == "ondros/component-definition.json"
    assert manifest["previewUrl"] == "https://site.example.com"
    assert manifest["routes"] == {"article": "/blog/{slug}"}
    assert [c["contentType"] for c in manifest["components"]] == ["article", "hero"]


async def test_discovers_an_aem_universal_editor_manifest():
    """A repo already set up for AEM's Universal Editor connects unchanged."""
    manifest, source, path = await manifests.discover(
        _fetcher({
            "component-definition.json": AEM_MANIFEST,
            "component-models.json": AEM_MODELS,
        })
    )
    assert source == "aem"
    assert path == "component-definition.json"
    by_id = {c["id"]: c for c in manifest["components"]}
    # A component's id binds to the content type of the same api_id...
    assert by_id["hero"]["contentType"] == "hero"
    # ...unless plugins.ondros says otherwise.
    assert by_id["teaser"]["contentType"] == "card"
    assert by_id["teaser"]["block"] == "cards"
    # Fields come from component-models.json.
    assert [f["name"] for f in by_id["hero"]["fields"]] == ["heading", "body"]


async def test_the_ondros_manifest_wins_when_a_repo_has_both():
    manifest, source, _ = await manifests.discover(
        _fetcher({
            "ondros/component-definition.json": ONDROS_MANIFEST,
            "component-definition.json": AEM_MANIFEST,
        })
    )
    assert source == "ondros"
    assert manifest["previewUrl"] == "https://site.example.com"


async def test_a_repo_with_no_manifest_says_what_to_commit():
    with pytest.raises(manifests.ManifestError) as exc:
        await manifests.discover(_fetcher({"README.md": "# hello"}))
    assert "component-definition.json" in str(exc.value)


async def test_malformed_manifest_is_reported_not_swallowed():
    with pytest.raises(manifests.ManifestError):
        await manifests.discover(_fetcher({"ondros/component-definition.json": "{ nope"}))


async def test_routes_come_from_the_manifest_then_convention():
    manifest = {"routes": {"article": "/blog/{slug}"}}
    assert manifests.route_for(manifest, "article", "hello") == "/blog/hello"
    assert manifests.route_for(manifest, "landing_page", "home") == "/landing_page/home"


# --- API ------------------------------------------------------------------------


async def test_state_reports_an_unconnected_space(client, workspace):
    ws = workspace
    res = await client.get(
        f"/spaces/{ws['space'].id}/code-sync", headers=auth(ws["tokens"]["ORG_ADMIN"])
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["connected"] is False
    assert body["connection"] is None
    # Without GITHUB_APP_* / GITHUB_TOKEN the server can't do this at all, and
    # the editor renders a different message for that.
    assert body["mode"] in ("none", "app", "token")


async def test_connecting_needs_server_configuration(client, workspace, monkeypatch):
    """With no GitHub credentials the server says so rather than half-connecting."""
    from app.config import get_settings

    monkeypatch.setenv("GITHUB_APP_ID", "")
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY", "")
    monkeypatch.setenv("GITHUB_TOKEN", "")
    get_settings.cache_clear()
    try:
        res = await client.post(
            f"/spaces/{workspace['space'].id}/code-sync/connect",
            json={"repo_full_name": "acme/site", "branch": "main"},
            headers=auth(workspace["tokens"]["ORG_ADMIN"]),
        )
        assert res.status_code == 503
        assert "not configured" in res.json()["detail"]
    finally:
        get_settings.cache_clear()


async def test_preview_target_refuses_when_not_connected(client, workspace):
    ws = workspace
    entry = await _create_entry(client, ws, ws["article_ct"], {"slug": "connected-check"})
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/code-sync/preview-target"
        f"?entry_id={entry['id']}",
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 409
    assert "not connected" in res.json()["detail"]


async def _create_entry(client, ws, ct, fields):
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={"content_type_id": str(ct.id), "fields": fields},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _connect(db_maker, ws, manifest: dict | None = None) -> None:
    """Fake a synced connection so preview resolution can be tested alone."""
    async with db_maker() as db:
        db.add(
            CodeSyncConnection(
                tenant_id=ws["tenant"].id,
                space_id=ws["space"].id,
                repo_full_name="acme/site",
                branch="main",
                preview_base_url="https://site.example.com",
                manifest=manifest
                or {
                    "previewUrl": "https://site.example.com",
                    "routes": {"article": "/blog/{slug}"},
                    "components": [
                        {"id": "article", "title": "Article", "contentType": "article",
                         "block": "article", "template": "", "fields": [], "source": "ondros"},
                        {"id": "block", "title": "Block", "contentType": "block",
                         "block": "block", "template": "", "fields": [], "source": "ondros"},
                    ],
                },
                manifest_source="ondros",
                manifest_path="ondros/component-definition.json",
                status=CodeSyncStatus.connected,
            )
        )
        await db.commit()


async def test_a_page_previews_at_its_own_url(client, workspace, db_maker):
    ws = workspace
    await _connect(db_maker, ws)
    entry = await _create_entry(client, ws, ws["article_ct"], {"slug": "hello"})
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/code-sync/preview-target"
        f"?entry_id={entry['id']}",
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "page"
    assert body["url"] == "https://site.example.com/blog/hello"
    assert body["focus_entry_id"] == ""


async def test_a_page_without_a_slug_is_unroutable(client, workspace, db_maker):
    ws = workspace
    await _connect(db_maker, ws)
    entry = await _create_entry(client, ws, ws["article_ct"], {"title": {"en-US": "Draft"}})
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/code-sync/preview-target"
        f"?entry_id={entry['id']}",
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.json()["mode"] == "unroutable"


async def test_a_block_previews_inside_a_page_that_references_it(client, workspace, db_maker):
    """Component-wise preview, the way the Universal Editor does it.

    ``block`` models no slug, so it has no page of its own. Previewing one
    resolves to a page that references it, with the component to reveal.
    """
    ws = workspace
    await _connect(db_maker, ws)
    block = await _create_entry(client, ws, ws["block_ct"], {"title": "Reusable"})
    page = await _create_entry(
        client, ws, ws["article_ct"], {"slug": "landing", "hero": block["id"]}
    )

    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/code-sync/preview-target"
        f"?entry_id={block['id']}",
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "component"
    # The URL is the *page's*; the block is pointed at with focus_entry_id so
    # the bridge can scroll to and outline that one component.
    assert body["url"] == "https://site.example.com/blog/landing"
    assert body["focus_entry_id"] == block["id"]
    assert body["host_entry_id"] == page["id"]


async def test_a_block_with_no_referencing_page_is_reported_as_orphaned(
    client, workspace, db_maker
):
    ws = workspace
    await _connect(db_maker, ws)
    block = await _create_entry(client, ws, ws["block_ct"], {"title": "Lonely"})
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/code-sync/preview-target"
        f"?entry_id={block['id']}",
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["mode"] == "orphan"
    assert body["focus_entry_id"] == block["id"]
    assert "No page references" in body["message"]


async def test_delivery_plane_serves_the_manifest_to_a_connected_site(
    client, workspace, db_maker
):
    ws = workspace
    await _connect(db_maker, ws)
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/delivery/code-sync",
        headers=auth(DELIVERY_TOKEN),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["connected"] is True
    assert body["previewUrl"] == "https://site.example.com"
    assert body["routes"] == {"article": "/blog/{slug}"}


async def test_webhook_rejects_an_unsigned_push(client):
    res = await client.post(
        "/code-sync/github/webhook",
        json={"ref": "refs/heads/main", "repository": {"full_name": "acme/site"}},
        headers={"X-GitHub-Event": "push"},
    )
    assert res.status_code == 401


# --- derivation (a repo that ships no manifest) --------------------------------


async def test_a_repo_with_no_manifest_is_mapped_by_convention():
    """Connecting a project shouldn't require committing a file first."""

    async def list_dir(path: str) -> list[str]:
        return ["hero", "cards", "carousel"] if path == "blocks" else []

    manifest, source, path = await manifests.discover(
        _fetcher({"README.md": "# hello"}), list_dir, ["hero", "card", "landing_page"]
    )
    assert source == "derived"
    assert path == ""
    by_type = {c["contentType"]: c for c in manifest["components"] if c["contentType"]}
    # Every content type gets a component, so none is reported as unmapped...
    assert set(by_type) == {"hero", "card", "landing_page"}
    # ...bound to the block of the same name where one exists.
    assert by_type["hero"]["block"] == "hero"
    # snake_case api_ids match kebab-case block folders.
    assert by_type["landing_page"]["block"] == "landing-page"
    # Blocks the model doesn't drive are still listed, with no content type.
    assert any(c["block"] == "carousel" and not c["contentType"] for c in manifest["components"])


async def test_derivation_needs_something_to_map():
    async def empty(path: str) -> list[str]:
        return []

    with pytest.raises(manifests.ManifestError) as exc:
        await manifests.discover(_fetcher({}), empty, [])
    assert "component-definition.json" in str(exc.value)


async def test_a_committed_manifest_beats_the_convention():
    async def list_dir(path: str) -> list[str]:
        return ["hero"] if path == "blocks" else []

    manifest, source, _ = await manifests.discover(
        _fetcher({"ondros/component-definition.json": ONDROS_MANIFEST}), list_dir, ["hero"]
    )
    assert source == "ondros"
    assert manifest["routes"] == {"article": "/blog/{slug}"}
