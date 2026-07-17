"""Billing & usage endpoints (spec 005).

Stripe is optional: with STRIPE_SECRET_KEY set, /checkout creates a real
Checkout Session and /webhook processes lifecycle events. Locally,
BILLING_DEV_MODE allows /dev-activate to switch plans without Stripe so limit
enforcement is fully testable.
"""
import logging
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import Actor, ensure_can, get_actor
from app.config import get_settings
from app.core import usage
from app.core.audit import record_audit
from app.core.permissions import Capability
from app.database import get_db
from app.models import Plan, Subscription

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/billing", tags=["billing"])
settings = get_settings()

try:  # optional dependency; endpoints degrade gracefully without it
    import stripe as stripe_sdk
except ImportError:  # pragma: no cover
    stripe_sdk = None


class PlanOut(BaseModel):
    key: str
    name: str
    price_month_usd: float
    limits: dict

    model_config = {"from_attributes": True}


class SubscriptionOut(BaseModel):
    plan: PlanOut
    status: str
    current_period_end: datetime | None = None
    usage: dict
    dev_mode: bool


class CheckoutRequest(BaseModel):
    plan_key: str


async def _plans(db: AsyncSession) -> list[Plan]:
    rows = (await db.execute(select(Plan).order_by(Plan.position))).scalars().all()
    return list(rows)


async def _get_plan(db: AsyncSession, key: str) -> Plan:
    plan = (await db.execute(select(Plan).where(Plan.key == key))).scalar_one_or_none()
    if plan is None:
        raise HTTPException(status_code=404, detail=f"Unknown plan '{key}'")
    return plan


async def _set_subscription(
    db: AsyncSession, tenant_id: uuid.UUID, plan: Plan, status: str = "active", **stripe_ids
) -> Subscription:
    sub = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if sub is None:
        sub = Subscription(tenant_id=tenant_id, plan_id=plan.id, status=status, **stripe_ids)
        db.add(sub)
    else:
        sub.plan_id = plan.id
        sub.status = status
        for key, value in stripe_ids.items():
            setattr(sub, key, value)
    await db.commit()
    usage.invalidate_plan_cache(tenant_id)
    return sub


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(db: AsyncSession = Depends(get_db)):
    return await _plans(db)


@router.get("/subscription", response_model=SubscriptionOut)
async def my_subscription(db: AsyncSession = Depends(get_db), actor: Actor = Depends(get_actor)):
    plan_key, limits = await usage.get_plan(db, actor.tenant_id)
    plan = (await db.execute(select(Plan).where(Plan.key == plan_key))).scalar_one_or_none()
    sub = (
        await db.execute(select(Subscription).where(Subscription.tenant_id == actor.tenant_id))
    ).scalar_one_or_none()
    plan_out = (
        PlanOut.model_validate(plan)
        if plan is not None
        else PlanOut(key=plan_key, name=plan_key.title(),
                     price_month_usd=0, limits=limits)
    )
    return SubscriptionOut(
        plan=plan_out,
        status=sub.status if sub else "active",
        current_period_end=sub.current_period_end if sub else None,
        usage=await usage.compute_usage(db, actor.tenant_id),
        dev_mode=settings.billing_dev_mode and not settings.stripe_secret_key,
    )


@router.post("/checkout")
async def checkout(
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    ensure_can(actor, Capability.MANAGE_SETTINGS.value)
    plan = await _get_plan(db, payload.plan_key)

    if settings.stripe_secret_key and stripe_sdk is not None:
        stripe_sdk.api_key = settings.stripe_secret_key
        if not plan.stripe_price_id:
            raise HTTPException(status_code=422, detail=f"Plan '{plan.key}' has no stripe_price_id")
        session = stripe_sdk.checkout.Session.create(
            mode="subscription",
            line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
            success_url=f"{settings.frontend_url}/settings/billing?status=success",
            cancel_url=f"{settings.frontend_url}/settings/billing?status=canceled",
            client_reference_id=str(actor.tenant_id),
            metadata={"tenant_id": str(actor.tenant_id), "plan_key": plan.key},
        )
        return {"checkout_url": session.url}

    if settings.billing_dev_mode:
        # Local/dev: skip Stripe entirely.
        await _set_subscription(db, actor.tenant_id, plan)
        record_audit(db, actor, "billing.plan_change", "subscription", actor.tenant_id,
                     diff={"plan": plan.key, "via": "dev_mode"})
        await db.commit()
        return {"checkout_url": None, "activated": plan.key}

    raise HTTPException(status_code=503, detail="Billing is not configured (set STRIPE_SECRET_KEY)")


@router.post("/dev-activate")
async def dev_activate(
    payload: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    actor: Actor = Depends(get_actor),
):
    """Switch plans without Stripe — only with BILLING_DEV_MODE (local dev/tests)."""
    if not settings.billing_dev_mode:
        raise HTTPException(status_code=403, detail="BILLING_DEV_MODE is disabled")
    ensure_can(actor, Capability.MANAGE_SETTINGS.value)
    plan = await _get_plan(db, payload.plan_key)
    await _set_subscription(db, actor.tenant_id, plan)
    record_audit(db, actor, "billing.plan_change", "subscription", actor.tenant_id,
                 diff={"plan": plan.key, "via": "dev_activate"})
    await db.commit()
    return {"activated": plan.key}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    """Stripe lifecycle events (checkout completed, subscription updated/deleted)."""
    if stripe_sdk is None or not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhooks are not configured")
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe_sdk.Webhook.construct_event(
            payload, signature, settings.stripe_webhook_secret
        )
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    kind = event["type"]
    data = event["data"]["object"]

    if kind == "checkout.session.completed":
        tenant_id = uuid.UUID(data["metadata"]["tenant_id"])
        plan = await _get_plan(db, data["metadata"]["plan_key"])
        await _set_subscription(
            db, tenant_id, plan,
            stripe_customer_id=data.get("customer", "") or "",
            stripe_subscription_id=data.get("subscription", "") or "",
        )
    elif kind in ("customer.subscription.updated", "customer.subscription.deleted"):
        sub = (
            await db.execute(
                select(Subscription).where(Subscription.stripe_subscription_id == data["id"])
            )
        ).scalar_one_or_none()
        if sub is not None:
            sub.status = "canceled" if kind.endswith("deleted") else data.get("status", "active")
            await db.commit()
            usage.invalidate_plan_cache(sub.tenant_id)
    else:
        logger.info("Unhandled stripe event: %s", kind)
    return {"received": True}
