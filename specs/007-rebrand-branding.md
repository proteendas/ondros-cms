# 007 — Rebrand: "Compose CMS" → "Ondros CMS" + Logo Assets

## Current state (before this spec)

- Brand string "Compose CMS" hardcoded in: editor AppShell top bar, login page,
  signup page, `layout.tsx` metadata title, backend email subjects/bodies
  (verify / invite / reset), `SMTP_FROM` defaults, README. Backend
  `app_name = "Headless CMS"`. Logo is a text glyph (◆ in a gradient square) —
  no SVG assets, no favicon.
- Packages: `@yourcms/sdk`, `yourcms-cli`, `cms-editor`, `cms-preview`.
- No single change-point for the brand — renames require a grep sweep.

## Requirements

- Replace all "Compose CMS"/"Compose" brand references with "Ondros CMS"/"Ondros".
- **Single change-point**: `editor/src/lib/brand.ts` (`BRAND` config: name,
  short name, tagline, logo paths) and `settings.brand_name` (backend). All UI
  strings, email templates, and metadata read from these.
- Logo assets under `editor/public/branding/` (served at `/branding/*`):
  `logo.svg` (mark + wordmark), `logo-icon.svg` (mark only), `favicon.ico`.
  Placeholder geometric artwork is acceptable — marked with a
  `TODO: replace placeholder logo` comment for the design swap-in.
- Wire the logo into: sidebar/top-bar header, login/signup/onboarding pages,
  email templates (text fallback), favicon link tags, marketing site (spec 009).
- Rename packages: SDK → `@ondros/sdk`, CLI → `ondros-cli` (bin + rc file
  `~/.ondrosrc.json`), editor → `ondros-editor`, preview → `ondros-preview`.
- Update the API-key "How to use" snippet and README imports accordingly.

## Decisions

- The preview app keeps its **"Acme Site"** branding — it simulates a
  *customer's* website, not the product; demo content (Acme guidelines) stays.
- `docker-compose.yml` service names (`backend`/`editor`/`preview`) are
  infrastructure identifiers, not brand strings — unchanged (the new
  `marketing` service is added by spec 009).
- Favicon is generated from the icon mark (Pillow, 32px) so a real `.ico`
  binary ships; the SVG icon is also linked for modern browsers.

## Acceptance criteria

- [x] `grep -ri "compose cms"` over source returns nothing (excluding
      docker-compose tooling references and specs history)
- [x] Brand renders from `BRAND`/`settings.brand_name` in shell, auth pages,
      emails, page titles
- [x] `/branding/logo.svg`, `/branding/logo-icon.svg`, `/branding/favicon.ico`
      served by the editor app and referenced by metadata
- [x] SDK/CLI renamed; snippets and docs updated

## Tasks

- [x] backend: `settings.brand_name`, email strings, app title
- [x] frontend: `brand.ts`, shell/login/signup/onboarding/layout, favicon links
- [x] assets: placeholder SVGs + generated favicon.ico
- [x] package renames + snippet/docs sweep
- [ ] Replace placeholder artwork with final design (manual)
