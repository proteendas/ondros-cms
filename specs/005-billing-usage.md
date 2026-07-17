# 005 — Billing & Usage (minimum viable)

## Current state (before this spec)

- No plans, subscriptions, usage tracking or limits of any kind.

## Requirements

- `Plan` (free/starter/pro) with limits: seats, entries, storage bytes, API
  calls/month, spaces. `Subscription` (account, plan, status, Stripe ids).
- Usage counters per account: API calls/month (counted), entries / storage /
  seats (computed live).
- Soft-limit enforcement: 402 (`payment_required`, plan ceiling) on create
  operations; 429 on API-call quota.
- Stripe Checkout + webhook lifecycle; **dev mode** (`BILLING_DEV_MODE`)
  activates plans without Stripe so the flow is fully testable locally.

## Data model

| Table | Columns |
|-------|---------|
| `plans` | id, key(free/starter/pro), name, price_month_usd, limits JSONB {seats, entries, storage_bytes, api_calls_month, spaces}, stripe_price_id, position |
| `subscriptions` | id, tenant_id (unique), plan_id, status(active/past_due/canceled), stripe_customer_id, stripe_subscription_id, current_period_end, created/updated |
| `usage_counters` | id, tenant_id, period 'YYYY-MM', api_calls — unique(tenant, period), upserted async |

## API surface

```
GET  /billing/plans
GET  /billing/subscription           current account: plan + usage + limits
POST /billing/checkout {plan_key}    Stripe session URL (or dev activation)
POST /billing/webhook                Stripe events (signature-verified)
POST /billing/dev-activate {plan_key}  only when BILLING_DEV_MODE
```

## Enforcement points

- API-call quota: tracked fire-and-forget in `get_actor`/`get_content_key`,
  checked (cheap cached read) → 429 with `Retry-After`.
- `create_entry` → entries limit → 402; media upload → storage → 402;
  invitations → seats → 402; create_space → spaces → 402.
- Accounts without a subscription row default to the `free` plan.

## Acceptance criteria

- [x] Free-plan entry limit returns 402 with clear body (`test_billing.py`)
- [x] Seat limit blocks invitation
- [x] dev-activate upgrades plan and lifts the limit
- [x] API-call counter increments per authenticated request
- [ ] Stripe checkout + webhook against live keys (manual)

## Tasks

- [x] Models + seeded plans + migrations
- [x] core/usage.py (limits, counters, checks)
- [x] billing router + Stripe optional import + webhook
- [x] Enforcement in entries/media/invitations/spaces
- [x] Settings → Billing page (plan, usage meters, upgrade)
- [x] Tests (dev mode)
- [ ] Metered Stripe usage reporting, proration, invoices UI
