# Spec-Driven Development

Every feature ships through this pipeline:

```
specs/NNN-name.md  ──►  implementation (backend → SDK → frontend)  ──►  tests  ──►  status update in spec + GAP-REPORT.md
```

Rules:

1. **Spec first.** A workstream is not started until its spec records: current
   state, requirements, data model, API surface, acceptance criteria, tasks.
2. **Additive changes.** Specs extend the existing architecture (see each
   spec's *Current state* section); no rewrites.
3. **Status is tracked in the spec** (task checkboxes) and rolled up in
   [GAP-REPORT.md](GAP-REPORT.md).
4. **Acceptance criteria map to tests** (backend: `backend/tests/`,
   frontend: `tsc --noEmit` + manual smoke script in the spec).

## Workstreams

| # | Spec | Scope | Status |
|---|------|-------|--------|
| 1 | [001-accounts-onboarding.md](001-accounts-onboarding.md) | Signup, email verification, refresh tokens, invitations, multi-account membership, RLS | **Implemented** (SMTP + prod RLS role pending) |
| 2 | [002-sso.md](002-sso.md) | OIDC (Google/Microsoft/custom), SAML config, JIT provisioning, enforcement | **OIDC implemented** (needs IdP creds to activate); SAML scaffolded |
| 3 | [003-dynamic-locales.md](003-dynamic-locales.md) | First-class Locale model, ISO catalog, fallback chains, AI translate any pair | **Implemented** |
| 4 | [004-sdk-cli-openapi.md](004-sdk-cli-openapi.md) | `@ondros/sdk` v2 (retry/cache/filters/link resolution), `ondros-cli`, OpenAPI export | **Implemented** |
| 5 | [005-billing-usage.md](005-billing-usage.md) | Plans, subscriptions, usage counters, limit enforcement, Stripe | **Implemented** (dev mode; Stripe needs keys) |
| 6 | [006-audit-versioning.md](006-audit-versioning.md) | Audit log, entry version snapshots, diff + restore | **Implemented** |
| 7 | [007-rebrand-branding.md](007-rebrand-branding.md) | Rebrand → Ondros CMS, central brand config, logo assets | **Implemented** (placeholder artwork) |
| 8 | [008-icon-migration.md](008-icon-migration.md) | Emoji → Bootstrap Icons via central `Icon` wrapper | **Implemented** |
| 9 | [009-marketing-site.md](009-marketing-site.md) | Public marketing site (landing/features/pricing/support) | **Implemented** (placeholder links) |
| 10 | [010-marketing-polish.md](010-marketing-polish.md) | Responsive/hamburger nav, 3D hero (R3F), scroll reveals, token consolidation | **Implemented** |
| 11 | [011-docs.md](011-docs.md) | `/docs` MDX documentation section on the marketing site | **Implemented** |
| 12 | [012-oauth-login.md](012-oauth-login.md) | Login cleanup + Google/GitHub OAuth with JIT personal accounts | **Implemented** (needs OAuth app creds to activate) |
| 13 | [013-superadmin.md](013-superadmin.md) | Platform super-admin: `/platform` API + independent dashboard app (:3003) | **Implemented** |
| 14 | [014-deployment-guide.md](014-deployment-guide.md) | DEPLOYMENT.md free-tier hosting guide | **Implemented** |
| 15 | [015-rich-text-editor.md](015-rich-text-editor.md) | Rich text: JSON model, color/highlight, tables, embeds, slash menu, restrictions | **Implemented** |

## Architecture invariants (all specs must respect)

- **Tenancy**: `Tenant` **is** the Account (top-level company). Every tenant
  table carries `tenant_id`; every query filters by the account resolved from
  the JWT — never from the request body.
- **Three API planes**: management (JWT / `cms_mgm_*`), delivery+preview
  (`cms_del_*` / `cms_pre_*`), realtime (WS).
- **Capabilities**: `app/core/permissions.py` is the single catalog; new
  endpoints declare a capability.
- **Events**: mutations emit webhook events via `app/core/events.py` and audit
  entries via `app/core/audit.py`.
- **Migrations**: `app/migrations.py` (idempotent dev upgrades, runs at boot)
  + `backend/alembic/` (production path). Both must cover every schema change.
- **Frontend**: pages use the design system in `editor/src/app/globals.css`,
  the `useWorkspace()` context, and `api()` from `editor/src/lib/api.ts`.
