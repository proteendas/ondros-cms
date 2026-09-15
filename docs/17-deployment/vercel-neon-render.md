# Deployment option: Vercel + Neon + Render (free tier)

> One specific path through [the free-tier guide](free-tier.md). That guide is the
> general free-tier reference and covers the alternatives (Railway instead of
> Render, Supabase instead of Neon, fully-local docker-compose). **This page
> commits to one combination and walks it end to end**, with the exact values,
> ordering and failure modes — read it if you've already decided on Vercel +
> Neon + Render and just want to follow steps.

A complete, zero-cost hosted deployment — **no EC2, no credit card, no Docker
host to babysit**. Follow the steps in order; the whole thing takes about
45 minutes, most of it waiting on builds.

| Piece | Goes to | Free tier reality |
|---|---|---|
| `backend/` — FastAPI (management + delivery APIs, AI, webhooks, WebSockets) | **Render** web service (Docker) | Sleeps after ~15 min idle; first request after sleep takes 30–60 s |
| Postgres + pgvector | **Neon** | ~0.5 GB storage, autosuspends when idle |
| `editor/` — Next.js visual editor | **Vercel** project #1 | Full Next.js support, auto-deploys on push |
| `preview/` — Next.js demo site | **Vercel** project #2 (optional) | Your real site usually replaces this |
| `superadmin/` — Next.js operator dashboard | **Vercel** project #3 (optional) | |
| Uploaded media | Render's disk by default | **Ephemeral** — wiped on every deploy. See [§ Media storage](#media-storage-the-one-real-gap) |

> Prefer alternatives? Supabase swaps in for Neon (enable the `vector`
> extension in Database → Extensions) and Railway for Render (same Docker
> build, same env vars) — see [the free-tier guide](free-tier.md). Everything below
> still applies.

> The public marketing site (`ondros-cms-site`) is a **separate repo** with its
> own Vercel project. It makes no backend calls, so it never appears in
> `CORS_ORIGINS`. Its only link to this stack is the two CTA URLs in step 6.

---

## The ordering problem (read this first)

The backend needs to know the frontend URLs (`CORS_ORIGINS`, `FRONTEND_URL`),
and the frontends need to know the backend URL (`NEXT_PUBLIC_API_URL`). You
can't set both before either exists, so the sequence below deliberately does a
**second pass**:

```
1. Neon        → get DATABASE_URL
2. Render      → deploy backend with placeholder frontend URLs → get API URL
3. Vercel      → deploy frontends using the real API URL       → get app URLs
4. Render      → go back and set the real CORS_ORIGINS/FRONTEND_URL
```

Skipping step 4 is the single most common cause of "it deployed but login does
nothing" — the browser blocks the cross-origin call and the editor shows a
network error with no server-side trace.

---

## Where each variable goes

The single most common confusion. There are four separate places configuration
lives, and they do **not** share values:

```mermaid
flowchart TD
    NEON[("Neon<br/>Postgres")]
    RENDER["Render service<br/><i>backend/</i>"]
    VERCEL["Vercel projects<br/><i>editor / preview / superadmin</i>"]
    LOCAL["Your laptop<br/><i>.env + docker-compose</i>"]

    NEON -->|"connection string, pasted<br/>as DATABASE_URL"| RENDER
    RENDER -->|"its public URL, pasted<br/>as NEXT_PUBLIC_API_URL"| VERCEL
    VERCEL -->|"their URLs, pasted<br/>as CORS_ORIGINS"| RENDER

    style NEON fill:#00e599,color:#000
    style RENDER fill:#4f46e5,color:#fff
    style VERCEL fill:#000,color:#fff
```

