# 011 — Documentation Section (/docs on the marketing site)

## Current state

No product documentation exists. The support page links "Documentation" to a
`#docs` placeholder; the features page has no deep links. The backend already
exports OpenAPI (`scripts/export_openapi.py`), and `sdk/README.md` documents
the SDK — but nothing is user-facing.

## Requirements

1. `/docs` on the marketing site (:3002) with a docs-style layout: left
   sidebar nav tree (grouped sections, active-page highlight), right content
   pane, in-page anchor TOC on wide screens; sidebar collapses behind a
   toggle on mobile.
2. Content pages (all MDX):
   - **Getting Started** — signup → verify → create space → content type →
     entry → publish → fetch via SDK, with copy-paste snippets.
   - **Core Concepts** — Organizations/Accounts, Spaces, Environments,
     Content Types & fields, Entries & workflow, Locales & fallbacks,
     API keys (delivery vs preview vs management).
   - **SDK Reference** — `createClient` options, `getEntries` / `getEntry` /
     `getEntryBySlug` / `getAsset(s)`, filters, link resolution, TypeScript
     types + `ondros-cli generate-types`.
   - **API Reference** — REST endpoints grouped Delivery / Preview /
     Management with curl examples + response shapes; auth headers per plane.
   - **AI Features** — generate, rewrite/shorten/expand, SEO meta, title
     suggestions, compliance check, translate: endpoint, params, behavior.
   - **Webhooks** — event types, payload shape, `X-CMS-Signature` HMAC
     verification sample (Node), retries/delivery log.
   - **FAQ / Troubleshooting** — auth errors, 402/429 limits, locale
     fallbacks, preview tokens, CORS, self-hosting pointers.
3. Nav + footer link to Docs; features page cards link "Learn more →" into
   the relevant docs section; support page "Documentation" card → `/docs`.
4. *Decision*: MDX pages live at `marketing/src/app/docs/<slug>/page.mdx`
   via `@next/mdx` — each page IS a plain editable MDX file (the prompt's
   `content/docs/` folder suggestion, realized as routed MDX so no runtime
   compiler dependency is needed). Shared chrome comes from
   `app/docs/layout.tsx`; the sidebar tree is data-driven from
   `src/lib/docs-nav.ts`.

## Files

- `marketing/next.config.mjs` + `mdx-components.tsx` → `@next/mdx` wiring.
- `marketing/src/app/docs/layout.tsx`, `src/lib/docs-nav.ts`,
  `src/app/docs/page.mdx` + 7 section directories with `page.mdx`.
- `globals.css` → `.docs-*` layout, code-block, table, callout styles.

## Acceptance criteria

- [x] `/docs` + all section pages return 200 and render inside the sidebar
      layout; sidebar highlights the active page.
- [x] Docs linked from nav, footer, support card, and ≥6 feature cards.
- [x] Code samples use real endpoint paths/token prefixes from this repo.
- [x] Mobile: sidebar collapses; content readable at 360px.

## Tasks

- [x] Install `@next/mdx @mdx-js/loader @mdx-js/react`; configure pageExtensions.
- [x] Docs layout + nav data + styles.
- [x] Write the 7 MDX guides + docs index.
- [x] Cross-link nav/footer/features/support.
- [x] Smoke + tsc.
