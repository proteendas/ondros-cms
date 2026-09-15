# Architecture

How the pieces fit, and why they're arranged this way.

## System context

```mermaid
flowchart TB
    subgraph people[" "]
        EDITOR["👤 Content editor"]
        DEV["👤 Developer"]
        OP["👤 Platform operator"]
    end

    subgraph ondros["Ondros CMS"]
        ED["Editor app<br/><i>Next.js :3000</i>"]
        SA["Superadmin app<br/><i>Next.js :3003</i>"]
        PV["Preview site<br/><i>Next.js :3001</i>"]
        API["Backend API<br/><i>FastAPI :8000</i>"]
        DB[("Postgres 16<br/>+ pgvector")]
    end

    SITE["Your production frontend"]
    HOOK["Your webhook receiver"]
    LLM["AI provider<br/><i>OpenAI-compatible</i>"]

    EDITOR --> ED
    OP --> SA
    DEV --> SITE
    ED --> API
    SA --> API
    PV --> API
    SITE -->|"delivery key"| API
    API --> DB
    API -->|"signed POST"| HOOK
    API --> LLM
    ED -.->|"iframe + postMessage"| PV

    style API fill:#4f46e5,color:#fff
    style DB fill:#336791,color:#fff
```

Only the **backend** talks to the database. Every frontend — including the ones
in this repo — is just an API client. That's what makes it "headless": you can
delete `preview/` entirely and serve content to anything that speaks HTTP.

## Containers

| Container | Stack | Port | Responsibility |
|---|---|---|---|
| `db` | Postgres 16 + pgvector | 5432 | All persistence, including guideline embeddings |
| `backend` | FastAPI + SQLAlchemy async | 8000 | All three API planes, auth, webhooks, AI, WebSockets |
| `editor` | Next.js 14 App Router | 3000 | Visual editor: modeling, entries, media, settings |
| `preview` | Next.js 14 App Router | 3001 | Demo consumer + inline-editing bridge |
| `superadmin` | Next.js 14 App Router | 3003 | Cross-tenant operator dashboard |

## Backend internals

```mermaid
flowchart TD
    REQ["HTTP request"] --> MW1["CORS middleware"]
    MW1 --> MW2["request_logging middleware<br/><i>request id, timing, 500 catch-all</i>"]
    MW2 --> R["Router<br/><i>18 routers</i>"]
    R --> DEP["Dependencies<br/><i>api/deps.py</i>"]

    DEP --> A1["get_actor<br/><i>JWT or API key → Actor</i>"]
    A1 --> A2["_ensure_account_active<br/><i>suspended tenants rejected</i>"]
    A2 --> A3["require_capability<br/><i>permission check</i>"]
    A3 --> A4["get_space / resolve_environment<br/><i>scope resolution</i>"]

    A4 --> H["Route handler"]
    H --> V["validation.py<br/><i>schema + locale rules</i>"]
    H --> DB[("Postgres")]
    H --> EV["events.emit<br/><i>fire-and-forget webhooks</i>"]
    H --> WS["ws_manager<br/><i>broadcast to preview rooms</i>"]

    style A1 fill:#4f46e5,color:#fff
    style A3 fill:#dc2626,color:#fff
```

Every management request converges on one abstraction — the **`Actor`**
(`backend/app/api/deps.py`). It represents "who is asking", whether that's a
logged-in user or a management API key:

```python
@dataclass
class Actor:
    tenant_id: uuid.UUID      # the ACTIVE account
    user: User | None = None
    api_key: ApiKey | None = None
```

The security-critical detail is in its docstring: `tenant_id` comes from the
**validated JWT `account_id` claim, never from the request body**. A user who
belongs to three accounts gets a token scoped to exactly one, and no request
parameter can widen that. Tenant isolation is a property of the token, not of
the query the handler happens to write.

### Layers

```
backend/app/
  main.py          app wiring, middleware, lifespan (init_db)
  config.py        pydantic-settings; env-driven, AI provider auto-detection
  database.py      async engine, session factory, init_db()
  migrations.py    idempotent in-place dev migrations
  seed.py          demo workspace

  api/             HTTP layer — 18 routers, thin; auth via deps.py
  core/            domain logic with no HTTP knowledge:
                     permissions.py  Capability enum, system roles, checks
                     security.py     bcrypt, JWT, API token generate/hash
                     validation.py   locale-aware schema validation
                     events.py       webhook dispatch (HMAC, async, logged)
                     richtext.py     ProseMirror document validation
                     ws_manager.py   per-entry WebSocket rooms
                     usage.py        counters + limit enforcement
                     audit.py        audit trail writer
                     mailer.py       SMTP, or log-only when unconfigured
  models/          SQLAlchemy 2.0 typed models (25 tables)
  ai/              client (multi-provider), retrieval, ingestion, prompts
```

`core/` is where the interesting rules live and it deliberately knows nothing
about FastAPI — which is why `validation.py` and `permissions.py` are directly
unit-testable without spinning up an app.

## The three API planes

One backend, three authentication schemes, three very different trust levels:

```mermaid
flowchart LR
    subgraph clients["Clients"]
        U["Editor user"]
        MK["cms_mgm_ key"]
        PK["cms_pre_ key"]
        DK["cms_del_ key"]
    end

    U -->|"JWT"| M["Management plane<br/><i>full CRUD</i>"]
    MK --> M
    PK --> P["Preview plane<br/><i>drafts included</i>"]
    DK --> D["Delivery plane<br/><i>published only</i>"]

    M --> DB[("Postgres")]
    P --> DB
    D --> DB

    style M fill:#dc2626,color:#fff
    style P fill:#b54708,color:#fff
    style D fill:#067647,color:#fff
```

