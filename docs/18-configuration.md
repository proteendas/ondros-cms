# Configuration

Every environment variable, where it belongs, and the ones that bite.

Backend settings are typed in `backend/app/config.py` (pydantic-settings);
frontend values are `NEXT_PUBLIC_*` variables inlined at build time.

## Where values live

Four separate places that do **not** share values:

```mermaid
flowchart TD
    ENV[".env at the repo root"] -->|"${VAR} interpolation only"| DC["docker-compose.yml"]
    DC -->|"environment:"| BE["backend container"]
    DC -->|"environment:"| FE["frontend containers"]
    HOST["Your host's dashboard<br/><i>Render / Vercel</i>"] --> PROD["deployed services"]
    style ENV fill:#4f46e5,color:#fff
```

**The root `.env` is not injected into containers.** Compose uses it only for
`${VAR}` interpolation into the `environment:` blocks it declares. A variable
compose doesn't list is silently ignored — set it in `.env` and nothing happens.

Two consequences worth internalising:

- Adding a new backend setting means adding it to **both** `.env.example` and
  `docker-compose.yml`.
- `DATABASE_URL` is **hardcoded** in `docker-compose.yml` for the bundled
  Postgres, so an `.env` value cannot override it. Use a
  `docker-compose.override.yml` if you need to point local containers
  elsewhere.

## Backend

### Core

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://cms:cms@localhost:5432/cms` | Must use the `+asyncpg` scheme |
| `JWT_SECRET` | `dev-jwt-secret-change-me` | **Rotate for any deployment.** `openssl rand -hex 32` |
| `JWT_ALGORITHM` | `HS256` | |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `60` | Short-lived; revocation happens at refresh |
| `REFRESH_TOKEN_EXPIRE_DAYS` | `30` | |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Comma-separated, exact origins, **no trailing slashes** |
| `BACKEND_URL` | `http://localhost:8000` | OAuth redirect base |
| `FRONTEND_URL` | `http://localhost:3000` | Links in emails |
| `MEDIA_ROOT` | `media` | Upload directory |
| `LOG_LEVEL` | `INFO` | |

### Dev-mode switches — turn these off

| Variable | Default | Why it matters |
|---|---|---|
| `AUTH_DEV_MODE` | `true` | Returns verification and reset tokens **in API responses**, letting anyone verify any address. Set `false` outside local dev |
| `BILLING_DEV_MODE` | `true` | Enables `POST /billing/dev-activate` — any user with `manage_settings` can grant themselves the Pro plan |

Both default to `true` for a frictionless first run. Both are dangerous in
anything reachable from the internet.

### Email

Verification, password reset and invitations. Four transports:

| `MAIL_PROVIDER` | Transport | Notes |
|---|---|---|
| `resend` | HTTPS → `api.resend.com` | **Recommended.** Free tier, no SMTP ports |
| `brevo` | HTTPS → `api.brevo.com` | Free tier alternative |
| `smtp` | SMTP relay | Mailgun, SendGrid, Gmail, self-hosted |
| `log` | Writes to the server log | Local development |

Leave `MAIL_PROVIDER` empty to **auto-detect** in that order — set
`RESEND_API_KEY` and it just works.

