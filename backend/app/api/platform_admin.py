"""Platform super-admin API (spec 013). All routes live under /platform and
require a user JWT whose row has is_platform_admin=true — deliberately
disjoint from the tenant-scoped capability system (no space_id, no RLS
binding: platform reads intentionally span all tenants).

Sensitive actions (suspend account/user, impersonate) write AuditLog rows
into the TARGET tenant's trail with actor_label "platform-admin:<email>",
so the affected customer's audit page shows what support did.
"""
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_platform_admin
from app.config import get_settings
from app.core import usage
from app.database import get_db
from app.models import (
    AccountMember,
    AuditLog,
    Entry,
    MediaAsset,
    Plan,
    RefreshToken,
    Space,
    Subscription,
    Tenant,
    UsageCounter,
    User,
    Webhook,
    WebhookDelivery,
)

router = APIRouter(prefix="/platform", tags=["platform-admin"])
settings = get_settings()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _platform_audit(
    db: AsyncSession,
    admin: User,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | str,
    tenant_id: uuid.UUID,
    diff: dict | None = None,
) -> None:
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_id=admin.id,
            actor_label=f"platform-admin:{admin.email}",
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id),
            diff=diff or {},
        )
    )


@router.get("/me")
async def platform_me(admin: User = Depends(require_platform_admin)):
    """Login gate for the superadmin app: 200 only for platform admins."""
    return {"id": admin.id, "email": admin.email, "full_name": admin.full_name}


# --- Overview ---------------------------------------------------------------------


@router.get("/overview")
async def overview(
    db: AsyncSession = Depends(get_db), _: User = Depends(require_platform_admin)
):
    accounts = (await db.execute(select(func.count(Tenant.id)))).scalar_one()
    users_total = (await db.execute(select(func.count(User.id)))).scalar_one()
    users_active = (
        await db.execute(select(func.count(User.id)).where(User.is_active.is_(True)))
    ).scalar_one()
    spaces = (await db.execute(select(func.count(Space.id)))).scalar_one()
    entries = (await db.execute(select(func.count(Entry.id)))).scalar_one()
    api_calls_month = (
        await db.execute(
            select(func.coalesce(func.sum(UsageCounter.api_calls), 0)).where(
                UsageCounter.period == usage.current_period()
            )
        )
    ).scalar_one()

    since = _now() - timedelta(days=30)
    day = func.date_trunc("day", Tenant.created_at)
    rows = (
        await db.execute(
            select(day.label("day"), func.count(Tenant.id))
            .where(Tenant.created_at >= since)
            .group_by(day)
            .order_by(day)
        )
    ).all()
    signup_map = {r[0].date().isoformat(): int(r[1]) for r in rows}
    signups = [
        {"date": (since + timedelta(days=i)).date().isoformat()}
        for i in range(31)
    ]
    for point in signups:
        point["count"] = signup_map.get(point["date"], 0)

    return {
        "accounts": int(accounts),
        "users_total": int(users_total),
        "users_active": int(users_active),
        "spaces": int(spaces),
        "entries": int(entries),
        "api_calls_this_month": int(api_calls_month),
        "signups_last_30_days": signups,
    }


# --- Accounts ---------------------------------------------------------------------


@router.get("/accounts")
async def list_accounts(
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    stmt = select(Tenant).order_by(Tenant.created_at.desc())
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(Tenant.name.ilike(pattern) | Tenant.slug.ilike(pattern))
    total = (
        await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))
    ).scalar_one()
    tenants = (await db.execute(stmt.limit(min(limit, 200)).offset(offset))).scalars().all()
    ids = [t.id for t in tenants]

    def _grouped(rows):
        return {r[0]: int(r[1]) for r in rows}

    seats = _grouped((await db.execute(
        select(AccountMember.tenant_id, func.count()).where(AccountMember.tenant_id.in_(ids)).group_by(AccountMember.tenant_id)
    )).all()) if ids else {}
    space_counts = _grouped((await db.execute(
        select(Space.tenant_id, func.count()).where(Space.tenant_id.in_(ids)).group_by(Space.tenant_id)
    )).all()) if ids else {}
    entry_counts = _grouped((await db.execute(
        select(Entry.tenant_id, func.count()).where(Entry.tenant_id.in_(ids)).group_by(Entry.tenant_id)
    )).all()) if ids else {}
    subs = {
        s.tenant_id: s
        for s in (await db.execute(
            select(Subscription).where(Subscription.tenant_id.in_(ids))
        )).scalars().all()
    } if ids else {}

    return {
        "total": int(total),
        "items": [
            {
                "id": t.id,
                "name": t.name,
                "slug": t.slug,
                "status": t.status,
                "created_at": t.created_at,
                "plan": subs[t.id].plan.key if t.id in subs and subs[t.id].plan else "free",
                "subscription_status": subs[t.id].status if t.id in subs else None,
                "seats": seats.get(t.id, 0),
                "spaces": space_counts.get(t.id, 0),
                "entries": entry_counts.get(t.id, 0),
            }
            for t in tenants
        ],
    }


