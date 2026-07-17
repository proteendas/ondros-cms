"""Delivery/preview API key scoping + published-only guarantees."""
import pytest

from tests.conftest import DELIVERY_TOKEN, PREVIEW_TOKEN, SCOPED_DELIVERY_TOKEN, auth

pytestmark = pytest.mark.asyncio


async def _make_entries(client, ws):
    """One published + one draft article via the management API."""
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/environments/master/entries"
    published = (
        await client.post(base, json={
            "content_type_id": str(ws["article_ct"].id),
            "slug": "live",
            "fields": {"title": {"en-US": "Live", "fr": "En ligne"}, "body": "<p>live</p>"},
        }, headers=admin)
    ).json()
    await client.post(f"/entries/{published['id']}/publish", headers=admin)
    draft = (
        await client.post(base, json={
            "content_type_id": str(ws["article_ct"].id),
            "slug": "draft",
            "fields": {"title": {"en-US": "Draft"}},
        }, headers=admin)
    ).json()
    return published, draft


async def test_delivery_key_sees_only_published(client, workspace):
    ws = workspace
    await _make_entries(client, ws)
    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"

    res = await client.get(url, headers=auth(DELIVERY_TOKEN))
    assert res.status_code == 200
    slugs = [i["slug"] for i in res.json()["items"]]
    assert slugs == ["live"]
    # delivery payloads never expose draft status
    assert "status" not in res.json()["items"][0]


async def test_preview_key_sees_drafts(client, workspace):
    ws = workspace
    await _make_entries(client, ws)
    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"

    res = await client.get(url, headers=auth(PREVIEW_TOKEN))
    slugs = {i["slug"] for i in res.json()["items"]}
    assert slugs == {"live", "draft"}
    statuses = {i["slug"]: i["status"] for i in res.json()["items"]}
    assert statuses["draft"] == "draft"


async def test_query_param_token_works(client, workspace):
    ws = workspace
    await _make_entries(client, ws)
    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/delivery/entries"
        f"?access_token={DELIVERY_TOKEN}"
    )
    assert res.status_code == 200


async def test_environment_scoped_key(client, workspace):
    ws = workspace
    ok = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/delivery/entries",
        headers=auth(SCOPED_DELIVERY_TOKEN),
    )
    assert ok.status_code == 200

    denied = await client.get(
        f"/spaces/{ws['space'].id}/environments/staging/delivery/entries",
        headers=auth(SCOPED_DELIVERY_TOKEN),
    )
    assert denied.status_code == 403


async def test_wrong_space_rejected(client, workspace):
    import uuid

    other_space = uuid.uuid4()
    res = await client.get(
        f"/spaces/{other_space}/environments/master/delivery/entries",
        headers=auth(DELIVERY_TOKEN),
    )
    assert res.status_code == 403


async def test_locale_resolution_and_includes(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/environments/master/entries"

    hero = (
        await client.post(base, json={
            "content_type_id": str(ws["hero_ct"].id),
            "slug": "hero-1",
            "fields": {"heading": "Big heading"},
        }, headers=admin)
    ).json()
    await client.post(f"/entries/{hero['id']}/publish", headers=admin)

    article = (
        await client.post(base, json={
            "content_type_id": str(ws["article_ct"].id),
            "slug": "with-hero",
            "fields": {"title": {"en-US": "Hello", "fr": "Bonjour"}, "hero": hero["id"]},
        }, headers=admin)
    ).json()
    await client.post(f"/entries/{article['id']}/publish", headers=admin)

    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"

    # default locale collapses the localized dict
    res = (await client.get(f"{url}?slug=with-hero", headers=auth(DELIVERY_TOKEN))).json()
    item = res["items"][0]
    assert item["fields"]["title"] == "Hello"

    # explicit locale with fallback
    res = (await client.get(f"{url}?slug=with-hero&locale=fr", headers=auth(DELIVERY_TOKEN))).json()
    assert res["items"][0]["fields"]["title"] == "Bonjour"

    # include=1 resolves the hero reference
    included = res["includes"]["Entry"]
    assert any(e["slug"] == "hero-1" for e in included)


async def test_fields_filters(client, workspace):
    """fields.<id>=<value> filters: plain values exact-match; localized match any locale."""
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/environments/master/entries"

    for slug, title, body in (
        ("tech-post", {"en-US": "Tech"}, "<p>category-tech</p>"),
        ("life-post", {"en-US": "Life"}, "<p>category-life</p>"),
    ):
        entry = (
            await client.post(base, json={
                "content_type_id": str(ws["article_ct"].id),
                "slug": slug,
                "fields": {"title": title, "body": body},
            }, headers=admin)
        ).json()
        await client.post(f"/entries/{entry['id']}/publish", headers=admin)

    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"

    # Plain (non-localized) field exact match.
    res = (
        await client.get(f"{url}?fields.body=%3Cp%3Ecategory-tech%3C/p%3E", headers=auth(DELIVERY_TOKEN))
    ).json()
    assert [i["slug"] for i in res["items"]] == ["tech-post"]

    # Localized field: value matches in any locale.
    res = (await client.get(f"{url}?fields.title=Life", headers=auth(DELIVERY_TOKEN))).json()
    assert [i["slug"] for i in res["items"]] == ["life-post"]

    # No match -> empty.
    res = (await client.get(f"{url}?fields.title=Nope", headers=auth(DELIVERY_TOKEN))).json()
    assert res["items"] == []
