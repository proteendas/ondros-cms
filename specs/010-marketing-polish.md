# 010 — Marketing Site Polish: Responsive, 3D Hero, Motion

## Current state

Spec 009 shipped `marketing/` (Next.js, :3002) with landing/features/pricing/
support, editor-derived design tokens in `src/app/globals.css`, and env-based
Login/Get Started CTAs. Gaps this spec closes:

- **Nav does not collapse** — links shrink at ≤640px but stay inline; no
  hamburger menu, tap targets fall under 44px.
- **Hero is static** — two radial gradients on the chrome background; no brand
  motion, no depth.
- **No scroll motion** — sections render all-at-once; no reveal rhythm.
- **Token drift risk** — tokens are duplicated by hand from the editor; no
  documented spacing/type scale.

## Requirements

1. **Responsive audit** across mobile (≤480px), tablet (481–1024px), desktop
   (>1024px): hamburger nav on ≤768px (accessible `<button aria-expanded>`,
   full-width sheet with 44px-tall tap targets), stacked grids, fluid type via
   `clamp()`, CTA buttons ≥44px tall everywhere.
2. **3D hero** with React Three Fiber + `@react-three/drei`:
   - Abstract brand shape (orbital ring + core sphere + floating dot echoing
     the logo mark), slow rotation + gentle float; brand gradient colors
     (#6366f1 → #a855f7).
   - Loaded via `next/dynamic` with `ssr: false`; the hero renders fully
     without it (progressive enhancement).
   - **Fallback**: skip mounting the canvas when WebGL is unavailable or
     `prefers-reduced-motion: reduce` — the static logo + gradient stays.
   - Canvas capped (`dpr={[1, 1.75]}`, no shadows, low-poly) for mobile GPUs.
3. **Scroll-linked reveals** for feature/step/plan cards. *Decision*: the
   prompt lists GSAP ScrollTrigger as optional — we use an
   IntersectionObserver `<Reveal>` component + CSS transitions instead (zero
   extra dependency, honors `prefers-reduced-motion`). GSAP can replace it
   later without markup changes.
4. **Design token consolidation**: one commented token block (spacing scale
   4/8/12/16/24/32/48/64/84, type scale, palette from the logo gradient)
   at the top of `globals.css`, cross-referenced with
   `editor/src/app/globals.css`.
5. **Visual hierarchy**: larger hero headline, consistent card radii/shadows,
   whitespace rhythm via the spacing scale; all icons through
   react-bootstrap-icons (already true — verify).
6. **Performance**: three.js chunk loads only on the landing page after
   hydration; no images beyond the inline SVG logos; static fallback means
   LCP never waits on WebGL.

## Files

- `marketing/src/components/SiteNav.tsx` → client component with hamburger
  state; `marketing/src/components/Hero3D.tsx` (R3F scene, dynamic import);
  `marketing/src/components/Reveal.tsx` (IntersectionObserver wrapper).
- `marketing/src/app/globals.css` → token block, nav sheet, reveal classes,
  breakpoint fixes.
- `marketing/package.json` → `three`, `@react-three/fiber`, `@react-three/drei`,
  `@types/three`.

## Acceptance criteria

- [x] ≤768px: nav shows hamburger; menu opens a sheet with ≥44px rows; body
      CTAs ≥44px tall; no horizontal scroll at 360px width.
- [x] Landing hero mounts an animated WebGL canvas on capable browsers;
      with reduced motion or no WebGL the static logo renders (no crash,
      no layout shift — fixed-height slot).
- [x] Cards fade/rise in on scroll; disabled under `prefers-reduced-motion`.
- [x] `tsc --noEmit` clean; all four pages + /docs return 200.

## Tasks

- [x] Add three/R3F/drei deps; build `Hero3D` + WebGL/reduced-motion gate.
- [x] Rewrite `SiteNav` with hamburger sheet.
- [x] `Reveal` component + wire into landing/features/pricing sections.
- [x] Token block + responsive/tap-target CSS pass.
- [x] Smoke: pages 200, tsc clean.
