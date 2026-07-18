# 014 — Free-Tier Deployment Guide (DEPLOYMENT.md)

## Current state

README documents local docker-compose only; "Production notes" is a short
bullet list. No hosted-deployment path exists for students/hobbyists.

## Requirements

`DEPLOYMENT.md` at the repo root covering an end-to-end **zero-cost**
educational deployment plus the fully-local alternative:

1. **Recommended free-tier stack** with the trade-offs stated:
   Vercel (editor + marketing + superadmin), Render/Railway free web service
   (FastAPI; cold-start/sleep caveats), Neon/Supabase Postgres (pgvector),
   Cloudflare R2 / Supabase Storage for media (with the note that the repo
   currently writes to local disk and where to swap the helpers), free-tier
   background/cron options for webhook retries.
2. **Step-by-step**: fork → provision Postgres (enable pgvector) → deploy
   backend (full env-var table) → deploy frontends (env-var table per app) →
   register Google/GitHub OAuth apps with per-environment redirect URIs →
   run Alembic migrations against hosted Postgres → seed → verify checklist
   (marketing → login → OAuth → create content → preview → SDK fetch).
3. **Free-tier limitations** section: cold starts, sleep-after-idle, storage
   caps, connection limits, pgvector row limits — explicitly "for learning
   and demos, not production load".
4. **Local zero-cloud path**: the existing docker-compose flow (+ Ollama for
   free local AI) restated as the alternative.
5. README links to DEPLOYMENT.md.

## Acceptance criteria

- [x] Every env var named in DEPLOYMENT.md exists in `app/config.py` or the
      Next apps' code (no invented vars).
- [x] Commands are copy-paste runnable (alembic, seed, curl verify).
- [x] Covers all five services (backend, editor, preview, marketing,
      superadmin) + db + media.

## Tasks

- [x] Write DEPLOYMENT.md (stack table, 8 steps, limitations, local path).
- [x] Link from README.
