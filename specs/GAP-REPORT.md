# Gap Report — SaaS Upgrade (Accounts, SSO, Locales, SDK, Billing, Audit, Brand)

Status roll-up for the spec-driven upgrade. Per-workstream detail lives in the
numbered specs. Legend: ✅ implemented & tested · 🟡 implemented, needs
external credentials/deps to fully activate · ⬜ next.

## 1. What already existed (before this upgrade)

| Area | State |
|------|-------|
| Tenancy | `Tenant → Space → Environment` hierarchy; every row tenant-scoped; app-level query isolation |
| Auth | Email/password (bcrypt), single 24h access JWT, seeded users only — **no signup, verification, refresh, reset, invitations** |
| Roles | Capability catalog + system roles (ORG_ADMIN…VIEWER), org/space-scoped assignments |
| Locales | Dynamic per space (`spaces.locales` JSONB + default) — **but** free-text codes, no fallback chains, no first-class rows |
| APIs | Management / delivery / preview planes with scoped hashed API keys; include resolution; env cloning with ref remapping |
| AI | Multi-provider (Groq/Gemini/Ollama/OpenRouter/OpenAI/Azure), RAG guidelines, translate-fields endpoint (any locale pair) |
| Webhooks | Signed dispatch + delivery log |
| SDK | `@acme/cms-client` v1: typed fetch wrapper — **no retry/cache/filters/codegen/CLI** |
| Versioning/Audit | `Entry.version` counter only — **no snapshots, no audit trail** |
| Billing / SSO / RLS | **Nothing** |
| Migrations | boot-time `create_all` + idempotent dev upgrades — **no Alembic** |

## 2. Implemented in this upgrade

### WS1 — Accounts & onboarding (spec 001) ✅
- New: `AccountMember`, `Invitation`, `RefreshToken`, `ActionToken`, `users.email_verified`.
- `/auth/signup` (Account + ORG_ADMIN + system roles), `/auth/verify-email`,
  `/auth/login` → **access+refresh pair** (claims: sub, account_id, roles[]),
  `/auth/refresh` (rotation), `/auth/forgot-password`, `/auth/reset-password`,
  `/auth/switch-account`, `/accounts`, invitations CRUD + public accept.
- `get_current_account()` / upgraded `get_actor()`: account from token claim
  only, membership-validated; binds `app.current_account_id` per transaction.
- Postgres **RLS policies** on all tenant tables (+ best-effort `cms_app` role).
  🟡 Active once production connects as a non-owner role.
- Frontend: /signup, /verify-email, /forgot-password, /reset-password,
  /accept-invite/[token], 3-step onboarding wizard, **account switcher** in the
  top bar, silent token refresh in the API client.
- 🟡 SMTP: emails log to console in dev (`AUTH_DEV_MODE` also returns tokens);
  set `SMTP_*` env for real delivery.

### WS2 — SSO (spec 002) 🟡
- `SSOConfig` model + Settings → Security UI (create/edit/test/enforce).
- **OIDC end-to-end** via authlib: `/sso/{slug}/login` → IdP → callback →
  id_token verified against JWKS → JIT provisioning (domain-restricted,
  configurable default role) → token pair via URL fragment.
- Google/Microsoft social login (existing users) via `/sso/google|microsoft/*`.
- Enforcement: password login returns `428 sso_required`; login page
  auto-redirects by email domain.
- 🟡 Needs real IdP client credentials to exercise the callback live.
- ⬜ SAML runtime: config stored; endpoint returns 501 until `python3-saml`
  (xmlsec) is added to the image. ⬜ Encrypt client_secret at rest.

### WS3 — Dynamic locales (spec 003) ✅
- First-class `Locale` rows (fallback_locale, is_active, position) with
  migration backfill from the JSONB cache; cache kept in sync for old readers.
- `/spaces/{id}/locales` CRUD + make-default; ISO catalog picker (~90 locales)
  in Settings → Locales and the onboarding wizard.
- Delivery API walks **fallback chains** (hi-IN → fr → default, cycle-safe).
- Editor: locale tabs already dynamic; new **“AI translate {locale} to …”**
  dropdown for any active pair.

### WS4 — SDK, CLI, OpenAPI (spec 004) ✅
- `@ondros/sdk` v2: `createClient({spaceId, environmentId, accessToken, host,
  previewHost})`, retry/backoff+jitter, stale-while-revalidate cache,
  **`fields.*` filters** (backend support added), server link resolution +
  `resolveLinks()` deep inliner.
- `ondros-cli` (zero-dep Node 18+): login (auto-refresh), spaces,
  types export/import, `generate-types` → typed interfaces incl. enum unions.
- `scripts/export_openapi.py` → `openapi.json` (84 paths).
- ⬜ npm publish (needs org/token).

### WS5 — Billing & usage (spec 005) ✅ (dev mode) / 🟡 (Stripe)
- `Plan` (free/starter/pro seeded), `Subscription`, `UsageCounter`.
- Usage: API calls counted async per month; entries/storage/seats/spaces
  computed live. `GET /billing/subscription` returns plan + usage.
