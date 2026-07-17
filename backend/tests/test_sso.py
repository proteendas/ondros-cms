"""Spec 002: SSO config CRUD, domain lookup, enforcement, authorize redirect."""
import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio

FAKE_DISCOVERY = {
    "issuer": "https://idp.corp-inc.com",
    "authorization_endpoint": "https://idp.corp-inc.com/authorize",
    "token_endpoint": "https://idp.corp-inc.com/token",
    "jwks_uri": "https://idp.corp-inc.com/jwks",
}


async def _create_config(client, ws, admin, enforced=False):
    res = await client.post(f"/accounts/{ws['tenant'].id}/sso", json={
        "provider_type": "oidc",
        "name": "Corp Okta",
        "discovery_url": "https://idp.corp-inc.com/.well-known/openid-configuration",
        "client_id": "corp-client",
        "client_secret": "s3cret",
        "email_domain": "corp-inc.com",
        "enforced": enforced,
    }, headers=admin)
    assert res.status_code == 201, res.text
    return res.json()


async def test_config_crud_and_permissions(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    config = await _create_config(client, ws, admin)
    assert config["has_client_secret"] is True

    # Secrets never leak in responses.
    listed = (await client.get(f"/accounts/{ws['tenant'].id}/sso", headers=admin)).json()
    assert "client_secret" not in listed[0]

    # Update without a secret keeps the stored one.
    res = await client.patch(f"/accounts/{ws['tenant'].id}/sso/{config['id']}", json={
        "provider_type": "oidc", "name": "Renamed",
        "discovery_url": config["discovery_url"], "client_id": "corp-client",
        "client_secret": "", "email_domain": "corp-inc.com",
        "enforced": False, "enabled": True, "default_role_name": "AUTHOR",
    }, headers=admin)
    assert res.status_code == 200
    assert res.json()["has_client_secret"] is True

    # Editors cannot manage SSO.
    res = await client.get(f"/accounts/{ws['tenant'].id}/sso",
                           headers=auth(ws["tokens"]["EDITOR"]))
    assert res.status_code == 403


async def test_lookup_and_enforced_password_block(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await _create_config(client, ws, admin, enforced=True)

    res = await client.get("/sso/lookup", params={"email": "someone@corp-inc.com"})
    assert res.status_code == 200
    body = res.json()
    assert body["sso_required"] is True
    assert body["login_url"].endswith("/login")

    # Unknown domains are untouched.
    res = await client.get("/sso/lookup", params={"email": "x@elsewhere-zzz.com"})
    assert res.json()["sso_available"] is False

    # Password login for the enforced domain is refused with the SSO pointer.
    res = await client.post("/auth/login", json={
        "email": "someone@corp-inc.com", "password": "whatever123",
    })
    assert res.status_code == 428
    assert res.json()["detail"]["code"] == "sso_required"


async def test_login_redirects_to_idp(client, workspace, monkeypatch):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await _create_config(client, ws, admin)

    async def fake_discovery(url):
        return FAKE_DISCOVERY

    import app.core.oidc as oidc

    monkeypatch.setattr(oidc, "fetch_discovery", fake_discovery)

    res = await client.get(f"/sso/{ws['tenant'].slug}/login", follow_redirects=False)
    assert res.status_code == 302
    location = res.headers["location"]
    assert location.startswith("https://idp.corp-inc.com/authorize?")
    assert "client_id=corp-client" in location
    assert "state=" in location


async def test_saml_runtime_gated(client, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    res = await client.post(f"/accounts/{ws['tenant'].id}/sso", json={
        "provider_type": "saml", "name": "Corp SAML",
        "metadata_xml": "<EntityDescriptor/>", "email_domain": "corp-inc.com",
    }, headers=admin)
    assert res.status_code == 201
    res = await client.get(f"/sso/{ws['tenant'].slug}/login", follow_redirects=False)
    assert res.status_code == 501  # python3-saml not installed
