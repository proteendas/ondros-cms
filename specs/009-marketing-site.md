# 009 — Marketing / Brand Website (Ondros CMS)

## Current state (before this spec)

- No public-facing site. The repo ships three apps: `editor` (authenticated
  product), `preview` (demo customer site), `backend`.

## Requirements

- New decoupled Next.js app **`marketing/`** (port 3002, own Dockerfile +
  compose service) — never shares auth state with the editor.
- Pages:
  - **/** Landing — hero (logo, tagline, "Get Started" + "Login" CTAs),
    feature highlights (modeling, live preview/inline editing, AI/RAG,
    spaces/environments, localization, webhooks, SDK), 4-step "How it works".
  - **/features** — detailed capability breakdown with Bootstrap Icons.
  - **/pricing** — Free/Pro/Enterprise tiers, feature comparison table
    (spaces, environments, API calls, seats, AI credits, support), per-tier
    CTAs ("Start Free" → app signup, "Talk to Sales" → support), billing FAQ.
  - **/support** — docs link (placeholder), support email, community links
    (placeholder), status page link (placeholder), contact form (mailto MVP).
- Site-wide top nav (logo, Features/Pricing/Support, prominent **Login**) and
  footer (Features/Pricing/Support/Docs/Login, social placeholders, ©Ondros CMS).
- **Login integration**: every Login/Get Started CTA points at the
  authenticated app via `NEXT_PUBLIC_APP_LOGIN_URL` (default
  `http://localhost:3000/login`; signup CTAs use `NEXT_PUBLIC_APP_SIGNUP_URL`
  default `http://localhost:3000/signup`). No duplicate login form.
- Styling: same design tokens as the editor (indigo primary, slate chrome,
  same font stack), Bootstrap Icons, fully responsive (grid collapses on
  mobile, nav wraps).

## Decisions

- Pricing page copy mirrors the seeded billing plans (spec 005) but is
  marketing copy — the product's live limits stay the source of truth in
  `/billing/plans`.
- Static-only (no backend calls) so it can deploy to any static/edge host.

## Acceptance criteria

- [x] All four pages render (smoke: HTTP 200 on /, /features, /pricing, /support)
- [x] Login/Get Started CTAs resolve from `NEXT_PUBLIC_APP_LOGIN_URL` /
      `NEXT_PUBLIC_APP_SIGNUP_URL`
- [x] `tsc --noEmit` clean; responsive layout via CSS grid/flex + media queries
- [x] Compose service `marketing` on :3002

## Tasks

- [x] App scaffold (package.json, tsconfig, next config, Dockerfile)
- [x] Layout (nav/footer) + design tokens + branding assets
- [x] Landing / Features / Pricing / Support pages
- [x] Env-based CTA URLs + compose wiring
- [ ] Real docs/community/status destinations (placeholders today)
