# Deploying Ondros CMS on free tiers (educational / hobby use)

This guide (spec 014) walks through a **zero-cost** hosted deployment for
learning, demos, and student projects. Free tiers come with real limitations —
see [§ Free-tier limitations](#free-tier-limitations) — so treat this as a
playground path, **not production hosting**.

Prefer no cloud accounts at all? Jump to
[§ Fully local with docker-compose](#fully-local-with-docker-compose).

## The stack at a glance

| Piece | This repo | Free-tier home | Why |
|---|---|---|---|
| Backend API | `backend/` (FastAPI) | [Render.com](https://render.com) free web service or [Railway](https://railway.app) trial | Native Python, easy env vars. Free instances **sleep after idle** (cold starts of 30s+). |
| Database | Postgres + pgvector | [Neon.tech](https://neon.tech) or [Supabase](https://supabase.com) free tier | Both support `CREATE EXTENSION vector`, needed for AI guideline embeddings. |
| Editor app | `editor/` (Next.js) | [Vercel](https://vercel.com) free tier | First-class Next.js, auto CI/CD from GitHub. |
| Marketing site | `marketing/` (Next.js) | Vercel (second project) | Same. |
| Superadmin app | `superadmin/` (Next.js) | Vercel (third project, optional) | Same. |
| Preview site | `preview/` (Next.js) | Vercel (optional) | Demo frontend; your real site usually replaces it. |
| Media storage | local disk (`/files`) by default | Cloudflare R2 or Supabase Storage free tier | Render's free disk is **ephemeral** — uploads vanish on redeploy. Swap the save/delete/variant helpers in `backend/app/api/media.py` for object storage (S3-compatible: R2 works with any S3 SDK), or accept media loss on restarts for demos. |
| Webhook dispatch | in-process async | nothing extra needed | Dispatch runs inside the API process. For scheduled jobs later, Vercel Cron or a Render background worker (paid) are the upgrade path. |
| AI provider | multi-provider | Groq / Gemini free tiers, or none | Leave `AI_PROVIDER` empty to run without AI (endpoints return 503, everything else works). |

## Step-by-step

### 1. Fork and clone

Fork the repo on GitHub (Vercel/Render deploy straight from your fork), then
`git clone` your fork locally.

### 2. Provision Postgres (Neon or Supabase)

1. Create a free project; pick a region near your backend region.
2. Enable pgvector — Neon: `CREATE EXTENSION IF NOT EXISTS vector;` in the SQL
   editor; Supabase: Dashboard → Database → Extensions → enable `vector`.
3. Copy the connection string and convert it for asyncpg:
   `postgresql+asyncpg://USER:PASSWORD@HOST/dbname` (drop any `?sslmode=…`
   query param; asyncpg negotiates TLS automatically on these hosts).

### 3. Deploy the backend (Render)

This is a monorepo — every app (`backend/`, `editor/`, `marketing/`, …) has
its **own** Dockerfile in its own folder, and there is no Dockerfile at the
repo root. If Render's build log says
`failed to solve: failed to read dockerfile: open Dockerfile: no such file or directory`,
it built from the repo root instead of `backend/` — fix the **Root
Directory** (see below), don't touch the Dockerfile.

Two ways to deploy, pick one:

**A. Blueprint (recommended)** — Render → **New → Blueprint** → select your
fork. Render reads [`render.yaml`](render.yaml) at the repo root and creates
the service with the right `rootDir`/`dockerfilePath` automatically; you only
fill in the `sync: false` env vars it prompts for.

**B. Manual web service** — Render → **New → Web Service** → pick your fork,
then in the service's **Settings**:
- **Root Directory**: `backend` (this is what was missing — it's both the
  build context and where Render looks for `Dockerfile`)
- **Environment**: `Docker` (Dockerfile Path defaults to `Dockerfile`, now
  resolved relative to the root directory above) — or pick **Python 3** to
  skip Docker entirely: Build command `pip install -r requirements.txt`,
  Start command `uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

Either path works; the Dockerfile's `CMD` already reads `$PORT` (falling back
to 8000 for local `docker run`), which Render's Docker environment requires.

Environment variables (see `.env.example` for the full annotated list):

| Var | Value |
|---|---|
| `DATABASE_URL` | the asyncpg URL from step 2 |
| `JWT_SECRET` | long random string (`openssl rand -hex 32`) |
| `BACKEND_URL` | `https://<your-api>.onrender.com` (OAuth redirect base) |
| `FRONTEND_URL` | `https://<your-editor>.vercel.app` |
| `CORS_ORIGINS` | `https://<editor>.vercel.app,https://<preview>.vercel.app,https://<superadmin>.vercel.app` |
| `AUTH_DEV_MODE` | `false` (**important** — dev mode leaks action tokens in responses) |
| `BILLING_DEV_MODE` | `true` (unless you wire real Stripe keys) |
| `SMTP_HOST/PORT/USER/PASSWORD/SMTP_FROM` | optional; without SMTP, verification emails are only logged — for demos consider a free [Resend](https://resend.com)/[Brevo](https://brevo.com) SMTP account |
| `AI_PROVIDER` / `AI_API_KEY` | optional — `groq` (console.groq.com) or `gemini` (aistudio.google.com) free keys; set `EMBEDDING_DIM=768` for Gemini **before first ingest** |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` | from step 5 (optional) |

The app runs boot-time dev migrations automatically; step 6 shows the explicit
Alembic path.

### 4. Deploy the frontends (Vercel)

Create one Vercel project per app, each pointing at your fork with the
**Root Directory** set to the app folder:

**editor/**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_PREVIEW_URL` | preview site URL (optional) |
| `NEXT_PUBLIC_PREVIEW_TOKEN` | a `cms_pre_…` key you create in the UI later |

**marketing/**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_LOGIN_URL` | `https://<editor>.vercel.app/login` |
| `NEXT_PUBLIC_APP_SIGNUP_URL` | `https://<editor>.vercel.app/signup` |

**superadmin/** (optional)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://<your-api>.onrender.com` |
| `NEXT_PUBLIC_EDITOR_URL` | `https://<editor>.vercel.app` |

**preview/** (optional): `CMS_API_URL`, `NEXT_PUBLIC_API_URL`,
`CMS_DELIVERY_TOKEN`, `CMS_PREVIEW_TOKEN`.

> This stack does not use NextAuth — OAuth is handled by the FastAPI backend
> (spec 012), so no `NEXTAUTH_URL`/`NEXTAUTH_SECRET` are needed.

### 5. Register OAuth apps (optional, for social login)

- **Google** — [console.cloud.google.com](https://console.cloud.google.com) →
  APIs & Services → Credentials → OAuth client (Web). Authorized redirect URI:
  `https://<your-api>.onrender.com/sso/google/callback`
- **GitHub** — Settings → Developer settings → OAuth Apps → New. Authorization
  callback URL: `https://<your-api>.onrender.com/sso/github/callback`

Put the client ids/secrets in the backend env (step 3). For local dev register
a second app with `http://localhost:8000/sso/<provider>/callback`. The
redirect base always follows `BACKEND_URL`, so each environment just needs its
own value.

### 6. Run migrations against hosted Postgres

From your machine (or a Render shell):

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="postgresql+asyncpg://USER:PASSWORD@HOST/dbname" alembic upgrade head
```

This applies `0001_saas_upgrade` + `0002_platform_admin` (idempotent — safe on
a database the app already booted against).

### 7. Seed demo data (optional)

```bash
DATABASE_URL="postgresql+asyncpg://…" python -m app.seed
```

Creates the demo space/content model plus logins `admin@example.com/admin123`,
`editor@example.com/editor123`, and `superadmin@example.com/super123`
(platform admin). **Skip the seed for anything public**, or change these
passwords immediately — and rotate the seeded `cms_del_/cms_pre_` dev tokens.

### 8. Verify end to end

1. Open the marketing site → click **Login** → lands on the editor login.
2. Sign in (OAuth or email) → onboarding wizard → create a space.
3. Create a content type + entry → publish.
4. Settings → API keys → create a delivery key, then:
   ```bash
   curl "https://<your-api>.onrender.com/spaces/<spaceId>/environments/master/delivery/entries?content_type=<type>" \
     -H "Authorization: Bearer cms_del_..."
   ```
5. (Optional) open the superadmin app → log in with the platform admin →
   check the Overview/Health pages.

## Free-tier limitations

- **Cold starts / sleep**: Render free services sleep after ~15 min idle; the
  first request then takes 30–60 s. Webhooks and background counters don't run
  while asleep.
- **Database caps**: Neon free ≈ 0.5 GB storage with autosuspend; Supabase
  free pauses projects after a week of inactivity. pgvector works but large
  guideline corpora will hit storage limits quickly.
- **Ephemeral disk**: uploaded media on Render's free tier disappears on every
  deploy/restart unless you switch to object storage.
- **Connection limits**: free Postgres tiers allow few concurrent
  connections; keep one backend instance.
- **No SLA**: all of these tiers are best-effort — fine for coursework and
  demos, wrong for anything users depend on.

## Fully local with docker-compose

Zero cloud accounts, zero cost, everything on your machine:

```bash
cp .env.example .env             # optionally set AI_PROVIDER=ollama for local AI
docker compose up --build -d     # db + backend + editor + preview + marketing + superadmin
docker compose exec backend python -m app.seed
```

| Service | URL |
|---|---|
| Editor | http://localhost:3000 |
| Preview site | http://localhost:3001 |
| Marketing + docs | http://localhost:3002 |
| Superadmin | http://localhost:3003 |
| API / Swagger | http://localhost:8000/docs |

For free local AI, install [Ollama](https://ollama.com), run
`ollama pull llama3.1 && ollama pull nomic-embed-text`, and set
`AI_PROVIDER=ollama` + `EMBEDDING_DIM=768` in `.env`.