| Variable | Where you set it | Never set it here |
|---|---|---|
| `DATABASE_URL` | **Render** → your service → Environment | Vercel — the frontends never connect to Postgres. Putting a DB URL in a Vercel project (especially a `NEXT_PUBLIC_*` one) would publish your credentials in the browser bundle. |
| `JWT_SECRET`, `AI_API_KEY`, `SMTP_*`, OAuth secrets | **Render** | Vercel, and never committed to git |
| `CORS_ORIGINS`, `FRONTEND_URL`, `BACKEND_URL` | **Render** | — |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_*` | **Vercel** (per project) | Render. These are inlined into the browser bundle, so they must never hold a secret. |
| `CMS_API_URL`, `CMS_DELIVERY_TOKEN`, `CMS_PREVIEW_TOKEN` | **Vercel** (preview project) | These are server-side only — note the deliberate absence of `NEXT_PUBLIC_` |

### Setting `DATABASE_URL` on Render, step by step

1. Neon dashboard → your project → **Connection string** → copy it.
2. Convert it (see [step 2](#2-create-the-database-neon)): `postgresql://` →
   `postgresql+asyncpg://`, and delete the `?sslmode=…&channel_binding=…` tail.
3. Render dashboard → your web service → **Environment** → **Add Environment
   Variable**.
   - Key: `DATABASE_URL`
   - Value: the converted string
4. **Save Changes.** Render redeploys automatically. Watch the log for
   `Application startup complete` — that means it connected, created the
   pgvector extension and the tables.

If you deployed via the Blueprint, Render will have prompted you for
`DATABASE_URL` during creation (it's marked `sync: false` in
[`render.yaml`](../../render.yaml), which means "ask, don't store in git").

### Running the seed or migrations against Neon

These run from **your laptop**, not from Render, so pass the URL inline — don't
put it in a file:

```bash
cd backend
pip install -r requirements.txt

# Point at Neon just for this one command:
DATABASE_URL="postgresql+asyncpg://user:pass@ep-xxx.neon.tech/neondb" python -m app.seed
DATABASE_URL="postgresql+asyncpg://user:pass@ep-xxx.neon.tech/neondb" alembic upgrade head
```

### Pointing your *local* stack at Neon (and why `.env` won't do it)

`docker-compose.yml` **hardcodes** the local database:

```yaml
backend:
  environment:
    DATABASE_URL: postgresql+asyncpg://cms:cms@db:5432/cms   # wins over .env
```

A `DATABASE_URL` in your root `.env` is therefore **ignored** for the
containerised backend — the compose `environment:` value always wins. If you
genuinely want local containers talking to Neon, override it explicitly and
stop the local db:

```yaml
# docker-compose.override.yml  (git-ignored, picked up automatically)
services:
  backend:
    environment:
      DATABASE_URL: postgresql+asyncpg://user:pass@ep-xxx.neon.tech/neondb
```

Be aware this points local development at the same database your deployment
uses — a local `python -m app.seed` would then overwrite hosted data.

---

## 1. Fork the repo

Render and Vercel both deploy straight from GitHub, so fork this repo (or push
it to your own GitHub account) first. Every step below points at your fork.

## 2. Create the database (Neon)

