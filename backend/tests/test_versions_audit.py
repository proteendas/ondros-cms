"""Spec 006: entry version snapshots, restore, audit trail."""
import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio


async def _make_entry(client, ws, admin, slug="versioned"):
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={
            "content_type_id": str(ws["article_ct"].id),
            "slug": slug,
            "fields": {"title": {"en-US": "v1 title"}},
        },
        headers=admin,
    )
    assert res.status_code == 201
    return res.json()


async def test_versions_created_and_restored(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    entry = await _make_entry(client, ws, admin)

    # Two edits -> snapshots of v1 and v2.
    await client.patch(f"/entries/{entry['id']}",
                       json={"fields": {"title": {"en-US": "v2 title"}}}, headers=admin)
    await client.patch(f"/entries/{entry['id']}",
                       json={"fields": {"title": {"en-US": "v3 title"}}}, headers=admin)

    versions = (await client.get(f"/entries/{entry['id']}/versions", headers=admin)).json()
    assert [v["version"] for v in versions] == [2, 1]

    v1 = (await client.get(f"/entries/{entry['id']}/versions/1", headers=admin)).json()
    assert v1["fields"]["title"]["en-US"] == "v1 title"

    # Restore v1 -> becomes the new draft state as version 4.
    res = await client.post(f"/entries/{entry['id']}/versions/1/restore", headers=admin)
    assert res.status_code == 200, res.text
    restored = res.json()
    assert restored["fields"]["title"]["en-US"] == "v1 title"
    assert restored["version"] == 4

    # The pre-restore state (v3) was snapshotted too.
    versions = (await client.get(f"/entries/{entry['id']}/versions", headers=admin)).json()
    assert [v["version"] for v in versions] == [3, 2, 1]


async def test_transition_snapshots_and_permissions(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    viewer = auth(ws["tokens"]["VIEWER"])
    entry = await _make_entry(client, ws, admin, slug="v-perms")

    await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    versions = (await client.get(f"/entries/{entry['id']}/versions", headers=admin)).json()
    assert versions  # publish snapshotted the draft state

    # Viewers can read history but not restore.
    res = await client.get(f"/entries/{entry['id']}/versions", headers=viewer)
    assert res.status_code == 200
    res = await client.post(f"/entries/{entry['id']}/versions/1/restore", headers=viewer)
    assert res.status_code == 403


async def test_audit_log_records_actions(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    entry = await _make_entry(client, ws, admin, slug="audited")
    await client.patch(f"/entries/{entry['id']}",
                       json={"fields": {"title": {"en-US": "changed"}}}, headers=admin)
    await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    await client.delete(f"/entries/{entry['id']}", headers=admin)

    log = (
        await client.get(f"/spaces/{ws['space'].id}/audit-log?resource_type=entry", headers=admin)
    ).json()
    actions = [row["action"] for row in log["items"]]
    for expected in ("entry.create", "entry.update", "entry.published", "entry.delete"):
        assert expected in actions, actions

    update_row = next(r for r in log["items"] if r["action"] == "entry.update")
    assert "title" in update_row["diff"]
    assert update_row["actor_label"].endswith("@t.test")

    # Viewers cannot read the account-wide log (manage_users required).
    res = await client.get("/audit-log", headers=auth(ws["tokens"]["VIEWER"]))
    assert res.status_code == 403
