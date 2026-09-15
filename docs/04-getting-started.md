# Getting started

From a fresh clone to published content served over the API, in about ten
minutes. Most of that is the first Docker build.

## Prerequisites

- **Docker** with Compose v2 (`docker compose version`)
- Ports **3000, 3001, 3003, 8000, 5432** free

Nothing else — Python, Node and Postgres all run inside containers.

## 1. Start the stack

```bash
git clone <your-fork> ondros-cms
cd ondros-cms
cp .env.example .env
docker compose up --build -d
```

The first build takes a few minutes. Afterwards:

```bash
docker compose ps          # all five services should be "running"
curl localhost:8000/health # {"status":"ok"}
```

## 2. Seed the demo workspace

```bash
docker compose exec backend python -m app.seed
```

This creates a **Marketing Site** space with locales `en-US` and `fr`, a
`master` environment, an assembly-style content model (`landing_page` → `hero` +
`card[]`), localized entries, the five system roles, and two well-known dev API
tokens that the compose defaults already reference — so the preview site works
immediately.

| URL | What | Sign in with |
|---|---|---|
| http://localhost:3000 | **Editor** | `admin@example.com` / `admin123` (org admin)<br/>`editor@example.com` / `editor123` (space editor) |
| http://localhost:3001 | Preview site | — |
| http://localhost:3003 | Superadmin | `superadmin@example.com` / `super123` |
| http://localhost:8000/docs | Swagger UI | Use `/auth/token` to authorize |

> These credentials are published in this repo. They are for local use only —
> never seed a public deployment, or change every password immediately.

## 3. The five-minute tour

```mermaid
flowchart LR
    A["Content model<br/><i>define the shape</i>"] --> B["Content<br/><i>write an entry</i>"]
    B --> C["Publish<br/><i>freeze it</i>"]
    C --> D["Delivery API<br/><i>fetch the JSON</i>"]
    style C fill:#067647,color:#fff
```

**Content → welcome** is the best starting point. Type in the form and watch the
split-view preview update live with no save and no reload. Switch to the `fr`
locale tab. Click text in the preview to jump to the field that produced it,
then double-click to edit it inline — including inside nested hero and card
blocks.

**Content model** shows the other half: drag to reorder fields, add a
`reference_many` field, and see the sample form rebuild as you change the schema.

## 4. Create something yourself

1. **Content model → Add content type.** Name it `Article`, give it a `title`
   (text), `body` (rich text) and `slug` (slug).
2. **Content → New entry**, pick `Article`, fill it in, and hit **Publish**.
3. Fetch it. The space id is in the URL, or in the seed output:

```bash
SPACE=<your-space-id>
curl "http://localhost:8000/spaces/$SPACE/environments/master/delivery/entries?content_type=article" \
  -H "Authorization: Bearer cms_del_dev-delivery-token-0000"
```

You'll get `{ items, total, skip, limit, includes }`. Only published content
appears — swap in the `cms_pre_…` preview token to see drafts too. That
difference is the whole point of the two key types.

## 5. Resolve references

The seeded `landing_page` demonstrates assemblies — an entry referencing other
entries:

```bash
curl "http://localhost:8000/spaces/$SPACE/environments/master/delivery/entries?content_type=landing_page&include=2&locale=fr" \
  -H "Authorization: Bearer cms_del_dev-delivery-token-0000"
```

`include=2` resolves two levels of links into a flat `includes` map rather than
nesting them, so an entry referenced five times is serialized once. The
[SDK](14-sdk.md)'s `resolve()` walks that map for you.

## Everyday commands

```bash
docker compose logs -f backend          # follow the API log
docker compose restart editor           # after changing a dependency
docker compose exec backend python -m app.seed   # re-seed (idempotent)
docker compose exec editor npm run typecheck     # also: preview, superadmin
docker compose down                     # stop (keeps the database volume)
docker compose down -v                  # stop and DELETE all data
```

Both sides hot-reload: `backend/` and each app's `src/` are volume-mounted, so
edits apply without a rebuild. You only need `--build` when a dependency changes.

## Enabling AI (optional)

AI features return `503` until a provider is configured. The free options:

```bash
# .env — Groq is the fastest free tier (console.groq.com)
AI_PROVIDER=groq
AI_API_KEY=gsk_...
```

Then `docker compose up -d backend`. `GET /ai/status` reports the active mode.
Groq is chat-only, so guideline retrieval falls back to keyword search; Gemini
and Ollama support embeddings — set `EMBEDDING_DIM=768` **before your first
ingest**. See [11-ai-features.md](11-ai-features.md).

## Troubleshooting

| Symptom | Cause |
|---|---|
| A port is already allocated | Something else holds 3000/3001/3003/8000/5432. Free it, or change the host port in `docker-compose.yml` |
| Editor shows a network error on login | The backend isn't up yet, or `CORS_ORIGINS` doesn't include `http://localhost:3000` |
| `relation "…" does not exist` | The backend booted before Postgres was ready. `docker compose restart backend` |
| Preview shows no content | Nothing is published yet, or the seed hasn't run |
| A `.env` change did nothing | Only variables listed in `docker-compose.yml` are forwarded, and `NEXT_PUBLIC_*` values are inlined at **build** time — rebuild that app |
| AI buttons return 503 | No `AI_PROVIDER` set. That's the default |

## Where to go next

- What the concepts mean → [01-overview.md](01-overview.md)
- Modelling content properly → [08-content-modeling.md](08-content-modeling.md)
- The full API → [06-api/README.md](06-api/README.md)
- Hosting it → [17-deployment/](17-deployment/)