1. Sign up at [neon.tech](https://neon.tech) → **New Project**. Pick a region
   physically close to the Render region you'll choose in step 3 — cross-region
   round trips dominate response time on free tiers.
2. Enable pgvector (needed for AI guideline embeddings). In Neon's **SQL
   Editor**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
   The app also runs this itself at boot, but doing it now surfaces permission
   problems before they look like backend crashes.
3. Copy the connection string and **convert it for asyncpg**. Neon hands you
   something like:
   ```
   postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```
   You need:
   ```
   postgresql+asyncpg://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb
   ```
   Two edits, both mandatory:
   - scheme `postgresql://` → **`postgresql+asyncpg://`**
   - **delete the entire `?…` query string**

   > **Why the query string must go:** asyncpg doesn't accept libpq's
   > `sslmode`/`channel_binding` parameters and passes them through as unknown
   > keyword arguments. Leaving them on produces
   > `TypeError: connect() got an unexpected keyword argument 'sslmode'` at
   > startup — the backend boot-loops with no other explanation. TLS still
   > happens; asyncpg negotiates it automatically against Neon.

4. **Use the direct (unpooled) endpoint**, not the `-pooler` one. Neon's pooler
   runs PgBouncer in transaction mode, which breaks the prepared statements
   SQLAlchemy's asyncpg driver relies on. You're running a single free Render
   instance, so you don't need the pooler anyway.

## 3. Deploy the backend (Render)

This is a monorepo: each app has its **own** Dockerfile in its own folder and
there is **no Dockerfile at the repo root**. If a build fails with
`failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory`,
Render built from the repo root — fix the Root Directory, don't add a
Dockerfile.

**Option A — Blueprint (recommended).** Render → **New → Blueprint** → pick
your fork. Render reads [`render.yaml`](../../render.yaml) and creates the service
with the correct `rootDir: backend` automatically, prompting only for the
secrets marked `sync: false`.

**Option B — Manual web service.** Render → **New → Web Service** → pick your
fork, then set:

- **Root Directory**: `backend` ← both the build context and where Render looks for `Dockerfile`
- **Runtime**: `Docker`
- **Instance type**: `Free`
- **Health Check Path**: `/health`

The Dockerfile's `CMD` already binds `${PORT:-8000}`, which Render's Docker
runtime requires.

### Backend environment variables

| Var | Value | Notes |
|---|---|---|
| `DATABASE_URL` | the converted asyncpg URL from step 2 | |
| `JWT_SECRET` | `openssl rand -hex 32` | Never reuse the dev default |
| `BACKEND_URL` | `https://<your-api>.onrender.com` | Fill in after the first deploy names the service |
| `FRONTEND_URL` | `https://<editor>.vercel.app` | Placeholder now, real value in step 5 |
| `CORS_ORIGINS` | `https://<editor>.vercel.app` | Comma-separated, **no trailing slashes**, real value in step 5 |
| `AUTH_DEV_MODE` | `false` | **Important** — `true` returns verification/reset tokens in API responses, letting anyone verify any address |
| `BILLING_DEV_MODE` | `true` | Allows plan switching without Stripe keys |
| `AI_PROVIDER` | empty, or `groq` / `gemini` | Empty = AI endpoints return 503, everything else works |
| `AI_API_KEY` | provider key | [console.groq.com](https://console.groq.com) or [aistudio.google.com](https://aistudio.google.com/apikey) |
| `EMBEDDING_DIM` | `768` **only** for Gemini/Ollama | Must be set **before the first guideline ingest** — the vector column is sized once |

`.env.example` documents every remaining option.

The first boot creates the pgvector extension, all tables, and applies the
in-place dev migrations automatically, so the service is usable immediately.
For a stricter setup, see [§ Alembic](#optional-run-alembic-instead-of-boot-time-create_all).

### Email deliverability (don't skip this)

With `AUTH_DEV_MODE=false` and **no SMTP configured**, `send_email()` logs the
message instead of sending it (`backend/app/core/mailer.py`). Signup still
works, but the verification link only ever appears in your **Render logs** —
real users will sit on an unverified account forever.

Pick one:

- **Demo / coursework**: fine as-is. Grab verification links from Render's log
  stream, or seed the demo accounts (step 7) and log in with those.
- **Anything with real users**: add free SMTP — [Resend](https://resend.com) or
  [Brevo](https://brevo.com) — and set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`,
  `SMTP_PASSWORD`, `SMTP_FROM`.

## 4. Deploy the frontends (Vercel)

Create **one Vercel project per app**, each pointing at the same fork with a
different **Root Directory**. Vercel detects Next.js automatically; leave the
build/output settings alone.

**Project 1 — `editor/`** (the main app)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_PREVIEW_URL` | `https://<preview>.vercel.app` (optional) |
| `NEXT_PUBLIC_PREVIEW_TOKEN` | a `cms_pre_…` key you create in the UI later (optional) |

**Project 2 — `preview/`** (optional demo site)

| Var | Value |
|---|---|
| `CMS_API_URL` | `https://<your-api>.onrender.com` (server-side fetches) |
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` (browser WS + media) |
| `CMS_DELIVERY_TOKEN` | a `cms_del_…` key from the editor UI |
| `CMS_PREVIEW_TOKEN` | a `cms_pre_…` key from the editor UI |

**Project 3 — `superadmin/`** (optional operator dashboard)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_EDITOR_URL` | `https://<editor>.vercel.app` |

> **`NEXT_PUBLIC_*` values are inlined into the client bundle at build time.**
> Changing one in the Vercel dashboard does nothing until you **redeploy** that
> project. This trips people up constantly — if the editor still calls
> `localhost:8000` after you fixed the variable, you haven't rebuilt.

> This stack does **not** use NextAuth — OAuth is handled entirely by the
> FastAPI backend, so there's no `NEXTAUTH_URL`/`NEXTAUTH_SECRET` to set.

## 5. Second pass: wire the real URLs into Render

Now that Vercel has assigned real domains, go back to the Render service and
update:

```
BACKEND_URL   = https://<your-api>.onrender.com
FRONTEND_URL  = https://<editor>.vercel.app
CORS_ORIGINS  = https://<editor>.vercel.app,https://<preview>.vercel.app,https://<superadmin>.vercel.app
```

Include **only** the apps you actually deployed. No trailing slashes, no
spaces. Save — Render restarts the service automatically.

> Vercel also generates a unique preview URL per deployment. Those are *not*
> in `CORS_ORIGINS`, so preview deployments can't reach the API. Test against
> the production domain, or add the specific preview URL when you need it.

## 6. Point the marketing site at your editor (optional)

In the **`ondros-cms-site`** repo's own Vercel project:

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_LOGIN_URL` | `https://<editor>.vercel.app/login` |
| `NEXT_PUBLIC_APP_SIGNUP_URL` | `https://<editor>.vercel.app/signup` |

Redeploy that project afterwards (same build-time inlining rule).

## 7. Seed demo data (optional)

Creates the demo space, content model, locales, and logins. Run it from your
machine against the hosted database:

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="postgresql+asyncpg://…neon.tech/neondb" python -m app.seed
```

This creates `admin@example.com/admin123`, `editor@example.com/editor123`, and
`superadmin@example.com/super123`, plus two well-known API tokens.

> **Skip the seed for anything public** — or change every password immediately
> and rotate the seeded `cms_del_`/`cms_pre_` tokens in Settings → API keys.
> These credentials are published in this repo's README.

## 8. Register OAuth apps (optional)

For the "Continue with Google/GitHub/Microsoft" buttons:

- **Google** — [console.cloud.google.com](https://console.cloud.google.com) →
  APIs & Services → Credentials → OAuth client (Web).
  Redirect URI: `https://<your-api>.onrender.com/sso/google/callback`
- **GitHub** — Settings → Developer settings → OAuth Apps → New.
  Callback URL: `https://<your-api>.onrender.com/sso/github/callback`

Put the client IDs/secrets in the Render env. The redirect base always follows
`BACKEND_URL`, so each environment needs only its own value. For local dev,
register a second app against `http://localhost:8000/sso/<provider>/callback`.

## 9. Verify end to end

```bash
# 1. Backend is awake (first call may take 60s — that's the free tier waking up)
curl https://<your-api>.onrender.com/health
# → {"status":"ok"}
```

2. Open `https://<editor>.vercel.app` → sign in → onboarding wizard → create a
   space.
3. Create a content type, add an entry, hit **Publish**.
4. Settings → API keys → create a **delivery** key, then:
   ```bash
   curl "https://<your-api>.onrender.com/spaces/<spaceId>/environments/master/delivery/entries?content_type=<type>" \
     -H "Authorization: Bearer cms_del_..."
   ```
5. Open your browser devtools Network tab during login. A CORS error here means
   step 5 is wrong — check for trailing slashes.

---

## Free-tier limitations

- **Cold starts.** Render free services sleep after ~15 min idle; the next
  request takes 30–60 s. Webhook dispatch and usage counters don't run while
  asleep. An uptime pinger against `/health` keeps it warm but burns your
  monthly free instance hours — Render's free tier is capped, so a 24/7 ping
  will exhaust it. Pinging during waking hours only is the usual compromise.
- **Database autosuspend.** Neon suspends idle projects; the first query after
  suspension pays a wake-up penalty on top of Render's cold start.
- **Connection limits.** Keep exactly one backend instance. Don't scale the
  Render service, and don't run the seed script against production while the
  service is under load.
- **WebSockets are in-memory.** `ws_manager.py` holds live-preview rooms in
  process, which is correct for one instance and breaks silently across
  replicas. Another reason not to scale out.
- **No SLA.** Fine for coursework, demos and portfolios. Wrong for anything
  people depend on.

## Media storage: the one real gap

Uploads go to local disk (`/files`) by default, and **Render's free tier disk
is ephemeral** — every deploy and every restart wipes it. Entries keep their
media references, so you get broken images rather than a clean failure.

Options:

- **Demo**: accept it, re-upload after deploys.
- **Durable**: swap the save/delete/variant helpers in
  `backend/app/api/media.py` for object storage. Cloudflare R2 is S3-compatible
  and has a free tier that works with any S3 SDK; Supabase Storage also works.

This is the one part of the free-tier path that needs code, not config.

## Optional: run Alembic instead of boot-time `create_all`

The app calls `init_db()` at startup, which creates the extension, tables and
in-place dev migrations — convenient, but not how you want production schema
changes to work. To use the real migrations instead:

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="postgresql+asyncpg://…" alembic upgrade head
```

This applies `0001_saas_upgrade` and `0002_platform_admin`, and is idempotent —
safe on a database the app has already booted against.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Backend boot-loops, logs show `connect() got an unexpected keyword argument 'sslmode'` | The `?sslmode=…` query string is still on `DATABASE_URL` (step 2) |
| `failed to read dockerfile: open Dockerfile: no such file or directory` | Render's Root Directory isn't `backend` (step 3) |
| Login does nothing; devtools shows a CORS error | `CORS_ORIGINS` missing the editor's exact origin, or has a trailing slash (step 5) |
| Editor still calls `localhost:8000` | `NEXT_PUBLIC_API_URL` changed but the Vercel project wasn't redeployed (step 4) |
| First request hangs ~60 s, then works | Normal free-tier cold start |
| Signup succeeds but no verification email | No SMTP configured — the link is in Render's logs (step 3) |
| `prepared statement "__asyncpg_…" does not exist` | You used Neon's `-pooler` endpoint; switch to the direct one (step 2) |
| Images 404 after a deploy | Ephemeral disk — see [§ Media storage](#media-storage-the-one-real-gap) |

---

## Appendix: fully local with docker-compose

Zero cloud accounts, everything on your machine:

```bash
cp .env.example .env             # optionally set AI_PROVIDER=ollama for local AI
docker compose up --build -d     # db + backend + editor + preview + superadmin
docker compose exec backend python -m app.seed
```

| Service | URL |
|---|---|
| Editor | http://localhost:3000 |
| Preview site | http://localhost:3001 |
| Superadmin | http://localhost:3003 |
| API / Swagger | http://localhost:8000/docs |

Logins: `admin@example.com/admin123` (org admin),
`editor@example.com/editor123` (space editor),
`superadmin@example.com/super123` (platform admin).

For free local AI, install [Ollama](https://ollama.com), run
`ollama pull llama3.1 && ollama pull nomic-embed-text`, then set
`AI_PROVIDER=ollama` and `EMBEDDING_DIM=768` in `.env`.