async def _tenant_or_404(db: AsyncSession, account_id: uuid.UUID) -> Tenant:
    tenant = (await db.execute(select(Tenant).where(Tenant.id == account_id))).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Account not found")
    return tenant


@router.get("/accounts/{account_id}")
async def account_detail(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    tenant = await _tenant_or_404(db, account_id)
    plan_key, limits = await usage.get_plan(db, account_id)
    used = await usage.compute_usage(db, account_id)
    spaces = (await db.execute(select(Space).where(Space.tenant_id == account_id))).scalars().all()
    entry_counts = {
        r[0]: int(r[1])
        for r in (await db.execute(
            select(Entry.space_id, func.count()).where(Entry.tenant_id == account_id).group_by(Entry.space_id)
        )).all()
    }
    members = (
        await db.execute(
            select(AccountMember, User)
            .join(User, AccountMember.user_id == User.id)
            .where(AccountMember.tenant_id == account_id)
        )
    ).all()
    sub = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == account_id))
    ).scalar_one_or_none()
    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "status": tenant.status,
        "created_at": tenant.created_at,
        "plan": plan_key,
        "limits": limits,
        "usage": used,
        "subscription": {
            "status": sub.status,
            "current_period_end": sub.current_period_end,
            "stripe_customer_id": sub.stripe_customer_id,
        } if sub else None,
        "spaces": [
            {"id": s.id, "name": s.name, "slug": s.slug, "entries": entry_counts.get(s.id, 0)}
            for s in spaces
        ],
        "members": [
            {
                "user_id": u.id, "email": u.email, "full_name": u.full_name,
                "is_owner": m.is_owner, "is_active": u.is_active,
            }
            for m, u in members
        ],
    }


class _StatusOut(BaseModel):
    id: uuid.UUID
    status: str


@router.post("/accounts/{account_id}/suspend", response_model=_StatusOut)
async def suspend_account(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_platform_admin),
):
    tenant = await _tenant_or_404(db, account_id)
    tenant.status = "suspended"
    _platform_audit(db, admin, "platform.account_suspend", "account", tenant.id, tenant.id)
    await db.commit()
    return _StatusOut(id=tenant.id, status=tenant.status)


@router.post("/accounts/{account_id}/reactivate", response_model=_StatusOut)
async def reactivate_account(
    account_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_platform_admin),
):
    tenant = await _tenant_or_404(db, account_id)
    tenant.status = "active"
    _platform_audit(db, admin, "platform.account_reactivate", "account", tenant.id, tenant.id)
    await db.commit()
    return _StatusOut(id=tenant.id, status=tenant.status)


# --- Users ------------------------------------------------------------------------


@router.get("/users")
async def list_users(
    q: str = "",
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    stmt = select(User).order_by(User.created_at.desc())
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(User.email.ilike(pattern) | User.full_name.ilike(pattern))
    total = (
        await db.execute(select(func.count()).select_from(stmt.order_by(None).subquery()))
    ).scalar_one()
    users = (await db.execute(stmt.limit(min(limit, 200)).offset(offset))).scalars().all()
    ids = [u.id for u in users]
    memberships = (
        await db.execute(
            select(AccountMember.user_id, Tenant.name, Tenant.slug)
            .join(Tenant, AccountMember.tenant_id == Tenant.id)
            .where(AccountMember.user_id.in_(ids))
        )
    ).all() if ids else []
    member_map: dict[uuid.UUID, list[dict]] = {}
    for user_id, name, slug in memberships:
        member_map.setdefault(user_id, []).append({"name": name, "slug": slug})
    return {
        "total": int(total),
        "items": [
            {
                "id": u.id,
                "email": u.email,
                "full_name": u.full_name,
                "is_active": u.is_active,
                "email_verified": u.email_verified,
                "is_platform_admin": u.is_platform_admin,
                "created_at": u.created_at,
                "accounts": member_map.get(u.id, []),
            }
            for u in users
        ],
    }


async def _user_or_404(db: AsyncSession, user_id: uuid.UUID) -> User:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/users/{user_id}/suspend")
async def suspend_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_platform_admin),
):
    user = await _user_or_404(db, user_id)
    if user.is_platform_admin:
        raise HTTPException(status_code=400, detail="Platform admins cannot be suspended here")
    user.is_active = False
    _platform_audit(db, admin, "platform.user_suspend", "user", user.id, user.tenant_id,
                    diff={"email": user.email})
    await db.commit()
    return {"id": user.id, "is_active": user.is_active}


