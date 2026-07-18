"""Spec 013: platform admin access control, account suspension across API
planes, user suspend/reactivate, impersonation with audit trail."""
import uuid

import pytest
from sqlalchemy import select

from app.core.security import create_access_token, hash_password
from app.models import AccountMember, AuditLog, User
from tests.conftest import DELIVERY_TOKEN, auth

pytestmark = pytest.mark.asyncio


async def _platform_admin(db_maker, workspace) -> dict:
    """A flagged platform operator + its JWT headers."""
    async with db_maker() as db:
        user = User(
            tenant_id=workspace["tenant"].id,
            email=f"padmin-{uuid.uuid4().hex[:6]}@ops-corp.com",
            hashed_password=hash_password("super-pass-123"),
            full_name="Platform Admin",
            email_verified=True,
            is_platform_admin=True,
        )
        db.add(user)
        await db.flush()
        db.add(AccountMember(tenant_id=workspace["tenant"].id, user_id=user.id))
        await db.commit()
        return {"user": user, "headers": auth(create_access_token(str(user.id), str(user.tenant_id), user.email))}


async def test_platform_routes_require_flag(client, workspace, db_maker):
    org_admin = auth(workspace["tokens"]["ORG_ADMIN"])
    res = await client.get("/platform/me", headers=org_admin)
    assert res.status_code == 403

    res = await client.get("/platform/overview", headers=org_admin)
    assert res.status_code == 403

    padmin = await _platform_admin(db_maker, workspace)
    res = await client.get("/platform/me", headers=padmin["headers"])
    assert res.status_code == 200
    assert res.json()["email"] == padmin["user"].email

    # API keys are JWT-less on this plane -> rejected outright.
    res = await client.get("/platform/me", headers=auth(DELIVERY_TOKEN))
    assert res.status_code in (401, 403)


async def test_overview_reports_totals_and_signups(client, workspace, db_maker):
    padmin = await _platform_admin(db_maker, workspace)
    res = await client.get("/platform/overview", headers=padmin["headers"])
    assert res.status_code == 200
    body = res.json()
    assert body["accounts"] >= 1
    assert body["spaces"] >= 1
    assert len(body["signups_last_30_days"]) == 31
    assert sum(p["count"] for p in body["signups_last_30_days"]) >= 1


async def test_account_suspension_blocks_all_planes(client, workspace, db_maker):
    ws = workspace
    padmin = await _platform_admin(db_maker, ws)
    org_admin = auth(ws["tokens"]["ORG_ADMIN"])

    # Baseline: both planes work.
    assert (await client.get("/spaces", headers=org_admin)).status_code == 200
    delivery_url = f"/spaces/{ws['space'].id}/environments/master/delivery/entries"
    assert (await client.get(delivery_url, headers=auth(DELIVERY_TOKEN))).status_code == 200

    res = await client.post(f"/platform/accounts/{ws['tenant'].id}/suspend", headers=padmin["headers"])
    assert res.status_code == 200 and res.json()["status"] == "suspended"

    res = await client.get("/spaces", headers=org_admin)
    assert res.status_code == 403
    assert res.json()["detail"]["code"] == "account_suspended"
    res = await client.get(delivery_url, headers=auth(DELIVERY_TOKEN))
    assert res.status_code == 403

    res = await client.post(f"/platform/accounts/{ws['tenant'].id}/reactivate", headers=padmin["headers"])
    assert res.status_code == 200 and res.json()["status"] == "active"
    assert (await client.get("/spaces", headers=org_admin)).status_code == 200
    assert (await client.get(delivery_url, headers=auth(DELIVERY_TOKEN))).status_code == 200

    # Both actions were audited with the acting admin's identity.
    async with db_maker() as db:
        rows = (
            await db.execute(select(AuditLog).where(AuditLog.action.like("platform.account_%")))
        ).scalars().all()
        assert {r.action for r in rows} == {"platform.account_suspend", "platform.account_reactivate"}
        assert all(r.actor_id == padmin["user"].id for r in rows)
        assert all(r.actor_label.startswith("platform-admin:") for r in rows)


async def test_user_suspend_and_reactivate(client, workspace, db_maker):
    ws = workspace
    padmin = await _platform_admin(db_maker, ws)
    editor = ws["users"]["EDITOR"]

    editor_headers = auth(ws["tokens"]["EDITOR"])
    assert (await client.get("/auth/me", headers=editor_headers)).status_code == 200

    res = await client.post(f"/platform/users/{editor.id}/suspend", headers=padmin["headers"])
    assert res.status_code == 200 and res.json()["is_active"] is False
    # Suspended users fail authentication everywhere (_load_user rejects inactive).
    assert (await client.get("/auth/me", headers=editor_headers)).status_code == 401

    res = await client.post(f"/platform/users/{editor.id}/reactivate", headers=padmin["headers"])
    assert res.status_code == 200 and res.json()["is_active"] is True
    assert (await client.get("/auth/me", headers=editor_headers)).status_code == 200


async def test_impersonation_issues_pair_and_audits(client, workspace, db_maker):
    ws = workspace
    padmin = await _platform_admin(db_maker, ws)
    editor = ws["users"]["EDITOR"]

    res = await client.post(f"/platform/users/{editor.id}/impersonate", headers=padmin["headers"])
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["user"]["email"] == editor.email

    # The pair really authenticates as the target user.
    res = await client.get("/auth/me", headers=auth(body["access_token"]))
    assert res.status_code == 200
    assert res.json()["email"] == editor.email

    async with db_maker() as db:
        row = (
            await db.execute(select(AuditLog).where(AuditLog.action == "platform.impersonate"))
        ).scalars().one()
        assert row.actor_id == padmin["user"].id
        assert row.diff["admin_id"] == str(padmin["user"].id)
        assert row.tenant_id == editor.tenant_id
