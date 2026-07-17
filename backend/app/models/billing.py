"""Billing models: plans, per-account subscriptions, API-call counters.

Limits live in Plan.limits JSONB:
  {seats, entries, storage_bytes, api_calls_month, spaces}
Accounts without a Subscription row are treated as the `free` plan
(app.core.usage resolves that). API calls are the only *counted* metric
(usage_counters, upserted asynchronously); entries/storage/seats/spaces are
computed live at enforcement time.
"""
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, created_at_col, updated_at_col, uuid_pk


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(50), unique=True)  # free | starter | pro
    name: Mapped[str] = mapped_column(String(100))
    price_month_usd: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    limits: Mapped[dict] = mapped_column(JSONB, default=dict)
    stripe_price_id: Mapped[str] = mapped_column(String(200), default="")
    position: Mapped[int] = mapped_column(Integer, default=0)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id", ondelete="RESTRICT"))
    status: Mapped[str] = mapped_column(String(20), default="active")  # active|past_due|canceled
    stripe_customer_id: Mapped[str] = mapped_column(String(200), default="")
    stripe_subscription_id: Mapped[str] = mapped_column(String(200), default="")
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = created_at_col()
    updated_at: Mapped[datetime] = updated_at_col()

    plan: Mapped[Plan] = relationship(lazy="joined")


class UsageCounter(Base):
    """API calls per account per calendar month ('YYYY-MM')."""

    __tablename__ = "usage_counters"
    __table_args__ = (UniqueConstraint("tenant_id", "period"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    period: Mapped[str] = mapped_column(String(7), index=True)
    api_calls: Mapped[int] = mapped_column(BigInteger, default=0)
