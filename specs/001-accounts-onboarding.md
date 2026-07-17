# 001 — Accounts, Auth Hardening & Tenant Onboarding

## Current state (before this spec)

- `Tenant` model exists and already scopes every table (`tenant_id` on all
  content rows) — it plays the "Account" role.
- Users belong to exactly ONE tenant (`users.tenant_id`); no self-serve signup
  (users are seeded or created by an admin), no email verification, no
  password reset, no refresh tokens (single 24h access JWT), no invitations.
- JWT payload: `sub` (user id), `tenant_id`, `email`.
- Row isolation is enforced in application queries only (no Postgres RLS).

## Requirements

- `Account` = existing `Tenant` (no duplicate concept). Add `AccountMember`
  (user↔account, supports multi-account users), `Invitation`, `RefreshToken`,
  `ActionToken` (email-verify / password-reset).
- Endpoints: signup, verify-email, login (access+refresh), refresh,
  forgot/reset password, invitations CRUD + accept, list my accounts, switch
  account.
- JWT claims: `sub` (user_id), `account_id`, `roles[]`, optional
  `active_space_id`, `type: access|refresh`.
- `get_current_account()` dependency: account derived ONLY from the token,
  membership-validated; sets `app.current_account_id` for RLS.
- Postgres RLS policies on all tenant tables as second line of defense.
- Frontend: /signup, /verify-email, /forgot-password, /reset-password,
  /accept-invite/[token], onboarding wizard (space → locale → optional first
  content type), account switcher in top bar.

## Data model (new)

| Table | Columns |
|-------|---------|
| `account_members` | id, tenant_id, user_id, is_owner, created_at — unique(user,tenant) |
| `invitations` | id, tenant_id, email, role_id, space_id?, token_hash, status(pending/accepted/revoked/expired), expires_at, invited_by, created_at |
| `refresh_tokens` | id, user_id, tenant_id, token_hash, expires_at, revoked_at |
| `action_tokens` | id, user_id, purpose(verify_email/reset_password), token_hash, expires_at, used_at |
| `users` (+cols) | email_verified bool |

## API surface

```
POST /auth/signup                {account_name, account_slug, email, password, full_name}
POST /auth/verify-email          {token}
POST /auth/login                 -> {access_token, refresh_token}; 403 w/ code=email_unverified
POST /auth/refresh               {refresh_token} -> rotated pair
POST /auth/forgot-password       {email}   (never leaks existence)
POST /auth/reset-password        {token, password}
GET  /accounts                   my memberships
POST /auth/switch-account        {account_id} -> new token pair
GET/POST  /accounts/{id}/invitations       (manage_users)
DELETE    /accounts/{id}/invitations/{invId}
GET  /invitations/{token}        public info (email, account, role)
POST /invitations/{token}/accept {password?, full_name?}
```

## Security decisions

- Tokens (refresh/action/invite) stored **hashed** (sha256), returned once.
- Refresh rotation: each /auth/refresh revokes the used token, issues new pair.
- Email delivery: `core/mailer.py` — SMTP when `SMTP_HOST` set, otherwise logs
  the link (dev mode) and, when `AUTH_DEV_MODE=true`, returns `dev_token` in
  API responses so the flow is testable without SMTP.
- RLS: policies `tenant_id::text = current_setting('app.current_account_id', true)`
  on all tenant tables. NOTE: the app currently connects as the table owner,
  which bypasses RLS — the policies become active the moment production
  connects as the provided non-owner role (`cms_app`, created best-effort by
  migrations). App-level filtering remains the first line of defense.

## Acceptance criteria (tests)

- [x] signup → verify → login round-trip (`test_accounts.py`)
- [x] login blocked before verification, works after
- [x] refresh rotates (old refresh token rejected after use)
- [x] password reset flow
- [x] invitation: invite → accept creates membership + role assignment
- [x] cross-account isolation: token for account A cannot read account B space
- [x] switch-account issues token scoped to the other account (member only)

## Tasks

- [x] Models + dev migrations + Alembic migration
- [x] security.py: claims, refresh/action token helpers
- [x] mailer.py
- [x] auth router rewrite + accounts router
- [x] deps: account claim validation + RLS set_config + membership check
- [x] permissions: capabilities filtered by active account
- [x] Frontend auth pages + onboarding wizard + account switcher
- [x] Tests
- [ ] SMTP config in production, real email templates
- [ ] Connect as `cms_app` (non-owner) role in production to activate RLS