| Variable | Default | Notes |
|---|---|---|
| `MAIL_PROVIDER` | `""` | Empty = auto-detect |
| `MAIL_FROM` | falls back to `SMTP_FROM` | e.g. `Ondros CMS <no-reply@you.com>` |
| `RESEND_API_KEY` | `""` | [resend.com/api-keys](https://resend.com/api-keys) |
| `BREVO_API_KEY` | `""` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` | `""` / `587` | Used when the provider resolves to `smtp` |

**The sender domain must be verified with your provider**, or sending fails with
a `403`. Resend's `onboarding@resend.dev` works immediately for testing.

**HTTP providers are preferred on PaaS hosts.** Several block or throttle
outbound SMTP, which fails in a way that looks like the application being
broken rather than the network refusing the connection.

**With no provider configured, mail is logged rather than sent.** Combined with
`AUTH_DEV_MODE=false`, verification links exist only in the server log — signup
appears to work while users never receive anything. The backend logs a warning
at startup when this is the case, and logs the resolved provider otherwise:

```
WARNING  Mail provider: none — verification and reset emails will only be
         written to this log. Set RESEND_API_KEY (or BREVO_API_KEY / SMTP_HOST).
INFO     Mail provider: resend (from: Ondros CMS <no-reply@you.com>)
```

Delivery failures never raise into the request path — an auth flow must not
fail because a mail relay hiccuped. They're logged with the provider's own
error text.

### OAuth & SSO

| Variable | Notes |
|---|---|
| `GOOGLE_CLIENT_ID` / `_SECRET` | Redirect URI `{BACKEND_URL}/sso/google/callback` |
| `GITHUB_CLIENT_ID` / `_SECRET` | `{BACKEND_URL}/sso/github/callback` |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | `{BACKEND_URL}/sso/microsoft/callback` |
| `MICROSOFT_TENANT` | `common` |

Per-account enterprise SSO is configured in the UI, not by env var.

### Code Sync (GitHub App)

Connects a space to the repository that renders its site, so previews show your
own pages and components. Full setup: [20-code-sync.md](20-code-sync.md).

| Variable | Notes |
|---|---|
| `GITHUB_APP_ID` | The App's numeric id |
| `GITHUB_APP_SLUG` | Used to build the install URL (default `ondros-code-sync`) |
| `GITHUB_APP_PRIVATE_KEY` | The PEM, with real or `\n`-escaped newlines, or base64 of it |
| `GITHUB_APP_WEBHOOK_SECRET` | Verifies `POST /code-sync/github/webhook`; unset means **every** webhook is rejected |
| `GITHUB_TOKEN` | Development fallback PAT, used only when no App is configured |
| `GITHUB_API_URL` | `https://api.github.com`; change for GitHub Enterprise |

These are separate from `GITHUB_CLIENT_ID`/`_SECRET` above, which are for
**login**. One authenticates people, the other reads repositories.

With none of them set, Code Sync reports `mode: none` and the editor says an
operator must register the App — deliberately a different message from "this
space hasn't connected a repository yet".

### Billing

| Variable | Notes |
|---|---|
| `STRIPE_SECRET_KEY` | Required when `BILLING_DEV_MODE=false` |
| `STRIPE_WEBHOOK_SECRET` | Verifies `POST /billing/webhook` |

### AI

| Variable | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `""` | `groq` · `gemini` · `ollama` · `openrouter` · `openai` · `azure_openai`. Empty = AI disabled |
| `AI_API_KEY` | `""` | Not needed for `ollama` |
| `AI_BASE_URL` | `""` | Override the provider's base URL |
| `AI_CHAT_MODEL` | `""` | Override the default model |
| `AI_EMBEDDING_MODEL` | `""` | `"none"` disables embeddings |
| `EMBEDDING_DIM` | `1536` | **Fixed at first ingest** — 768 for Gemini/Ollama |
| `AZURE_OPENAI_*` | | Only when `AI_PROVIDER=azure_openai` |

### Seeding

| Variable | Default |
|---|---|
| `SEED_DELIVERY_TOKEN` | `cms_del_dev-delivery-token-0000` |
| `SEED_PREVIEW_TOKEN` | `cms_pre_dev-preview-token-0000` |

Local convenience only. Never seed a public deployment.

## Frontend

`NEXT_PUBLIC_*` values are **inlined into the browser bundle at build time**.
Changing one in a dashboard does nothing until you rebuild or redeploy — this
is the single most common frontend deployment confusion.

Because they ship to the browser, a `NEXT_PUBLIC_*` variable must never hold a
secret.

### editor

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_API_URL` | Backend base URL |
| `NEXT_PUBLIC_PREVIEW_URL` | Preview site, for the split view |
| `NEXT_PUBLIC_PREVIEW_TOKEN` | A `cms_pre_…` key. **Dev convenience** — it ships to the browser; mint short-lived keys server-side for production |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Shown on `/support` |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | Shown on the legal pages |
| `NEXT_PUBLIC_SECURITY_EMAIL` | Responsible disclosure contact |
| `NEXT_PUBLIC_LEGAL_COMPANY` / `_ADDRESS` / `_JURISDICTION` | Legal entity details |

### preview

| Variable | Notes |
|---|---|
| `CMS_API_URL` | **Server-side** fetches — inside Docker this is `http://backend:8000` |
| `NEXT_PUBLIC_API_URL` | Browser-side WebSocket and media |
| `CMS_DELIVERY_TOKEN` | Published content |
| `CMS_PREVIEW_TOKEN` | Draft mode |

The two URLs differ on purpose: the container reaches the backend over the
Docker network, the browser over localhost.

### superadmin

| Variable |
|---|
| `NEXT_PUBLIC_API_URL` |
| `NEXT_PUBLIC_EDITOR_URL` |

## Migrations

`init_db()` runs at boot: `CREATE EXTENSION vector`, `create_all`, then the
idempotent in-place upgrades in `app/migrations.py`. Convenient on first run,
wrong for production — a schema change shouldn't ride along with a deploy.

The real path:

```bash
cd backend
pip install -r requirements.txt
DATABASE_URL="postgresql+asyncpg://…" alembic upgrade head
```

Applies `0001_saas_upgrade` and `0002_platform_admin`. Idempotent — safe on a
database the app has already booted against.

## Media storage

Uploads go to local disk (`MEDIA_ROOT`, served from `/files`). On any host with
an ephemeral filesystem — Render's free tier included — **every deploy wipes
them**, and entries keep their references, so you get broken images rather than
a clean failure.

For durability, replace the save/delete/variant helpers in
`backend/app/api/media.py` with object storage. Cloudflare R2 is S3-compatible
and has a free tier. This is the one part of the free-tier path that needs code
rather than configuration.

## Production checklist

- [ ] `JWT_SECRET` rotated to a real random value
- [ ] `AUTH_DEV_MODE=false`
- [ ] `BILLING_DEV_MODE=false` (or Stripe keys configured)
- [ ] `CORS_ORIGINS` restricted to your real origins, no trailing slashes
- [ ] A mail provider configured (`RESEND_API_KEY` is the quickest), or you accept that mail only reaches the log
- [ ] Seeded demo accounts and tokens removed or rotated
- [ ] Media on object storage if the filesystem is ephemeral
- [ ] Alembic run instead of relying on boot-time `create_all`
- [ ] One backend replica only, until the WebSocket manager is Redis-backed
- [ ] TLS everywhere

## Per-service `.env.example`

Each deployable ships its own annotated example, so Render and Vercel can pick
up the variables that service actually needs:

| File | Service | Host |
|---|---|---|
| [`backend/.env.example`](../backend/.env.example) | FastAPI API | Render |
| [`editor/.env.example`](../editor/.env.example) | Editor | Vercel |
| [`preview/.env.example`](../preview/.env.example) | Preview site | Vercel |
| [`superadmin/.env.example`](../superadmin/.env.example) | Operator portal | Vercel |
| [`.env.example`](../.env.example) | All five services via docker compose, plus the bundled Postgres | Local / single VM |

The database has no code deployable of its own: with compose it's configured by
the `POSTGRES_*` variables in the root file, and on a managed host (Neon,
Supabase) the provider hands you a connection string that goes into the
backend's `DATABASE_URL`.

## Where to go next

- Hosting → [17-deployment/](17-deployment/)
- Security model → [07-auth-and-permissions.md](07-auth-and-permissions.md)
- AI setup → [11-ai-features.md](11-ai-features.md)