@router.post("/users/{user_id}/reactivate")
async def reactivate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_platform_admin),
):
    user = await _user_or_404(db, user_id)
    user.is_active = True
    _platform_audit(db, admin, "platform.user_reactivate", "user", user.id, user.tenant_id,
                    diff={"email": user.email})
    await db.commit()
    return {"id": user.id, "is_active": user.is_active}


@router.post("/users/{user_id}/impersonate")
async def impersonate_user(
    user_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    admin: User = Depends(require_platform_admin),
):
    """Support tooling: issue a normal token pair AS the target user (their
    home account). Always audited into the target tenant's trail."""
    from app.api.auth import _issue_pair

    user = await _user_or_404(db, user_id)
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Cannot impersonate a suspended user")
    _platform_audit(db, admin, "platform.impersonate", "user", user.id, user.tenant_id,
                    diff={"email": user.email, "admin_id": str(admin.id)})
    await db.commit()
    pair = await _issue_pair(db, user, user.tenant_id)
    return {
        "access_token": pair.access_token,
        "refresh_token": pair.refresh_token,
        "account_id": pair.account_id,
        "editor_url": settings.frontend_url,
        "user": {"id": user.id, "email": user.email, "full_name": user.full_name},
    }


# --- Revenue ----------------------------------------------------------------------


@router.get("/revenue")
async def revenue(
    db: AsyncSession = Depends(get_db), _: User = Depends(require_platform_admin)
):
    subs = (await db.execute(select(Subscription))).scalars().all()
    plans = {p.id: p for p in (await db.execute(select(Plan))).scalars().all()}
    accounts_total = (await db.execute(select(func.count(Tenant.id)))).scalar_one()

    mrr = 0.0
    by_plan: dict[str, dict] = {}
    active_paid = 0
    for sub in subs:
        plan = plans.get(sub.plan_id)
        if plan is None:
            continue
        bucket = by_plan.setdefault(
            plan.key, {"plan": plan.key, "name": plan.name,
                       "price_month_usd": float(plan.price_month_usd), "accounts": 0, "mrr": 0.0}
        )
        if sub.status == "active":
            bucket["accounts"] += 1
            bucket["mrr"] += float(plan.price_month_usd)
            mrr += float(plan.price_month_usd)
            if float(plan.price_month_usd) > 0:
                active_paid += 1

    canceled_30d = (
        await db.execute(
            select(func.count(Subscription.id)).where(
                Subscription.status == "canceled",
                Subscription.updated_at >= _now() - timedelta(days=30),
            )
        )
    ).scalar_one()
    churn_base = active_paid + int(canceled_30d)
    free_accounts = int(accounts_total) - sum(b["accounts"] for b in by_plan.values())

    events = (
        await db.execute(
            select(AuditLog)
            .where(AuditLog.action.like("billing.%"))
            .order_by(AuditLog.created_at.desc())
            .limit(20)
        )
    ).scalars().all()

    return {
        "mrr": round(mrr, 2),
        "arr": round(mrr * 12, 2),
        "active_paid_subscriptions": active_paid,
        "free_accounts": max(free_accounts, 0),
        "by_plan": sorted(by_plan.values(), key=lambda b: -b["mrr"]),
        "churn_rate_30d": round(int(canceled_30d) / churn_base, 4) if churn_base else 0.0,
        "canceled_last_30d": int(canceled_30d),
        "recent_events": [
            {
                "action": e.action, "tenant_id": e.tenant_id, "actor": e.actor_label,
                "diff": e.diff, "created_at": e.created_at,
            }
            for e in events
        ],
    }


# --- Usage & limits ---------------------------------------------------------------


