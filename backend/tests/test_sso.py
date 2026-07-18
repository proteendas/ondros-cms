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


# --- Spec 012: GitHub OAuth + social JIT provisioning ------------------------------


async def test_sso_options_gates_github(client, workspace, monkeypatch):
    import app.api.sso as sso

    res = await client.get("/sso/options")
    assert res.json()["github"] is False
    res = await client.get("/sso/github/login", follow_redirects=False)
    assert res.status_code == 404

    monkeypatch.setattr(sso.settings, "github_client_id", "gh-client")
    res = await client.get("/sso/options")
    assert res.json()["github"] is True


async def test_github_login_redirects_with_state(client, workspace, monkeypatch):
    import app.api.sso as sso

    monkeypatch.setattr(sso.settings, "github_client_id", "gh-client")
    res = await client.get("/sso/github/login", follow_redirects=False)
    assert res.status_code == 302
    location = res.headers["location"]
    assert location.startswith("https://github.com/login/oauth/authorize?")
    assert "client_id=gh-client" in location
    assert "state=" in location
    # Redirect URI derives from settings.backend_url (spec 012).
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fsso%2Fgithub%2Fcallback" in location


async def test_github_callback_jit_provisions_personal_account(
    client, workspace, db_maker, monkeypatch
):
    """Unknown email through GitHub -> personal Account + ORG_ADMIN user + pair."""
    from sqlalchemy import select

    import app.api.sso as sso
    from app.core.security import create_state_token
    from app.models import AccountMember, AuditLog, Tenant, User

    monkeypatch.setattr(sso.settings, "github_client_id", "gh-client")
    monkeypatch.setattr(sso.settings, "github_client_secret", "gh-secret")

    async def fake_exchange(client_id, client_secret, code, redirect_uri):
        return {"email": "newcomer@somewhere-zzz.com", "name": "New Comer"}

    monkeypatch.setattr(sso.oauth_github, "exchange_code", fake_exchange)

    state = create_state_token({"slug": "github"})
    res = await client.get(
        f"/sso/github/callback?code=abc&state={state}", follow_redirects=False
    )
    assert res.status_code == 302, res.text
    assert "#access=" in res.headers["location"]
    assert "refresh=" in res.headers["location"]

    async with db_maker() as db:
        user = (
            await db.execute(select(User).where(User.email == "newcomer@somewhere-zzz.com"))
        ).scalars().one()
        assert user.email_verified is True
        assert user.hashed_password == "!sso!"
        account = (await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))).scalars().one()
        assert "Workspace" in account.name
        member = (
            await db.execute(
                select(AccountMember).where(
                    AccountMember.user_id == user.id, AccountMember.tenant_id == account.id
                )
            )
        ).scalars().one()
        assert member.is_owner is True
        roles = {a.role.name for a in user.assignments}
        assert "ORG_ADMIN" in roles
        audit_row = (
            await db.execute(select(AuditLog).where(AuditLog.action == "account.signup_social"))
        ).scalars().one()
        assert audit_row.diff["provider"] == "github"

    # Second sign-in: same user, no duplicate account.
    res = await client.get(
        f"/sso/github/callback?code=abc&state={create_state_token({'slug': 'github'})}",
        follow_redirects=False,
    )
    assert res.status_code == 302
    async with db_maker() as db:
        count = len((await db.execute(select(User).where(User.email == "newcomer@somewhere-zzz.com"))).scalars().all())
        assert count == 1
