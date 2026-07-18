# 012 — Login Page: Remove Seeded Credentials, Google + GitHub OAuth

## Current state

- `editor/src/app/login/page.tsx` pre-fills `admin@example.com` / `admin123`
  and prints both seeded credential pairs under the form.
- Spec 002 shipped global social login (`/sso/google|microsoft/*`, OIDC via
  authlib) — but it only signs in **existing** users; unknown emails get 403.
- No GitHub provider (GitHub is OAuth2-only: no id_token; identity comes from
  `GET /user` + `/user/emails`).
- Redirect URIs are derived from CORS origins (`_redirect_uri` hack).

## Requirements

1. **Remove seeded credentials** from the login page: empty initial state,
   no hint paragraph. (README keeps them — developer docs, not UI.)
2. **"Continue with Google" / "Continue with GitHub"** buttons above the
   credentials form, separated by an "or continue with" divider, with brand
   glyphs; buttons appear only when the provider is configured
   (`GET /sso/options` gains `github`).
3. **Backend GitHub OAuth2** (`/sso/github/login|callback`):
   code exchange at `github.com/login/oauth/access_token`, identity via the
   REST API (primary **verified** email required), signed `state` JWT, same
   URL-fragment token handoff as OIDC.
4. **JIT provisioning for social login** (Google, Microsoft, GitHub): unknown
   email → create a personal Account (tenant) + system roles + ORG_ADMIN
   user (`email_verified=True`, unusable password sentinel), audit
   `account.signup_social`. Existing users just get a token pair. This
   matches spec 001's signup bootstrap and spec 002's account-SSO JIT path.
5. **Config**: `BACKEND_URL` setting for OAuth redirect URIs
   (`{BACKEND_URL}/sso/{slug}/callback`) — configurable per environment,
   replacing the CORS-derived guess. New env vars `GITHUB_CLIENT_ID`,
   `GITHUB_CLIENT_SECRET` documented in `.env.example` + compose.
   *Decision*: no NextAuth — the prompt allows "or equivalent OAuth flow",
   and the existing backend-driven SSO design (spec 002) already owns
   token issuance; adding a parallel NextAuth session layer would duplicate
   auth state. `NEXTAUTH_SECRET` is therefore not needed; the state JWT is
   signed with `JWT_SECRET`.
6. Email/password login stays intact as the third option.

## API surface

- `GET /sso/options` → `{google, microsoft, github}`.
- `GET /sso/github/login` → 302 to GitHub authorize.
- `GET /sso/github/callback?code&state` → verify → JIT → 302 to
  `{FRONTEND_URL}/login#access=…&refresh=…`.
- Google/Microsoft callbacks now JIT-provision instead of 403.

## Acceptance criteria

- [x] Login page renders no seeded credentials (test: grep + manual).
- [x] `/sso/options` reports `github: false` until env vars set; button
      hidden accordingly.
- [x] With a fake-configured provider, `/sso/github/login` 302s to GitHub
      with correct client_id/redirect_uri/state (backend test).
- [x] Social callback with an unknown email creates Account + ORG_ADMIN user
      + membership + audit row, and issues a token pair (unit-tested via the
      extracted `_jit_provision_personal_account` helper).
- [x] Redirect URI comes from `settings.backend_url`.

## Tasks

- [x] `backend_url`, `github_client_id/secret` settings + `.env.example` + compose.
- [x] `app/core/oauth_github.py` (exchange + identity fetch).
- [x] `/sso/github/*` routes; JIT provisioning shared helper; options update.
- [x] Login page: strip seeds, add provider buttons + divider.
- [x] Backend tests (options gating, github redirect, JIT helper).