@router.get("/usage")
async def platform_usage(
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_platform_admin),
):
    tenants = (
        await db.execute(select(Tenant).order_by(Tenant.created_at).limit(min(limit, 500)))
    ).scalars().all()
    ids = [t.id for t in tenants]

    def _grouped(rows):
        return {r[0]: int(r[1]) for r in rows}

    api_calls = _grouped((await db.execute(
        select(UsageCounter.tenant_id, UsageCounter.api_calls)
        .where(UsageCounter.tenant_id.in_(ids), UsageCounter.period == usage.current_period())
    )).all()) if ids else {}
    entries = _grouped((await db.execute(
        select(Entry.tenant_id, func.count()).where(Entry.tenant_id.in_(ids)).group_by(Entry.tenant_id)
    )).all()) if ids else {}
    storage = _grouped((await db.execute(
        select(MediaAsset.tenant_id, func.coalesce(func.sum(MediaAsset.size_bytes), 0))
        .where(MediaAsset.tenant_id.in_(ids)).group_by(MediaAsset.tenant_id)
    )).all()) if ids else {}
    seats = _grouped((await db.execute(
        select(AccountMember.tenant_id, func.count()).where(AccountMember.tenant_id.in_(ids)).group_by(AccountMember.tenant_id)
    )).all()) if ids else {}

    subs = {
        s.tenant_id: s
        for s in (await db.execute(select(Subscription).where(Subscription.tenant_id.in_(ids)))).scalars().all()
    } if ids else {}
    free_plan = (await db.execute(select(Plan).where(Plan.key == "free"))).scalar_one_or_none()
    free_limits = dict(free_plan.limits or {}) if free_plan else dict(usage.DEFAULT_PLANS["free"]["limits"])

    items = []
    for t in tenants:
        sub = subs.get(t.id)
        if sub is not None and sub.status == "active" and sub.plan is not None:
            plan_key, limits = sub.plan.key, dict(sub.plan.limits or {})
        else:
            plan_key, limits = "free", free_limits
        used = {
            "api_calls_month": api_calls.get(t.id, 0),
            "entries": entries.get(t.id, 0),
            "storage_bytes": storage.get(t.id, 0),
            "seats": seats.get(t.id, 0),
        }
        pct = {
            metric: round(used[metric] / limits[metric], 4)
            for metric in used
            if limits.get(metric)
        }
        items.append({
            "id": t.id, "name": t.name, "slug": t.slug, "status": t.status,
            "plan": plan_key, "usage": used, "limits": limits, "pct_of_limit": pct,
            "nearing_limit": any(v >= 0.8 for v in pct.values()),
        })

    items.sort(key=lambda i: -(i["usage"]["api_calls_month"]))
    return {
        "period": usage.current_period(),
        "items": items,
        "nearing_limit": [i for i in items if i["nearing_limit"]],
    }


# --- System health ----------------------------------------------------------------


@router.get("/health")
async def platform_health(
    db: AsyncSession = Depends(get_db), _: User = Depends(require_platform_admin)
):
    started = time.perf_counter()
    await db.execute(text("SELECT 1"))
    db_latency_ms = round((time.perf_counter() - started) * 1000, 2)

    async def _webhook_stats(hours: int) -> dict:
        since = _now() - timedelta(hours=hours)
        total = (
            await db.execute(
                select(func.count(WebhookDelivery.id)).where(WebhookDelivery.created_at >= since)
            )
        ).scalar_one()
        ok = (
            await db.execute(
                select(func.count(WebhookDelivery.id)).where(
                    WebhookDelivery.created_at >= since, WebhookDelivery.success.is_(True)
                )
            )
        ).scalar_one()
        return {
            "total": int(total),
            "succeeded": int(ok),
            "failed": int(total) - int(ok),
            "success_rate": round(int(ok) / int(total), 4) if total else None,
        }

    failures = (
        await db.execute(
            select(WebhookDelivery, Webhook)
            .join(Webhook, WebhookDelivery.webhook_id == Webhook.id)
            .where(WebhookDelivery.success.is_(False))
            .order_by(WebhookDelivery.created_at.desc())
            .limit(10)
        )
    ).all()
    active_sessions = (
        await db.execute(
            select(func.count(RefreshToken.id)).where(
                RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > _now()
            )
        )
    ).scalar_one()

    return {
        "db": {"ok": True, "latency_ms": db_latency_ms},
        "webhooks_24h": await _webhook_stats(24),
        "webhooks_7d": await _webhook_stats(24 * 7),
        "recent_webhook_failures": [
            {
                "webhook": w.name, "tenant_id": w.tenant_id, "event": d.event,
                "response_status": d.response_status, "created_at": d.created_at,
                "error": (d.response_body or "")[:200],
            }
            for d, w in failures
        ],
        "active_sessions": int(active_sessions),
    }
