# Headless CMS — FastAPI + Next.js + PgVector + Azure OpenAI

A headless CMS with a **visual editor**, **live preview with inline editing**
(in the spirit of AEM Universal Editor / Contentful Live Preview), and
**guideline-aware AI** (RAG over your own brand/editorial docs via PgVector).

```
┌───────────────┐   REST + WS    ┌────────────────┐   SQL + pgvector  ┌──────────┐
│ editor (Next) │ ─────────────► │ backend        │ ────────────────► │ Postgres │
│ :3000         │                │ (FastAPI) :8000│                   │ :5432    │
└──────┬────────┘                └───────▲────────┘                   └──────────┘
       │ iframe + postMessage           │ draft/published fetch + WS
┌──────▼────────┐                       │
│ preview (Next)│ ──────────────────────┘
│ :3001         │   renders entries with data-cms-* attributes
└───────────────┘
```

## Quickstart

```bash
cp .env.example .env          # optionally add Azure OpenAI credentials
docker compose up --build
docker compose exec backend python -m app.seed
```

| Service   | URL                        | Notes                                  |
|-----------|----------------------------|----------------------------------------|
| Editor    | http://localhost:3000      | Sign in: `admin@example.com` / `admin123` |
| Preview   | http://localhost:3001      | Public site; lists published articles  |
| API docs  | http://localhost:8000/docs | Swagger UI (use `/auth/token` to authorize) |

Then open **Entries → `welcome`** in the editor: type in the form and watch the
preview update live; click text in the preview to jump to its field; double-click
text in the preview to edit it inline.

AI features (Generate / Rewrite / Shorten / SEO / Check compliance) return
`503` until `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` are set. After
configuring them, re-embed the seeded guidelines: **Guidelines → Re-ingest**
(or `POST /guidelines/{id}/ingest`).

## Repository layout

```
backend/                      FastAPI app
  app/
    main.py                   app wiring, router map, CORS, startup
    config.py                 env-driven settings (pydantic-settings)
    database.py               async engine + first-run create_all
    seed.py                   sample tenant/user/types/entries/guidelines
    models/                   Tenant, User, Role, Space | ContentType, Entry,
                              MediaAsset | GuidelineDocument, GuidelineChunk(pgvector)
    schemas/                  Pydantic request/response models (FieldDef lives here)
    api/
      auth.py                 /auth/login (JSON), /auth/token (form), /auth/me
      content_types.py        /content-types CRUD (+ /content-types/spaces/all)
      entries.py              /entries CRUD, /entries/{id}/transition, WS broadcast
      delivery.py             /content/* (published), /preview/content/* (draft, secret)
      ai.py                   /ai/generate-entry, /ai/transform-field, /ai/check-compliance
      guidelines.py           /guidelines CRUD + /upload + /{id}/ingest + /search
      media.py                /media uploads (served at /files/*)
      ws.py                   /ws/entries/{entryId}
    core/
      security.py             bcrypt + JWT
      ws_manager.py           in-memory rooms (swap for Redis pub/sub to scale out)
    ai/
      client.py               THE provider abstraction (Azure OpenAI SDK; swap for LiteLLM here)
      ingestion.py            extract -> chunk -> embed -> store
      retrieval.py            cosine top-k over guideline chunks, tenant/space/type scoped
      prompts.py              system prompt + all prompt builders (tune tone here)
      services.py             orchestration used by /ai/* endpoints

editor/                       Next.js visual editor (TypeScript, App Router)
  src/lib/                    api client, types (mirror of schemas), postMessage
                              protocol, useEntrySocket (WS hook)
  src/app/
    content-types/            list + [id] builder (fields, validations, AI hints)
    entries/                  list + [id] editor (form | live preview | AI sidebar)
    guidelines/               manage RAG source documents
  src/components/
    DynamicEntryForm.tsx      schema-driven form (add new field types here)
    RichTextField.tsx         TipTap with a basic toolbar
    AISidebar.tsx             Generate / Rewrite / Shorten / Expand / SEO / Compliance
    LivePreviewPane.tsx       draft-mode iframe + postMessage plumbing
    InlineEditorOverlay.tsx   same-origin iframe inline editing (idle when cross-origin)
    InspectorMode.tsx         hook receiving field-selected / inline-edit messages

preview/                      Next.js delivery + preview site
  src/app/api/preview/        validates secret, enables draft mode, redirects
  src/app/api/exit-preview/   disables draft mode
  src/app/[type]/[slug]/      draft vs published fetch, renders EntryRenderer
  src/components/
    EntryRenderer.tsx         stamps data-cms-entry-id / data-cms-field-id / field-type
    InlineEditingBridge.tsx   hover/click inspector, contentEditable commits,
                              WS-driven router.refresh(), FIELD_UPDATED DOM patches
```