- Enforcement: **402 plan_limit_reached** on entry create / media upload /
  invitations / space create; **429 api_quota_exceeded** with Retry-After.
- Stripe Checkout + signature-verified webhook; `BILLING_DEV_MODE` activates
  plans locally without Stripe. Settings → Billing UI with usage meters.
- ⬜ Metered usage reporting, proration, invoice history UI.

### WS6 — Audit log & version history (spec 006) ✅
- `AuditLog` (actor, action, resource, diff) written across entries, content
  types, media, spaces, locales, invitations, SSO, billing.
- `EntryVersion` snapshot on every save/transition (pruned to 50);
  `GET/POST /entries/{id}/versions[/…/restore]`.
- Editor: 🕘 **History panel** (per-field diff vs current, one-click restore);
  Settings → Audit log page with filters.

### WS7 — Rebrand → Ondros CMS (spec 007) ✅ (placeholder artwork)
- Single change-point branding: `editor/src/lib/brand.ts` (BRAND config) +
  `settings.brand_name` (backend); shell/login/signup/titles/emails read it.
- `/branding/` assets: placeholder `logo.svg` + `logo-icon.svg` (marked
  `TODO: replace placeholder logo`) + generated `favicon.ico`, wired into
  favicon metadata, top bar, auth pages, marketing site.
- Package renames: `@ondros/sdk`, `ondros-cli` (rc file `~/.ondrosrc.json`),
  `ondros-editor`, `ondros-preview`; API-key snippet + README updated.
- ⬜ Final logo artwork swap-in (manual design task).

### WS8 — Icon migration → Bootstrap Icons (spec 008) ✅
- `react-bootstrap-icons` is the single icon dependency; central
  `components/ui/Icon.tsx` maps ~60 semantic names (edit, delete, webhook,
  api-key, environment, locale, field types…) to Bootstrap Icons.
- Every emoji/glyph icon replaced across: sidebar nav, dashboard, entries list
  + editor (history/panes), content-type builder (drag/reorder/type glyphs via
  `FIELD_TYPE_INFO`), media library + pickers, reference picker, AI sidebar,
  settings pages, modals/empty states. Preview overlay hover tag embeds the
  Bootstrap `pencil-fill` SVG inline (no dep added to that bundle).

### WS9 — Marketing site (spec 009) ✅ (placeholder external links)
- New decoupled `marketing/` Next.js app on :3002 (own Dockerfile + compose
  service): landing (hero/features/how-it-works), features, pricing (tiers +
  comparison table + billing FAQ), support (docs/email/community/status +
  contact form), site-wide nav + footer.
- All Login / Get Started CTAs resolve from `NEXT_PUBLIC_APP_LOGIN_URL` /
  `NEXT_PUBLIC_APP_SIGNUP_URL` — no duplicate login form.
- Same design tokens as the editor (indigo/slate, same font stack), Bootstrap
  Icons, responsive grids.
- ⬜ Real docs/community/status destinations.

### Cross-cutting
- Alembic scaffold + `0001_saas_upgrade` revision (production path); dev keeps
  boot-time migrations. OpenAPI export. New deps: authlib, stripe,
  email-validator, alembic; frontend: react-bootstrap-icons.

## 3. Verification

- Backend: **41 tests** across permissions, API-key scoping, validation,
  accounts (signup/verify/refresh/reset/invite/isolation/switch), locales
  (CRUD + fallback chains), versions/audit, billing limits (402/429 paths),
  SSO (CRUD/lookup/enforcement/redirect/SAML gating), `fields.*` filters.
- Frontends: `tsc --noEmit` clean; smoke via running dev stack.

## 4. What will be implemented next (priority order)

1. **SAML runtime** — add `python3-saml` + xmlsec to the backend image,
   implement the ACS endpoint against `SSOConfig.metadata_xml` (spec 002).
2. **Secret hygiene** — envelope-encrypt SSO client secrets & webhook secrets
   (KMS/fernet); rotate seeded dev tokens automatically outside dev.
3. **Production RLS** — connect the app as `cms_app` (non-owner) so policies
   actually bite; add regression tests running under that role.
4. **Email templates + provider** — real transactional templates
   (verify/invite/reset) over SMTP/SES; drop AUTH_DEV_MODE token echoes.
5. **Stripe hardening** — metered API-call reporting, seat quantity sync,
   proration, dunning states surfaced in the UI.
6. **SDK codegen v2** — locale-map aware generic types (`CmsEntry<TFields>`),
   watch mode, publish `@ondros/sdk` + `ondros-cli` to npm.
7. **Ops** — Alembic autogenerate CI check, rate limiting per key (config
   exists on ApiKey), Redis-backed WS manager for multi-replica.
8. **Brand polish** — final Ondros logo artwork (replace placeholder SVGs +
   regenerate favicon), real docs/community/status links on the marketing
   site, OG images per marketing page.
