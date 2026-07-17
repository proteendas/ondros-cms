"""Role/capability enforcement across the management API."""
import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio


async def _create_entry(client, ws, token, slug="hello"):
    return await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={
            "content_type_id": str(ws["article_ct"].id),
            "slug": slug,
            "fields": {"title": {"en-US": "Hello"}, "body": "<p>hi</p>"},
        },
        headers=auth(token),
    )


async def test_viewer_cannot_create_entry(client, workspace):
    res = await _create_entry(client, workspace, workspace["tokens"]["VIEWER"])
    assert res.status_code == 403
    assert "manage_entries" in res.json()["detail"]


async def test_author_can_draft_but_not_publish(client, workspace):
    tokens = workspace["tokens"]
    res = await _create_entry(client, workspace, tokens["AUTHOR"])
    assert res.status_code == 201
    entry_id = res.json()["id"]

    res = await client.post(f"/entries/{entry_id}/publish", headers=auth(tokens["AUTHOR"]))
    assert res.status_code == 403

    res = await client.post(f"/entries/{entry_id}/publish", headers=auth(tokens["EDITOR"]))
    assert res.status_code == 200
    assert res.json()["status"] == "published"


async def test_editor_cannot_manage_content_types(client, workspace):
    ws = workspace
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={"name": "X", "api_id": "x", "fields": []},
        headers=auth(ws["tokens"]["EDITOR"]),
    )
    assert res.status_code == 403

    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={"name": "X", "api_id": "x", "fields": []},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 201


async def test_editor_cannot_manage_api_keys(client, workspace):
    ws = workspace
    res = await client.get(
        f"/spaces/{ws['space'].id}/api-keys", headers=auth(ws["tokens"]["EDITOR"])
    )
    assert res.status_code == 403

    res = await client.get(
        f"/spaces/{ws['space'].id}/api-keys", headers=auth(ws["tokens"]["ORG_ADMIN"])
    )
    assert res.status_code == 200
    assert len(res.json()) == 4


async def test_management_api_key_acts_as_space_admin(client, workspace):
    from tests.conftest import MANAGEMENT_TOKEN

    ws = workspace
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        headers=auth(MANAGEMENT_TOKEN),
    )
    assert res.status_code == 200

    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={"name": "Via key", "api_id": "via_key", "fields": []},
        headers=auth(MANAGEMENT_TOKEN),
    )
    assert res.status_code == 201


async def test_delivery_key_rejected_on_management_routes(client, workspace):
    from tests.conftest import DELIVERY_TOKEN

    res = await client.get(
        f"/spaces/{workspace['space'].id}/environments/master/entries",
        headers=auth(DELIVERY_TOKEN),
    )
    assert res.status_code == 401


async def test_me_reports_roles_and_capabilities(client, workspace):
    res = await client.get("/auth/me", headers=auth(workspace["tokens"]["EDITOR"]))
    assert res.status_code == 200
    data = res.json()
    assert data["roles"][0]["role_name"] == "EDITOR"
    assert "publish_entries" in data["capabilities"]
    assert "manage_api_keys" not in data["capabilities"]