## How the visual editing loop works

1. The editor embeds `preview:3001/api/preview?secret&type&slug` in an iframe →
   Next.js **draft mode** cookie is set → pages fetch **draft** fields from
   `backend:8000/preview/content/...`.
2. The preview renders every field with `data-cms-entry-id` / `data-cms-field-id`
   attributes (`EntryRenderer`).
3. **Editor → preview**: on every keystroke the editor PATCHes the entry
   (debounced) and simultaneously posts `cms:field-updated` into the iframe for
   an instant DOM patch; the backend also broadcasts `entry.updated` over
   `/ws/entries/{id}` which triggers `router.refresh()` in the preview.
4. **Preview → editor**: clicking an element posts `cms:field-selected`
   (the editor scrolls/highlights that field); double-click enables
   `contentEditable`, and blur posts `cms:inline-edit` — the **editor** saves it
   via the REST API (the preview never holds credentials).

## AI / RAG pipeline

1. **Ingest** (`POST /guidelines` or `/guidelines/upload`): text is chunked
   (paragraph-aware, ~1200 chars with overlap) and embedded with the Azure
   embedding deployment; vectors land in `guideline_chunks.embedding`
   (`pgvector`, cosine).
2. **Retrieve**: every AI call embeds its query (brief, field text, or content
   being audited) and pulls top-k chunks scoped by tenant → space → content type.
3. **Prompt**: `app/ai/prompts.py` injects retrieved guidelines as an
   authoritative context block plus the content type schema (with per-field
   `ai_hint`s and validation constraints).
4. **Call**: `app/ai/client.py` is the only file that talks to the provider —
   swap Azure SDK for LiteLLM/OpenAI/Bedrock by editing `chat()` and `embed()`.

## Extension guide

- **New field type**: add to `FieldType` (backend `schemas/content.py` + editor
  `lib/types.ts`), render it in `DynamicEntryForm.tsx` and preview
  `EntryRenderer.tsx`. Validation goes in `api/entries.py::validate_fields`.
- **Real migrations**: replace `init_db()` create_all with Alembic
  (`alembic init`, autogenerate from `app.models.Base`).
- **Scale WebSockets**: back `core/ws_manager.py` with Redis pub/sub.
- **Preview security**: replace the shared `PREVIEW_SECRET` with short-lived
  tokens minted by the backend per editor session (`delivery.py` + `LivePreviewPane`).
- **Real-time collaboration**: the editor intentionally does not merge remote
  field values into a focused form (last-write-wins per field). For multi-user
  editing, layer Yjs/CRDT on top of the existing WS channel.
- **PDF/DOCX guidelines**: extend `ai/ingestion.py::extract_text` (pypdf,
  python-docx).
- **Roles**: guard routes with `Depends(require_permission("entries:publish"))`
  from `api/deps.py`; seeded roles are `admin` (`*`) and `editor`.
- **HTML sanitization**: rich text is trusted (TipTap + prompt contract). If
  untrusted authors exist, sanitize on write (bleach) or render-time (DOMPurify).

## Running without Docker

```bash
# Postgres with pgvector on :5432 (e.g. docker run pgvector/pgvector:pg16)
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
cd editor && npm install && npm run dev
cd preview && npm install && npm run dev
```

Set `DATABASE_URL`, and for the frontends `NEXT_PUBLIC_API_URL=http://localhost:8000`,
`CMS_API_URL=http://localhost:8000`, `NEXT_PUBLIC_PREVIEW_URL=http://localhost:3001`.
