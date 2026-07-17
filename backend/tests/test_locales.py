"""Spec 003: locale CRUD, defaults, cache sync, delivery fallback chains."""
import pytest

from tests.conftest import DELIVERY_TOKEN, auth

pytestmark = pytest.mark.asyncio


async def test_locale_crud_and_cache_sync(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/locales"

    rows = (await client.get(base, headers=admin)).json()
    assert [l["code"] for l in rows] == ["en-US", "fr"]
    assert rows[0]["is_default"] is True

    # Add hi-IN with fallback to fr.
    res = await client.post(base, json={"code": "hi-IN", "name": "Hindi", "fallback_code": "fr"},
                            headers=admin)
    assert res.status_code == 201, res.text
    hi = res.json()
    assert hi["fallback_code"] == "fr"

    # Cache sync: the space now lists three locales.
    spaces = (await client.get("/spaces", headers=admin)).json()
    space = next(s for s in spaces if s["id"] == str(ws["space"].id))
    assert [l["code"] for l in space["locales"]] == ["en-US", "fr", "hi-IN"]

    # Default locale cannot be deleted or deactivated.
    default_id = rows[0]["id"]
    assert (await client.delete(f"{base}/{default_id}", headers=admin)).status_code == 422
    res = await client.patch(f"{base}/{default_id}", json={"is_active": False}, headers=admin)
    assert res.status_code == 422

    # Switch default to fr, then the old default becomes deletable.
    fr_id = rows[1]["id"]
    res = await client.post(f"{base}/{fr_id}/make-default", headers=admin)
    assert res.status_code == 200
    spaces = (await client.get("/spaces", headers=admin)).json()
    space = next(s for s in spaces if s["id"] == str(ws["space"].id))
    assert space["default_locale"] == "fr"

    # Editors (no manage_settings) cannot mutate locales.
    res = await client.post(base, json={"code": "de", "name": "German"},
                            headers=auth(ws["tokens"]["EDITOR"]))
    assert res.status_code == 403

    # Self-fallback rejected.
    res = await client.patch(f"{base}/{hi['id']}", json={"fallback_code": "hi-IN"}, headers=admin)
    assert res.status_code == 422


async def test_delivery_fallback_chain(client, workspace):
    """hi-IN -> fr -> (default en-US): missing hi-IN copy falls back to fr."""
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    base = f"/spaces/{ws['space'].id}/locales"
    await client.post(base, json={"code": "hi-IN", "name": "Hindi", "fallback_code": "fr"},
                      headers=admin)

    entry = (
        await client.post(
            f"/spaces/{ws['space'].id}/environments/master/entries",
            json={
                "content_type_id": str(ws["article_ct"].id),
                "slug": "chain",
                "fields": {"title": {"en-US": "Hello", "fr": "Bonjour"}},
            },
            headers=admin,
        )
    ).json()
    await client.post(f"/entries/{entry['id']}/publish", headers=admin)

    url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries?slug=chain"
    # hi-IN has no value -> falls back through the chain to fr.
    res = (await client.get(f"{url}&locale=hi-IN", headers=auth(DELIVERY_TOKEN))).json()
    assert res["items"][0]["fields"]["title"] == "Bonjour"
    # fr resolves directly; en-US resolves directly.
    res = (await client.get(f"{url}&locale=en-US", headers=auth(DELIVERY_TOKEN))).json()
    assert res["items"][0]["fields"]["title"] == "Hello"


async def test_publish_accepts_dynamic_locales(client, workspace):
    """Adding a locale immediately makes it valid for entry values."""
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await client.post(f"/spaces/{ws['space'].id}/locales",
                      json={"code": "pt-BR", "name": "Portuguese"}, headers=admin)

    entry = (
        await client.post(
            f"/spaces/{ws['space'].id}/environments/master/entries",
            json={
                "content_type_id": str(ws["article_ct"].id),
                "slug": "pt",
                "fields": {"title": {"en-US": "Hi", "pt-BR": "Oi"}},
            },
            headers=admin,
        )
    ).json()
    res = await client.post(f"/entries/{entry['id']}/publish", headers=admin)
    assert res.status_code == 200, res.text
