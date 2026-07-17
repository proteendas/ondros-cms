"""Spec 005: plans, dev activation, 402 limit enforcement, usage reporting."""
import pytest

from tests.conftest import auth

pytestmark = pytest.mark.asyncio


async def _install_tiny_plan(db_maker, workspace):
    """A plan with tiny ceilings so limits are reachable in tests."""
    from app.models import Plan

    async with db_maker() as db:
        db.add(Plan(key="tiny", name="Tiny", price_month_usd=1,
                    limits={"seats": 2, "entries": 2, "storage_bytes": 10_000,
                            "api_calls_month": 100_000, "spaces": 1}))
        await db.commit()


async def test_dev_activate_and_entry_limit(client, db_maker, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await _install_tiny_plan(db_maker, ws)

    res = await client.post("/billing/dev-activate", json={"plan_key": "tiny"}, headers=admin)
    assert res.status_code == 200, res.text

    sub = (await client.get("/billing/subscription", headers=admin)).json()
    assert sub["plan"]["key"] == "tiny"
    assert sub["usage"]["entries"] == 0

    base = f"/spaces/{ws['space'].id}/environments/master/entries"
    for slug in ("one", "two"):
        res = await client.post(base, json={
            "content_type_id": str(ws["article_ct"].id), "slug": slug,
            "fields": {"title": {"en-US": slug}},
        }, headers=admin)
        assert res.status_code == 201

    # Third entry exceeds the tiny plan's ceiling -> 402 with actionable body.
    res = await client.post(base, json={
        "content_type_id": str(ws["article_ct"].id), "slug": "three",
        "fields": {"title": {"en-US": "three"}},
    }, headers=admin)
    assert res.status_code == 402
    detail = res.json()["detail"]
    assert detail["code"] == "plan_limit_reached"
    assert detail["metric"] == "entries"

    # Upgrading (free defaults allow 500 entries) lifts the limit.
    from app.models import Plan  # ensure free plan exists as a row for checkout

    async with db_maker() as db:
        from sqlalchemy import select
        if (await db.execute(select(Plan).where(Plan.key == "pro"))).scalar_one_or_none() is None:
            db.add(Plan(key="pro", name="Pro", price_month_usd=99,
                        limits={"seats": 50, "entries": 100000, "storage_bytes": 10**10,
                                "api_calls_month": 5000000, "spaces": 20}))
            await db.commit()
    res = await client.post("/billing/dev-activate", json={"plan_key": "pro"}, headers=admin)
    assert res.status_code == 200
    res = await client.post(base, json={
        "content_type_id": str(ws["article_ct"].id), "slug": "three",
        "fields": {"title": {"en-US": "three"}},
    }, headers=admin)
    assert res.status_code == 201


async def test_seat_limit_blocks_invitations(client, db_maker, workspace):
    ws = workspace
    admin = auth(ws["tokens"]["ORG_ADMIN"])
    await _install_tiny_plan(db_maker, ws)
    await client.post("/billing/dev-activate", json={"plan_key": "tiny"}, headers=admin)

    roles = (await client.get("/roles", headers=admin)).json()
    viewer_role = next(r for r in roles if r["name"] == "VIEWER")

    # Workspace already has 4 members; the tiny plan allows 2 seats -> 402.
    res = await client.post(f"/accounts/{ws['tenant'].id}/invitations", json={
        "email": "overflow@corp-inc.com", "role_id": viewer_role["id"],
    }, headers=admin)
    assert res.status_code == 402
    assert res.json()["detail"]["metric"] == "seats"


async def test_editor_cannot_change_plan(client, db_maker, workspace):
    ws = workspace
    await _install_tiny_plan(db_maker, ws)
    res = await client.post("/billing/dev-activate", json={"plan_key": "tiny"},
                            headers=auth(ws["tokens"]["EDITOR"]))
    assert res.status_code == 403
