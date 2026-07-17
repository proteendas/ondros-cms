"""Content type validation + reference integrity on publish."""
import uuid

import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio


async def _create(client, ws, fields, slug):
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/entries",
        json={"content_type_id": str(ws["article_ct"].id), "slug": slug, "fields": fields},
        headers=admin,
    )
    assert res.status_code == 201, res.text
    return res.json()


async def test_required_localized_field_blocks_publish(client, workspace):
    ws = workspace
    entry = await _create(client, ws, {"title": {"fr": "Seulement en français"}}, "no-default-locale")
    res = await client.post(f"/entries/{entry['id']}/publish", headers=auth(ws["tokens"]["ORG_ADMIN"]))
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert any("required in the default locale" in e for e in errors)


async def test_unknown_locale_rejected(client, workspace):
    ws = workspace
    entry = await _create(client, ws, {"title": {"en-US": "ok", "de": "nein"}}, "bad-locale")
    res = await client.post(f"/entries/{entry['id']}/publish", headers=auth(ws["tokens"]["ORG_ADMIN"]))
    assert res.status_code == 422
    assert any("unknown locales" in e for e in res.json()["detail"]["errors"])


async def test_reference_must_exist_in_environment(client, workspace):
    ws = workspace
    ghost = str(uuid.uuid4())
    entry = await _create(client, ws, {"title": {"en-US": "ok"}, "hero": ghost}, "ghost-ref")
    res = await client.post(f"/entries/{entry['id']}/publish", headers=auth(ws["tokens"]["ORG_ADMIN"]))
    assert res.status_code == 422
    assert any("not found in this environment" in e for e in res.json()["detail"]["errors"])


async def test_reference_content_type_must_be_allowed(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    other_article = await _create(client, ws, {"title": {"en-US": "other"}}, "other")
    # 'hero' field only allows content type "hero", not "article"
    entry = await _create(
        client, ws, {"title": {"en-US": "ok"}, "hero": other_article["id"]}, "bad-type-ref"
    )
    res = await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    assert res.status_code == 422
    assert any("allowed" in e for e in res.json()["detail"]["errors"])


async def test_self_reference_rejected(client, workspace):
    ws = workspace
    entry = await _create(client, ws, {"title": {"en-US": "ok"}}, "selfy")
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await client.patch(
        f"/entries/{entry['id']}",
        json={"fields": {"related": [entry["id"]]}},
        headers=admin,
    )
    res = await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    assert res.status_code == 422
    assert any("cannot reference itself" in e for e in res.json()["detail"]["errors"])


async def test_valid_entry_publishes(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    hero = (
        await client.post(
            f"/spaces/{ws['space'].id}/environments/master/entries",
            json={"content_type_id": str(ws["hero_ct"].id), "slug": "h",
                  "fields": {"heading": "H"}},
            headers=admin,
        )
    ).json()
    await client.post(f"/entries/{hero['id']}/publish", headers=admin)

    entry = await _create(
        client, ws,
        {"title": {"en-US": "ok", "fr": "d'accord"}, "hero": hero["id"], "body": "<p>x</p>"},
        "all-good",
    )
    res = await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "published"
    assert res.json()["published_fields"]["title"]["fr"] == "d'accord"


async def test_select_field_requires_allowed_values(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    res = await client.post(
        f"/spaces/{ws['space'].id}/environments/master/content-types",
        json={
            "name": "Bad", "api_id": "bad",
            "fields": [{"id": "kind", "name": "Kind", "type": "select"}],
        },
        headers=admin,
    )
    assert res.status_code == 422


async def test_environment_clone_remaps_references(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/environments/master/entries"

    hero = (
        await client.post(base, json={
            "content_type_id": str(ws["hero_ct"].id), "slug": "clone-hero",
            "fields": {"heading": "H"},
        }, headers=admin)
    ).json()
    article = (
        await client.post(base, json={
            "content_type_id": str(ws["article_ct"].id), "slug": "clone-article",
            "fields": {"title": {"en-US": "A"}, "hero": hero["id"]},
        }, headers=admin)
    ).json()

    res = await client.post(
        f"/spaces/{ws['space'].id}/environments",
        json={"key": "feature-x", "name": "Feature X",
              "clone_from_environment_id": str(ws["master"].id)},
        headers=admin,
    )
    assert res.status_code == 201, res.text
    assert res.json()["cloned"]["content_types"] >= 2
    assert res.json()["cloned"]["entries"] >= 2

    cloned = (
        await client.get(
            f"/spaces/{ws['space'].id}/environments/feature-x/entries?content_type=article&q=clone-article",
            headers=admin,
        )
    ).json()["items"]
    clone_article = next(e for e in cloned if e["slug"] == "clone-article")
    # The reference now points at the *cloned* hero, not the master one.
    assert clone_article["fields"]["hero"] != hero["id"]
    assert clone_article["id"] != article["id"]
