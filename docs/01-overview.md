# Overview

Ondros CMS is a **headless, multi-tenant content management system** — a
Contentful-style API-first CMS you can run yourself. Editors model and write
content in a visual editor; your website or app pulls it over a read-only HTTP
API and renders it however it likes.

"Headless" means the CMS has no opinion about your frontend. It stores
structured content and serves JSON. The `preview/` app in this repo is one
example consumer, not a requirement.

## What's in the box

| Capability | What it means |
|---|---|
| **Multi-tenancy** | Organizations → spaces → environments, isolated at every query |
| **Content modeling** | 15 field types, references/assemblies, repeatable multifield groups, per-field localization |
| **Three API planes** | Management (write), Delivery (published), Preview (drafts) |
| **Roles & permissions** | 5 system roles + custom roles over 11 capabilities, org-wide or per-space |
| **Visual editing** | Split-view live preview, click-to-field, inline editing in the rendered page |
| **Rich text** | ProseMirror JSON model with tables, colors, embedded entries/assets |
| **Localization** | First-class locales with fallback chains resolved at delivery |
| **Webhooks** | 13 event types, HMAC-signed, filtered, with a delivery log |
| **AI assistance** | Generate/rewrite/translate/SEO, grounded in your own guidelines |
| **Versioning & audit** | Entry version snapshots with diff + restore; full audit trail |
| **Billing & usage** | Plans, usage counters, enforced limits |
| **Platform admin** | Separate operator dashboard: accounts, revenue, health, impersonation |

## The core idea: draft vs published

Every entry carries **two copies** of its content:

```mermaid
flowchart LR
    subgraph Entry
        D["fields<br/>(working draft)"]
        P["published_fields<br/>(frozen snapshot)"]
    end
    E["Editor<br/>saves"] --> D
    D -->|"publish"| P
    P --> DEL["Delivery API<br/>public traffic"]
    D --> PRE["Preview API<br/>internal review"]
```

Editing never touches what the public sees. `publish` copies the draft into
`published_fields` and freezes it; the Delivery API only ever reads that frozen
copy. This is why a preview key and a delivery key return different content for
the same entry.

## Concept mapping

If you know Contentful, the vocabulary translates directly:

| Contentful | Ondros | Notes |
|---|---|---|
| Organization | `Tenant` | Called an "account" in the UI |
| Space | `Space` | Owns locales, API keys, webhooks |
| Environment | `Environment` | `master`, `staging`, … — content types **and** entries are environment-scoped |
| Content type | `ContentType` | Schema held as a `FieldDef[]` JSON array |
| Entry | `Entry` | Draft `fields` + frozen `published_fields` |
| Asset | `MediaAsset` | Files on disk by default; swap for object storage |
| Delivery / Preview / Management API | Same three planes | Distinguished by API key prefix |
| Roles | `Role` + `UserRoleAssignment` | Assignable org-wide or scoped to one space |

## The hierarchy

```mermaid
flowchart TD
    T["Tenant<br/><i>organization / account</i>"]
    T --> S1["Space<br/><i>Marketing Site</i>"]
    T --> S2["Space<br/><i>Docs</i>"]
    T --> R["Roles<br/><i>system + custom</i>"]
    T --> SUB["Subscription<br/><i>plan + usage</i>"]

    S1 --> E1["Environment: master"]
    S1 --> E2["Environment: staging"]
    S1 --> L["Locales<br/><i>en-US, fr</i>"]
    S1 --> K["API keys"]
    S1 --> W["Webhooks"]

    E1 --> CT["Content types"]
    E1 --> EN["Entries"]
    E1 --> M["Media"]

    style T fill:#4f46e5,color:#fff
    style E1 fill:#6941c6,color:#fff
```

The detail worth internalizing: **content types live inside environments, not
spaces.** Cloning `master` into `staging` copies the schema *and* the entries,
remapping every reference id so the clone is internally consistent. That's what
makes environments usable for real schema migrations rather than just content
staging.

## Who talks to what

```mermaid
flowchart LR
    ED["Editor<br/>:3000"] -->|"JWT"| API["Backend API<br/>:8000"]
    SA["Superadmin<br/>:3003"] -->|"JWT + platform admin"| API
    PV["Preview site<br/>:3001"] -->|"cms_pre_ / cms_del_ key"| API
    YOU["Your frontend"] -->|"cms_del_ key"| API
    API --> DB[("Postgres<br/>+ pgvector")]
    API -->|"HMAC POST"| WH["Your webhook endpoint"]
    API -->|"OpenAI-compatible"| AI["AI provider<br/><i>Groq / Gemini / Ollama…</i>"]
    ED <-->|"WebSocket"| API
```

## What this is not

Worth being direct about the boundaries, because they shape the deployment
advice in [17-deployment/](17-deployment/):

- **Not horizontally scalable as-is.** The WebSocket manager holds live-preview
  rooms in process memory. Two replicas means two editors silently miss each
  other's updates. Back it with Redis pub/sub before scaling out.
- **Media is local disk by default.** Fine for a single host, wrong for
  ephemeral filesystems. See [18-configuration.md](18-configuration.md).
- **Schema changes run on boot.** `init_db()` does `create_all` plus in-place
  dev migrations. Alembic migrations exist and are the production path.

## Where to go next

- Running it locally → [04-getting-started.md](04-getting-started.md)
- How the pieces fit → [02-architecture.md](02-architecture.md)
- Consuming the content API → [06-api/delivery-api.md](06-api/delivery-api.md)
- Modeling content → [08-content-modeling.md](08-content-modeling.md)
