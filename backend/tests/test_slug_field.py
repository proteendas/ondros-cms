"""Slugs live in the content model, Contentful-style.

A content type is addressable by URL because it models a field of type `slug`;
Entry.slug is the denormalized mirror delivery filters and routes on. Types
with no slug field (reusable blocks) never ask their authors for one.
"""
import pytest

from tests.conftest import DELIVERY_TOKEN, auth

pytestmark = pytest.mark.asyncio


def _entries_url(ws) -> str:
    return f"/spaces/{ws['space'].id}/environments/master/entries"


async def _create(client, ws, ct, fields=None, **extra):
    res = await client.post(
        _entries_url(ws),
        json={"content_type_id": str(ct.id), "fields": fields or {}, **extra},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    return res


async def test_entry_of_slugless_type_needs_no_slug(client, workspace):
    ws = workspace
    res = await _create(client, ws, ws["block_ct"], {"title": "A block"})
    assert res.status_code == 201, res.text
    assert res.json()["slug"] is None


async def test_slug_comes_from_the_slug_field(client, workspace):
    ws = workspace
    res = await _create(
        client, ws, ws["article_ct"], {"title": {"en-US": "Hi"}, "slug": "hello-world"}
    )
    assert res.status_code == 201, res.text
    assert res.json()["slug"] == "hello-world"


async def test_editing_the_slug_field_moves_the_entry(client, workspace):
    ws = workspace
    entry = (await _create(client, ws, ws["article_ct"], {"slug": "first"})).json()
    res = await client.patch(
        f"/entries/{entry['id']}",
        json={"fields": {"slug": "second"}},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 200, res.text
    assert res.json()["slug"] == "second"


async def test_clearing_the_slug_field_clears_the_route(client, workspace):
    ws = workspace
    entry = (await _create(client, ws, ws["article_ct"], {"slug": "temporary"})).json()
    res = await client.patch(
        f"/entries/{entry['id']}",
        json={"fields": {"slug": ""}},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 200, res.text
    assert res.json()["slug"] is None


async def test_duplicate_slug_is_rejected(client, workspace):
    ws = workspace
    assert (await _create(client, ws, ws["article_ct"], {"slug": "taken"})).status_code == 201
    dup = await _create(client, ws, ws["article_ct"], {"slug": "taken"})
    assert dup.status_code == 409, dup.text


async def test_duplicate_slug_is_rejected_on_update(client, workspace):
    ws = workspace
    assert (await _create(client, ws, ws["article_ct"], {"slug": "one"})).status_code == 201
    other = (await _create(client, ws, ws["article_ct"], {"slug": "two"})).json()
    res = await client.patch(
        f"/entries/{other['id']}",
        json={"fields": {"slug": "one"}},
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 409, res.text


async def test_slugless_type_ignores_a_posted_slug(client, workspace):
    """The top-level `slug` alias is a convenience for clients, not a way to
    give a block a URL it does not model."""
    ws = workspace
    res = await _create(client, ws, ws["block_ct"], {"title": "Block"}, slug="sneaky")
    assert res.status_code == 201, res.text
    assert res.json()["slug"] is None
    assert "slug" not in res.json()["fields"]


async def test_slug_alias_writes_into_the_slug_field(client, workspace):
    ws = workspace
    res = await _create(client, ws, ws["article_ct"], {"title": {"en-US": "T"}}, slug="via-alias")
    assert res.status_code == 201, res.text
    assert res.json()["slug"] == "via-alias"
    assert res.json()["fields"]["slug"] == "via-alias"


async def test_content_type_reports_its_slug_field(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    article = (await client.get(f"/content-types/{ws['article_ct'].id}", headers=admin)).json()
    block = (await client.get(f"/content-types/{ws['block_ct'].id}", headers=admin)).json()
    assert article["slug_field"] == "slug"
    assert block["slug_field"] is None


async def test_at_most_one_slug_field_per_type(client, workspace):
    ws = workspace
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={
            "name": "Two slugs",
            "api_id": "two_slugs",
            "fields": [
                {"id": "a", "name": "A", "type": "slug"},
                {"id": "b", "name": "B", "type": "slug"},
            ],
        },
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 422
    assert "at most one slug field" in res.json()["detail"]


async def test_slug_field_cannot_be_nested_in_a_group(client, workspace):
    ws = workspace
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={
            "name": "Nested slug",
            "api_id": "nested_slug",
            "fields": [
                {
                    "id": "rows", "name": "Rows", "type": "group",
                    "fields": [{"id": "path", "name": "Path", "type": "slug"}],
                }
            ],
        },
        headers=auth(ws["tokens"]["ORG_ADMIN"]),
    )
    assert res.status_code == 422
    assert "cannot live inside a repeatable group" in res.json()["detail"]


async def test_malformed_slug_blocks_publish(client, workspace):
    ws = workspace
    entry = (
        await _create(client, ws, ws["article_ct"], {"title": {"en-US": "T"}, "slug": "Not A Slug"})
    ).json()
    res = await client.post(
        f"/entries/{entry['id']}/publish", headers=auth(ws["tokens"]["ORG_ADMIN"])
    )
    assert res.status_code == 422
    assert any("must be a URL slug" in e for e in res.json()["detail"]["errors"])


async def test_delivery_exposes_slug_field_and_null_slug(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    block = (await _create(client, ws, ws["block_ct"], {"title": "Block"})).json()
    assert (await client.post(f"/entries/{block['id']}/publish", headers=admin)).status_code == 200

    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries/{block['id']}"
    res = await client.get(url, headers=auth(DELIVERY_TOKEN))
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["slug"] is None
    assert body["contentType"]["slugField"] is None
