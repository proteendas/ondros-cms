# Ondros CMS — a Contentful-style headless CMS

FastAPI + Next.js + Postgres/PgVector. Multi-tenant **spaces & environments**,
rich **content modeling** (references/assemblies, localization, media), split
**delivery / preview / management APIs** with scoped API keys, **roles &
permissions**, **webhooks**, a polished **visual editor** with live preview +
inline editing (AEM Universal Editor / Contentful Live Preview-style), and
**guideline-aware AI** that works with free providers (Groq, Gemini, Ollama).

```
┌───────────────┐   REST + WS    ┌────────────────┐   SQL + pgvector  ┌──────────┐
│ editor (Next) │ ─────────────► │ backend        │ ────────────────► │ Postgres │
│ :3000         │                │ (FastAPI) :8000│                   │ :5432    │
└──────┬────────┘                └───────▲────────┘                   └──────────┘
       │ iframe + postMessage           │ delivery/preview API (API keys) + WS
┌──────▼────────┐                       │
│ preview (Next)│ ──────────────────────┘
│ :3001         │   renders entries with data-cms-* attributes
└───────────────┘
sdk/               zero-dependency TypeScript client for any frontend
```

## Quickstart

```bash
cp .env.example .env          # optionally pick a free AI provider (groq/gemini/ollama)
docker compose up --build -d
docker compose exec backend python -m app.seed
```

| Service   | URL                        | Notes                                          |
|-----------|----------------------------|------------------------------------------------|
| Editor    | http://localhost:3000      | `admin@example.com`/`admin123` (org admin), `editor@example.com`/`editor123` (space editor) |
| Preview   | http://localhost:3001      | Site frontend; published content + draft mode  |
| Superadmin| http://localhost:3003      | Platform-operator dashboard — `superadmin@example.com`/`super123` |
| API docs  | http://localhost:8000/docs | Swagger UI (use `/auth/token` to authorize)    |