The plane is chosen by the **token prefix**, which makes the trust boundary
visible in the credential itself — you can tell at a glance whether a key
leaked into a client bundle is a catastrophe (`cms_mgm_`) or merely public data
(`cms_del_`). Details in [06-api/README.md](06-api/README.md).

## Key flows

### Publishing an entry

```mermaid
sequenceDiagram
    participant E as Editor
    participant API as Backend
    participant DB as Postgres
    participant W as Webhook receiver

    E->>API: POST /entries/{id}/publish
    API->>API: require_capability(PUBLISH_ENTRIES)
    API->>DB: load entry + content type
    API->>API: validate_entry_fields(fields, schema)
    API->>API: validate_references (linked ids exist?)
    API->>DB: published_fields = fields<br/>status = published<br/>published_at = now()
    API->>DB: insert EntryVersion snapshot
    API->>DB: insert AuditLog row
    API-->>E: 200 updated entry
    API--)W: POST entry.publish<br/>X-CMS-Signature: sha256=…
```

Webhook dispatch is **fire-and-forget** (`asyncio` task, not awaited), so a
slow or dead receiver can't make publishing hang. The trade-off: delivery isn't
guaranteed across a restart. Every attempt is recorded in `webhook_deliveries`
so you can see what happened.

### Live preview with inline editing

The feature that makes the editor feel like a page builder rather than a form:

```mermaid
sequenceDiagram
    participant U as User
    participant ED as Editor (:3000)
    participant IF as Preview iframe (:3001)
    participant API as Backend

    U->>ED: types in a field
    ED->>ED: local state updates
    ED->>IF: postMessage(field changed)
    IF->>IF: patch the rendered DOM in place
    Note over ED,IF: no network round-trip — instant

    U->>IF: double-clicks rendered text
    IF->>ED: postMessage(edit requested, fieldId)
    ED->>ED: focus that field in the form

    U->>ED: Save
    ED->>API: PATCH /entries/{id}
    API--)ED: WebSocket broadcast to other editors
```

The preview page annotates its markup with `data-cms-*` attributes, which is
how the bridge maps a clicked DOM node back to a field id. Both directions are
`postMessage`, so the preview can be any origin you control.

### Environment cloning

```mermaid
flowchart LR
    M["master<br/><i>content types + entries</i>"] -->|"clone"| S["staging"]
    subgraph remap["Reference remapping"]
        direction TB
        R1["old entry id → new entry id"]
        R2["rewrite every reference field"]
    end
    M -.-> remap
    remap -.-> S
```

Cloning copies schema **and** content, then rewrites every reference field so
links point at the clone's own entries rather than back at `master`. Without
that remap you'd get a staging environment whose entries silently reference
production content.

## Data flow at delivery time

```mermaid
flowchart TD
    REQ["GET /…/delivery/entries<br/>?content_type=landing_page<br/>&locale=fr&include=2"]
    REQ --> AUTH{"key type?"}
    AUTH -->|"cms_del_"| PUB["published_fields only"]
    AUTH -->|"cms_pre_"| DRAFT["fields (drafts)"]
    PUB --> FILTER["filter by content type,<br/>slug, q, order, limit/skip"]
    DRAFT --> FILTER
    FILTER --> LOC["resolve locale<br/><i>requested → fallback → default</i>"]
    LOC --> LINK["collect linked ids<br/>(references + media)"]
    LINK --> INC{"include depth<br/>remaining?"}
    INC -->|"yes"| LINK
    INC -->|"no"| OUT["{ items, total, skip, limit,<br/>  includes: { Entry: [], Asset: [] } }"]
```

Links resolve **breadth-first into a flat `includes` map** (`MAX_INCLUDE_DEPTH = 3`,
`MAX_INCLUDED_ENTITIES = 200`), not by nesting objects inside each other. A hero referenced by five entries is serialized once
and referenced five times. The SDK's `resolve()` helper walks that map for you.

## Design decisions worth knowing

| Decision | Why | Cost |
|---|---|---|
| Content types stored as JSONB `fields[]` | Schema changes need no migration; content modeling is a data operation | No FK-level integrity on field definitions; validation is application-side |
| Draft/published as two columns on one row | Publishing is atomic and cheap; no join to read published content | Only one draft in flight per entry |
| References resolved app-side, not SQL joins | Depth without recursive CTEs; BFS, one round of queries per level | `include=3` means 3 sequential rounds; capped at 200 included entities |
| Webhooks fire-and-forget | Publishing latency stays flat | No delivery guarantee across restarts |
| WebSocket rooms in process memory | Zero infrastructure for live preview | **Breaks with >1 replica** — see [01-overview.md](01-overview.md) |
| `create_all` on boot + Alembic available | Works on first run with no migration step | Boot-time schema changes are wrong for production; use Alembic |

## Where to go next

- The tables behind all this → [05-data-model.md](05-data-model.md)
- How permissions are enforced → [07-auth-and-permissions.md](07-auth-and-permissions.md)
- The API surface → [06-api/README.md](06-api/README.md)
- Frontend structure → [09-frontend-apps.md](09-frontend-apps.md)
