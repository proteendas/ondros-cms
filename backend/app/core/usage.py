"""Plans, usage counters and limit enforcement (spec 005).

API calls are COUNTED (usage_counters, upserted in a background task).
Entries / storage / seats / spaces are COMPUTED live at enforcement time.
Accounts without a Subscription row run on the `free` plan.

Enforcement responses:
  429 api-call quota exceeded (with Retry-After until month end)
  402 plan ceiling reached on a create operation (metric named in the body)
"""
import asyncio
import logging
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountMember,
    Entry,
    MediaAsset,
    Plan,
    Space,
    Subscription,
)

logger = logging.getLogger(__name__)

# Fallback when the plans table is empty (e.g. before seeding).
DEFAULT_PLANS: dict[str, dict] = {
    "free": {
        "name": "Free",
        "price_month_usd": 0,
        "limits": {"seats": 2, "entries": 500, "storage_bytes": 100 * 1024**2,
                   "api_calls_month": 10_000, "spaces": 1},
    },
    "starter": {
        "name": "Starter",
        "price_month_usd": 29,
        "limits": {"seats": 10, "entries": 10_000, "storage_bytes": 5 * 1024**3,
                   "api_calls_month": 500_000, "spaces": 3},
    },
    "pro": {
        "name": "Pro",
        "price_month_usd": 99,
        "limits": {"seats": 50, "entries": 100_000, "storage_bytes": 50 * 1024**3,
                   "api_calls_month": 5_000_000, "spaces": 20},
    },
}

# (plan_key, limits) per tenant, cached briefly so quota checks stay cheap.
_plan_cache: dict[str, tuple[float, str, dict]] = {}
_PLAN_CACHE_TTL_S = 30

_background_tasks: set[asyncio.Task] = set()


def current_period() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


async def get_plan(db: AsyncSession, tenant_id: uuid.UUID) -> tuple[str, dict]:
    """Resolve the account's plan key + limits (subscription row or free)."""
    key = str(tenant_id)
    cached = _plan_cache.get(key)
    if cached and time.monotonic() - cached[0] < _PLAN_CACHE_TTL_S:
        return cached[1], cached[2]

    sub = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if sub is not None and sub.status == "active" and sub.plan is not None:
        plan_key, limits = sub.plan.key, dict(sub.plan.limits or {})
    else:
        plan_key, limits = "free", dict(DEFAULT_PLANS["free"]["limits"])
        row = (await db.execute(select(Plan).where(Plan.key == "free"))).scalar_one_or_none()
        if row is not None:
            limits = dict(row.limits or limits)
    _plan_cache[key] = (time.monotonic(), plan_key, limits)
    return plan_key, limits


def invalidate_plan_cache(tenant_id: uuid.UUID) -> None:
    _plan_cache.pop(str(tenant_id), None)


async def get_api_calls(db: AsyncSession, tenant_id: uuid.UUID, period: str | None = None) -> int:
    row = (
        await db.execute(
            text("SELECT api_calls FROM usage_counters WHERE tenant_id = :t AND period = :p"),
            {"t": str(tenant_id), "p": period or current_period()},
        )
    ).scalar()
    return int(row or 0)


def track_api_call(tenant_id: uuid.UUID) -> None:
    """Fire-and-forget monthly counter upsert (own session; never blocks requests)."""

    async def _bump() -> None:
        from app.database import async_session_maker

        try:
            async with async_session_maker() as db:
                await db.execute(
                    text(
                        "INSERT INTO usage_counters (id, tenant_id, period, api_calls) "
                        "VALUES (gen_random_uuid(), :t, :p, 1) "
                        "ON CONFLICT (tenant_id, period) "
                        "DO UPDATE SET api_calls = usage_counters.api_calls + 1"
                    ),
                    {"t": str(tenant_id), "p": current_period()},
                )
                await db.commit()
        except Exception:  # noqa: BLE001
            logger.debug("usage counter bump failed", exc_info=True)

    try:
        task = asyncio.create_task(_bump())
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)
    except RuntimeError:
        pass  # no running loop (sync contexts)


async def check_api_quota(db: AsyncSession, tenant_id: uuid.UUID) -> None:
    """429 when the monthly API-call quota is exhausted."""
    _, limits = await get_plan(db, tenant_id)
    quota = limits.get("api_calls_month")
    if not quota:
        return
    used = await get_api_calls(db, tenant_id)
    if used >= quota:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "api_quota_exceeded",
                "message": f"Monthly API call quota reached ({quota}). Upgrade your plan.",
                "limit": quota,
                "used": used,
            },
            headers={"Retry-After": "3600"},
        )


async def compute_usage(db: AsyncSession, tenant_id: uuid.UUID) -> dict:
    entries = (
        await db.execute(select(func.count(Entry.id)).where(Entry.tenant_id == tenant_id))
    ).scalar_one()
    storage = (
        await db.execute(
            select(func.coalesce(func.sum(MediaAsset.size_bytes), 0)).where(
                MediaAsset.tenant_id == tenant_id
            )
        )
    ).scalar_one()
    seats = (
        await db.execute(
            select(func.count(AccountMember.id)).where(AccountMember.tenant_id == tenant_id)
        )
    ).scalar_one()
    spaces = (
        await db.execute(select(func.count(Space.id)).where(Space.tenant_id == tenant_id))
    ).scalar_one()
    return {
        "entries": int(entries),
        "storage_bytes": int(storage),
        "seats": int(seats),
        "spaces": int(spaces),
        "api_calls_month": await get_api_calls(db, tenant_id),
    }


async def ensure_within_limit(db: AsyncSession, tenant_id: uuid.UUID, metric: str, adding: int = 1) -> None:
    """402 when creating `adding` more of `metric` would exceed the plan."""
    plan_key, limits = await get_plan(db, tenant_id)
    ceiling = limits.get(metric)
    if not ceiling:
        return
    usage = await compute_usage(db, tenant_id)
    if usage.get(metric, 0) + adding > ceiling:
        raise HTTPException(
            status_code=402,
            detail={
                "code": "plan_limit_reached",
                "metric": metric,
                "limit": ceiling,
                "used": usage.get(metric, 0),
                "plan": plan_key,
                "message": f"Your {plan_key} plan allows {ceiling} {metric.replace('_', ' ')}. Upgrade to add more.",
            },
        )
