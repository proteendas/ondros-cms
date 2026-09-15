# Ondros CMS documentation

A headless, multi-tenant CMS: FastAPI + Postgres/pgvector behind three Next.js
apps. Content teams model and write; your frontend reads JSON.

## Start here

| I want to… | Read |
|---|---|
| Understand what this is | [01-overview.md](01-overview.md) |
| Run it locally | [04-getting-started.md](04-getting-started.md) |
| Pull content into my site | [06-api/delivery-api.md](06-api/delivery-api.md) → [14-sdk.md](14-sdk.md) |
| Understand how it's built | [02-architecture.md](02-architecture.md) |
| Deploy it | [17-deployment/](17-deployment/) |
| Change the code | [19-contributing.md](19-contributing.md) |

## By role

**Frontend developer consuming content**
[01](01-overview.md) → [06-api/delivery-api.md](06-api/delivery-api.md) →
[14-sdk.md](14-sdk.md) → [12-webhooks.md](12-webhooks.md)

**Backend or full-stack contributor**
[02](02-architecture.md) → [05](05-data-model.md) →
[07](07-auth-and-permissions.md) → [16](16-testing.md) → [19](19-contributing.md)

**Content modeller / editor lead**
[01](01-overview.md) → [08](08-content-modeling.md) →
[11](11-ai-features.md) → [07](07-auth-and-permissions.md)

**Operator deploying and running it**
[03](03-tech-stack.md) → [17-deployment/](17-deployment/) →
[18](18-configuration.md) → [13](13-billing-and-usage.md)

## All documents

### Concepts

| | |
|---|---|
| [01-overview.md](01-overview.md) | What it is, the draft/published model, Contentful mapping |
| [02-architecture.md](02-architecture.md) | Containers, request pipeline, publish and live-preview flows |
| [03-tech-stack.md](03-tech-stack.md) | Every technology and why it's there |
| [04-getting-started.md](04-getting-started.md) | Local setup to first API call |
| [05-data-model.md](05-data-model.md) | All 25 tables, as ERDs |

### API

| | |
|---|---|
| [06-api/README.md](06-api/README.md) | The three planes, auth, conventions, errors |
| [06-api/management-api.md](06-api/management-api.md) | Every write endpoint, with required capabilities |
| [06-api/delivery-api.md](06-api/delivery-api.md) | Public reads, locales, link resolution |
| [06-api/platform-admin-api.md](06-api/platform-admin-api.md) | Cross-tenant operator API |
| [06-api/websocket-api.md](06-api/websocket-api.md) | Live entry updates |

### Building with it

| | |
|---|---|
| [07-auth-and-permissions.md](07-auth-and-permissions.md) | Tokens, capabilities, roles, SSO |
| [08-content-modeling.md](08-content-modeling.md) | Field types, validation, assemblies, localization |
| [09-frontend-apps.md](09-frontend-apps.md) | Editor, preview and superadmin internals |
| [10-ui-conventions.md](10-ui-conventions.md) | The three mandatory frontend rules |
| [11-ai-features.md](11-ai-features.md) | Providers, guideline grounding, retrieval modes |
| [12-webhooks.md](12-webhooks.md) | Events, HMAC signing, delivery semantics |
| [13-billing-and-usage.md](13-billing-and-usage.md) | Plans, metering, 402 and 429 |
| [14-sdk.md](14-sdk.md) | `@ondros/sdk` |
| [15-cli.md](15-cli.md) | `ondros-cli` |

### Operating it

| | |
|---|---|
| [16-testing.md](16-testing.md) | The suite, fixtures, what's deliberately not covered |
| [17-deployment/](17-deployment/) | Free-tier hosting guides |
| [18-configuration.md](18-configuration.md) | Every environment variable |
| [19-contributing.md](19-contributing.md) | Spec-driven workflow, conventions, known gaps |

## Also in this repo

- [`specs/`](../specs) — 15 feature specs and the gap report
- [`CLAUDE.md`](../CLAUDE.md) — UI conventions, auto-loaded by Claude Code
- `/docs` on a running backend — live Swagger UI, always current

## Five things worth knowing early

These surprise people, and each is explained in full where it belongs:

1. **Content types live inside environments, not spaces.** Cloning `master`
   into `staging` copies the schema *and* the entries, remapping reference ids.
   ([05](05-data-model.md))
2. **Every entry holds two copies of its content.** Editing never touches what
   the public sees; publishing freezes a snapshot. ([01](01-overview.md))
3. **The active tenant comes from the JWT claim, never a request parameter.**
   ([07](07-auth-and-permissions.md))
4. **`NEXT_PUBLIC_*` is inlined at build time.** Changing one without a rebuild
   does nothing. ([18](18-configuration.md))
5. **The WebSocket manager is in-process.** More than one backend replica
   silently breaks live preview. ([06-api/websocket-api.md](06-api/websocket-api.md))

## On accuracy

These pages were written against the running system and verified against it —
endpoint shapes from the live OpenAPI schema, limits and error bodies by
calling the API. Where behaviour is a known weakness, it's stated rather than
omitted; [19-contributing.md](19-contributing.md#known-gaps) collects those in
one place.

If you find something out of date, the page that describes the behaviour is the
one to fix.
