# 013 — Independent Super-Admin (Platform) Dashboard

## Current state

All auth is tenant-scoped: every JWT carries an `account_id` claim and every
router filters by it. There is no platform-level operator view: no way to
list accounts, inspect usage across tenants, suspend an account/user, or see
revenue — except psql. `users.is_active` exists (login + refresh already
reject inactive users); tenants have no status column.

## Requirements

1. **Separate role, separate app.** `users.is_platform_admin` (bool, default
   false) — platform-level, not tied to any Account. New Next.js app
   `superadmin/` on **:3003** with its own login screen (email/password →
   `/auth/login`, then gated by `GET /platform/me`); it never shares the
   editor's localStorage tokens (own storage keys).
2. **Backend namespace** `app/api/platform_admin.py`, all routes under
   `/platform`, guarded by `require_platform_admin()` (JWT user with
   `is_platform_admin=true`; API keys never qualify) — fully separate from
   space-scoped capability checks. Platform reads span tenants (RLS binding
   is intentionally not set; platform admin connects as the owner role).
3. **Account suspension**: `tenants.status` (`active|suspended`).
   `get_actor` + content-key auth return **403 account_suspended** for
   suspended tenants (management, delivery and preview planes all blocked).
4. **Pages / endpoints**:
   | Page | Endpoint | Contents |
   |---|---|---|
   | Overview | `GET /platform/overview` | totals (accounts, users, spaces, entries), API calls this month (counters are monthly — per-day split tracked as follow-up), signups/day for the last 30 days (SVG chart) |
   | Accounts | `GET /platform/accounts?q=` , `GET /platform/accounts/{id}`, `POST …/suspend|reactivate` | plan, seats used, spaces/entries, status, per-account drill-down (spaces, usage, members, subscription) |
   | Users | `GET /platform/users?q=`, `POST …/suspend|reactivate`, `POST …/impersonate` | cross-tenant search, memberships, suspend/reactivate, impersonation |
   | Revenue | `GET /platform/revenue` | MRR/ARR, revenue + count by plan, churn (canceled last 30d ÷ payers), recent subscription events |
   | Usage | `GET /platform/usage` | per-account API calls (month), entries, storage, seats, % of plan limit, nearing-limit list (≥80%) |
   | Health | `GET /platform/health` | webhook success/failure rates (24h/7d) + recent failures, DB connectivity/latency, refresh-token + WS gauge stats |
5. **Impersonation**: `POST /platform/users/{id}/impersonate` issues a
   normal token pair for the target user (their home account), responds with
   the tokens + editor URL, and **audits** `platform.impersonate` with the
   acting admin's id. Suspend/reactivate audit likewise
   (`platform.account_suspend`, `platform.user_suspend`, …) into the target
   tenant's audit trail with `actor_label="platform-admin:<email>"`.
6. **Seed**: `superadmin@example.com` / `super123` with
   `is_platform_admin=true` (dev only), noted in README.
7. Migrations: dev DDL + Alembic revision `0002_platform_admin`
   (is_platform_admin, tenants.status).

## Acceptance criteria

- [x] `/platform/*` returns 403 for a normal ORG_ADMIN token and for API
      keys; 200 for the flagged user (tested).
- [x] Suspending an account blocks management + delivery requests with
      `account_suspended`; reactivation restores access (tested).
- [x] Impersonation returns a working token pair for the target user and
      writes an audit row containing the admin's id (tested).
- [x] Superadmin app: login gate, six pages, tsc clean, all pages 200.

## Tasks

- [x] Columns + migrations (dev + alembic) + suspension enforcement in deps.
- [x] `require_platform_admin` + `/platform` router (7 endpoints) + audits.
- [x] Seed platform admin; README note.
- [x] `superadmin/` app: login, shell, overview chart, accounts (+detail),
      users (suspend/impersonate), revenue, usage, health; compose on :3003.
- [x] Backend tests (access control, suspension, impersonation audit).