The public marketing/brand site (landing/features/pricing/docs/support)
lives in its own repo, [ondros-cms-site](https://github.com/proteendas/ondros-cms-site),
deployed separately on Vercel. Its Login / Get Started CTAs point at this
app's editor via `NEXT_PUBLIC_APP_LOGIN_URL` / `NEXT_PUBLIC_APP_SIGNUP_URL`.

Deploying somewhere other than your laptop? [DEPLOYMENT.md](DEPLOYMENT.md)
covers a full free-tier hosting path (Vercel + Render/Railway +
Neon/Supabase) for educational use.

The seed creates a **Marketing Site** space (locales `en-US` + `fr`) with a
`master` environment, an assembly-style model (`landing_page` → `hero` +
`card[]`), localized entries, system roles, and two dev API keys
(`cms_del_dev-delivery-token-0000`, `cms_pre_dev-preview-token-0000`) that the
docker-compose defaults already reference — so everything works out of the box.

Try it:

- **Content → welcome**: type in the form, watch the split-view preview update
  live; switch the `fr` locale tab; click preview text to jump to its field;
  double-click to edit inline (works on nested hero/card blocks too).
- **Content model**: drag-reorder fields, add a `reference_many` field, see the
  live sample form.
- **Settings → API keys**: create a key, copy the one-time token, open
  "How to use" for curl/SDK snippets.

```bash
# Delivery API (published only, resolves references + locales):
curl "http://localhost:8000/spaces/<spaceId>/environments/master/delivery/entries?content_type=landing_page&include=2&locale=fr" \
  -H "Authorization: Bearer cms_del_dev-delivery-token-0000"
```

## Concepts (Contentful mapping)

| Concept        | Here                                                        |
|----------------|-------------------------------------------------------------|
| Organization   | `Tenant`                                                     |
| Space          | `Space` (owns locales, API keys, webhooks)                   |
| Environment    | `Environment` (`master`, `staging`, …) — content types AND entries are environment-scoped; cloning copies both and **remaps reference ids** |
| Content type   | `ContentType` with `FieldDef[]` schema                       |
| Field types    | text, longtext, richtext, number, boolean, datetime, select (enum), media, media_many, reference, reference_many (assemblies), json, slug — each optionally `localized` |
| Entry          | draft `fields` vs frozen `published_fields`; workflow draft → in_review → published → archived |
| Localization   | localized fields store `{locale: value}`; delivery resolves via `?locale=` (fallback to default locale, `*` = raw maps) |
| API keys       | `delivery` (published only), `preview` (drafts too), `management` (space CRUD); hashed at rest, environment-scopable, shown once |
| Roles          | ORG_ADMIN, SPACE_ADMIN, EDITOR, AUTHOR, VIEWER (+ custom roles), assigned org-wide or per space; capability checks on every endpoint |
| Webhooks       | per-space, event + content-type + environment filters, HMAC-signed (`X-CMS-Signature`), delivery log in the UI |

## The three API planes

- **Management** (`Authorization: Bearer <user JWT or cms_mgm_… key>`):
  `/spaces`, `/spaces/{id}/environments` (+clone), `/spaces/{id}/api-keys`,
  `/spaces/{id}/webhooks`, `/spaces/{id}/environments/{env}/content-types|entries|media`,
  `/entries/{id}[/publish|/unpublish|/archive]`, bulk actions, `/users`, `/roles`, `/ai/*`.
- **Delivery/Preview** (`cms_del_…` / `cms_pre_…` keys):
  `/spaces/{id}/environments/{env}/delivery/entries|assets` with
  `content_type`, `slug`, `q`, `locale`, `include` (0–3 link resolution),
  `order`, `limit/skip`; plus `/token-info` to bootstrap from a token.
- **Realtime**: `/ws/entries/{id}` for live preview + editor sync.

## SDK

`sdk/` ships a zero-dependency typed client (see [sdk/README.md](sdk/README.md)):

```ts
const client = createClient({ baseUrl, spaceId, environment: 'master', accessToken });
const page = await client.getEntryBySlug({ contentType: 'landing_page', slug: 'home', include: 2 });
const hero = page.resolve(page.entry?.fields.hero);   // resolves from includes
```

## AI (free-provider friendly)

Set `AI_PROVIDER` in `.env` — every option uses the same OpenAI-compatible code path:

| Provider     | Cost        | Embeddings | Notes                                   |
|--------------|-------------|------------|-----------------------------------------|
| `groq`       | free tier   | no → keyword retrieval | fastest, console.groq.com  |
| `gemini`     | free tier   | yes (set `EMBEDDING_DIM=768`) | aistudio.google.com |
| `ollama`     | 100% local  | yes (`EMBEDDING_DIM=768`) | needs `ollama serve` |
| `openrouter` | free models | no → keyword retrieval | openrouter.ai           |
| `openai`     | paid        | yes        |                                         |
| `azure_openai`| paid       | yes        | uses the AZURE_OPENAI_* settings        |

Features: generate entry from brief, rewrite/shorten/expand/SEO-tone a field,
**title suggestions**, **SEO meta generation**, **locale translation**
(`en-US → fr` button in the editor), and guideline compliance checks — all
grounded in your ingested guidelines (vector search when embeddings exist,
keyword retrieval otherwise; `/ai/status` reports the active mode).

## Tests

```bash
docker compose up -d db
docker compose run --rm --entrypoint sh backend -c "pip install -q -r requirements-dev.txt && pytest"
```

49 tests cover role/capability enforcement, API-key scoping, schema
validation, reference integrity, environment cloning, accounts
(signup/verify/refresh/reset/invitations/isolation), locales + fallback
chains, billing limits (402/429), SSO + GitHub OAuth with JIT provisioning,
versions/audit, and the platform-admin API (access control, suspension across
planes, audited impersonation).

## Repository layout

```
backend/
  app/
    main.py                 app wiring, request logging + error middleware
    config.py               env-driven settings (AI provider selection)
    migrations.py            idempotent dev migrations (create_all + upgrades)
    seed.py                  demo workspace (roles, locales, assemblies, API keys)
    core/
      permissions.py         Capability enum + system roles + checks
      security.py            bcrypt, JWT, API-token generate/hash
      events.py              webhook dispatcher (async, HMAC-signed, logged)
      validation.py          locale-aware schema validation + link collection
      ws_manager.py          per-entry WebSocket rooms
    models/                  tenancy (Tenant/Space/Environment/Role/assignments),
                             content (ContentType/Entry/MediaAsset),
                             api_keys, webhooks, guidelines (pgvector)
    api/                     auth, spaces, api_keys, webhooks, content_types,
                             entries, media, delivery (+/token-info), ai,
                             guidelines, users, ws
    ai/                      client (multi-provider), retrieval (vector|keyword),
                             ingestion, prompts, services
  tests/                     pytest suite (real Postgres)
editor/                      Next.js visual editor (app shell, model builder,
                             entries + locale tabs + pickers, media library,
                             settings: api-keys/environments/webhooks/roles)
preview/                     Next.js site (delivery/preview API, draft mode,
                             nested assembly rendering, inline-editing bridge)
superadmin/                  Next.js platform-operator dashboard (:3003 —
                             accounts/users/revenue/usage/health, impersonation)
sdk/                         @ondros/sdk TypeScript SDK
cli/                         ondros-cli (login, types export/import, codegen)
```

The public marketing/brand site is a separate repo, `ondros-cms-site`
(Next.js, Vercel-hosted) — see the Quickstart section above.

## Production notes

- Replace `create_all` + `app/migrations.py` with Alembic.
- Seeded dev tokens (`SEED_*_TOKEN`) are for local use — create real keys in
  the UI and rotate `JWT_SECRET`.
- The WebSocket manager is in-memory (single process); back it with Redis
  pub/sub for multiple replicas.
- Media is stored on local disk (`/files`); swap the save/delete/variant
  helpers in `app/api/media.py` for S3/Azure Blob.
- Editor holds JWTs in localStorage and embeds a preview key at build time —
  move both behind httpOnly cookies / short-lived minted tokens for hardened
  deployments.
