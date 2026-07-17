"""Spec 001: signup, verification, refresh rotation, reset, invitations,
account switching, cross-account isolation. AUTH_DEV_MODE returns tokens in
responses so no SMTP is needed."""
import uuid

import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio


async def _signup(client, slug=None):
    slug = slug or f"corp-{uuid.uuid4().hex[:8]}"
    res = await client.post("/auth/signup", json={
        "account_name": "Corp Inc",
        "account_slug": slug,
        "email": f"founder-{slug}@corp-inc.com",
        "password": "hunter2hunter2",
        "full_name": "Fiona Founder",
    })
    assert res.status_code == 201, res.text
    return res.json(), slug


async def test_signup_verify_login_roundtrip(client, workspace):
    data, slug = await _signup(client)
    assert data["dev_verification_token"]

    # Unverified login is blocked with a clear code.
    res = await client.post("/auth/login", json={
        "email": f"founder-{slug}@corp-inc.com", "password": "hunter2hunter2",
    })
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "email_unverified"

    # Verify -> logged in with a token pair.
    res = await client.post("/auth/verify-email", json={"token": data["dev_verification_token"]})
    assert res.status_code == 200
    pair = res.json()
    assert pair["access_token"] and pair["refresh_token"]

    # The new org admin can use the management API immediately.
    res = await client.get("/auth/me", headers=auth(pair["access_token"]))
    assert res.status_code == 200
    me = res.json()
    assert me["capabilities"] == ["*"]
    assert me["roles"][0]["role_name"] == "ORG_ADMIN"

    # Password login now works too.
    res = await client.post("/auth/login", json={
        "email": f"founder-{slug}@corp-inc.com", "password": "hunter2hunter2",
    })
    assert res.status_code == 200


async def test_refresh_rotation(client, workspace):
    data, slug = await _signup(client)
    pair = (await client.post("/auth/verify-email", json={"token": data["dev_verification_token"]})).json()

    res = await client.post("/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert res.status_code == 200
    pair2 = res.json()
    assert pair2["refresh_token"] != pair["refresh_token"]

    # The used refresh token is revoked.
    res = await client.post("/auth/refresh", json={"refresh_token": pair["refresh_token"]})
    assert res.status_code == 401
    # The rotated one still works.
    res = await client.post("/auth/refresh", json={"refresh_token": pair2["refresh_token"]})
    assert res.status_code == 200


async def test_password_reset_flow(client, workspace):
    data, slug = await _signup(client)
    await client.post("/auth/verify-email", json={"token": data["dev_verification_token"]})
    email = f"founder-{slug}@corp-inc.com"

    res = await client.post("/auth/forgot-password", json={"email": email})
    assert res.status_code == 200
    token = res.json()["dev_reset_token"]
    assert token

    # Unknown emails get the same 200 (no user enumeration).
    res = await client.post("/auth/forgot-password", json={"email": "ghost@nowhere-zzz.com"})
    assert res.status_code == 200
    assert res.json()["dev_reset_token"] is None

    res = await client.post("/auth/reset-password", json={"token": token, "password": "newpass12345"})
    assert res.status_code == 200
    res = await client.post("/auth/login", json={"email": email, "password": "newpass12345"})
    assert res.status_code == 200
    # Old password no longer works.
    res = await client.post("/auth/login", json={"email": email, "password": "hunter2hunter2"})
    assert res.status_code == 401


async def test_invitation_flow(client, db_maker, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    account_id = str(ws["tenant"].id)

    # The workspace already has 4 members; the free plan allows 2 seats.
    # Upgrade so the invitation isn't blocked by seat limits (tested separately).
    from app.models import Plan

    async with db_maker() as db:
        db.add(Plan(key="roomy", name="Roomy", price_month_usd=10,
                    limits={"seats": 25, "entries": 1000, "storage_bytes": 10**9,
                            "api_calls_month": 100000, "spaces": 5}))
        await db.commit()
    res = await client.post("/billing/dev-activate", json={"plan_key": "roomy"}, headers=admin)
    assert res.status_code == 200, res.text

    roles = (await client.get("/roles", headers=admin)).json()
    editor_role = next(r for r in roles if r["name"] == "EDITOR")

    res = await client.post(f"/accounts/{account_id}/invitations", json={
        "email": "newbie@corp-inc.com", "role_id": editor_role["id"], "space_id": str(ws["space"].id),
    }, headers=admin)
    assert res.status_code == 201, res.text
    invite_token = res.json()["dev_token"]

    # Public info endpoint.
    res = await client.get(f"/invitations/{invite_token}")
    assert res.status_code == 200
    assert res.json()["email"] == "newbie@corp-inc.com"
    assert res.json()["existing_user"] is False

    # Accept: creates the user + membership + role assignment, returns tokens.
    res = await client.post(f"/invitations/{invite_token}/accept", json={
        "password": "welcome12345", "full_name": "Nina New",
    })
    assert res.status_code == 200, res.text
    pair = res.json()

    me = (await client.get("/auth/me", headers=auth(pair["access_token"]))).json()
    assert me["roles"][0]["role_name"] == "EDITOR"
    assert "manage_entries" in me["capabilities"]

    # Accepting twice fails.
    res = await client.post(f"/invitations/{invite_token}/accept", json={"password": "welcome12345"})
    assert res.status_code == 404


async def test_cross_account_isolation(client, workspace):
    """A token for account B must not see account A's spaces or content."""
    ws = workspace
    data, slug = await _signup(client)
    pair = (await client.post("/auth/verify-email", json={"token": data["dev_verification_token"]})).json()
    other = auth(pair["access_token"])

    spaces = (await client.get("/spaces", headers=other)).json()
    assert spaces == []  # account A's space is invisible

    res = await client.get(
        f"/spaces/{ws['space'].id}/environments/master/entries", headers=other
    )
    assert res.status_code == 404  # space not found within account B

    res = await client.get(f"/spaces/{ws['space'].id}/api-keys", headers=other)
    assert res.status_code == 404


async def test_switch_account_requires_membership(client, workspace):
    ws = workspace
    data, slug = await _signup(client)
    pair = (await client.post("/auth/verify-email", json={"token": data["dev_verification_token"]})).json()

    # Founder of account B cannot switch into workspace A.
    res = await client.post("/auth/switch-account", json={"account_id": str(ws["tenant"].id)},
                            headers=auth(pair["access_token"]))
    assert res.status_code == 403

    # A token forged with account A's id but user B is rejected on use.
    from app.core.security import create_access_token

    forged = create_access_token(
        str(data["user_id"]), str(ws["tenant"].id), f"founder-{slug}@corp-inc.com"
    )
    res = await client.get("/spaces", headers=auth(forged))
    assert res.status_code == 403
