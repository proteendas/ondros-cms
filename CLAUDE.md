# Ondros CMS — mandatory UI conventions

Rules for anyone (human or agent) touching `editor/`, `preview/` or
`superadmin/`. They are **not stylistic preferences** — treat them as
mandatory when writing or reviewing frontend code.

---

## Dropdowns — always `ui/Select`, never `<select>`

**Never use a native `<select>`.** Its popup list is rendered by the operating
system, ignores every design token, and looks different on macOS, Windows,
Android and iOS. Use the themed component:

```tsx
import Select from '@/components/ui/Select';

<Select
  value={status}
  onChange={setStatus}                    // (value: string) => void
  options={[
    { value: '', label: 'Any status' },
    ...items.map((i) => ({ value: i.id, label: i.name })),
  ]}
/>
```

`editor/src/components/ui/Select.tsx` is the single implementation. It renders
a button plus a listbox popover portalled to `<body>`, so it is never clipped
by a modal, toolbar or scroll container, and it keeps full native parity:
Up/Down/Home/End move the active option, Enter/Space commit, Escape/Tab close,
typing jumps to a match, and it exposes `combobox`/`listbox`/`option` roles
with `aria-activedescendant`.

### Props worth knowing

| Prop | Purpose |
|---|---|
| `variant` | `input` (default, light forms) · `chrome` (dark topbar) · `toolbar` (compact richtext bar) |
| `placeholder` | Shown when `value` matches no option |
| `ariaLabel` | **Required** when there is no visible `<label>` |
| `icon` / `iconTitle` on an option | Optional trailing marker, e.g. `star` for "you own this account" |
| `disabled` on an option | Rendered muted and skipped by keyboard navigation |

### Adding a new variant

Add the case to `SelectVariant` and a matching `.select-trigger.<variant>`
block in `globals.css`. Don't style a `Select` from the call site beyond
layout (`style={{ maxWidth: … }}`) — visual treatment belongs in the variant
so every dropdown of that kind stays identical.

---

## Icons — Bootstrap Icons webfont, always through `<Icon>`

**No emoji. No unicode glyphs (`→ ← ★ ⚠ ✕ ▾ ✎ …`). No `<svg>`. No
`react-bootstrap-icons`.** Every icon in every app is a
[Bootstrap Icon](https://icons.getbootstrap.com) rendered as the **webfont** —
the markup is `<i class="bi bi-alarm"></i>`.

The stylesheet is imported once per app in `app/layout.tsx`:

```ts
import 'bootstrap-icons/font/bootstrap-icons.css';
```

Because glyphs are font characters they inherit `currentColor` and
`font-size`, so design tokens apply with no extra work.

### Always go through the app's `Icon` component

Don't hand-write `<i className="bi bi-…">` at a call site — that scatters raw
class strings and defeats the point of a swappable icon layer. Use:

```tsx
import Icon from '@/components/ui/Icon';   // superadmin/preview: '@/components/Icon'

<Icon name="warning" size={13} />
<button aria-label="Remove"><Icon name="close" size={12} /></button>
```

| App | Icon layer |
|---|---|
| `editor/` | `editor/src/components/ui/Icon.tsx` |
| `superadmin/` | `superadmin/src/components/Icon.tsx` |
| `preview/` | `preview/src/components/Icon.tsx` |

Each is the same shape: a `name → bootstrap class suffix` map plus a component
that renders `<i class="bi bi-…">` and handles sizing and `aria-hidden`.

### Adding an icon

Add a **semantic** name to the map — `delete`, `publish`, `field-richtext`,
not `trash`, `check-circle`, `justify-left`. Semantic names are what let the
icon set be re-skinned without touching a single screen:

```ts
// editor/src/components/ui/Icon.tsx
export const ICONS = {
  'chevron-down': 'chevron-down',
  delete: 'trash',
  // …
};
```

The class suffix must be a real icon name from
[icons.getbootstrap.com](https://icons.getbootstrap.com) — the full list also
ships locally at `node_modules/bootstrap-icons/font/bootstrap-icons.json`.

### The only exception

`InlineEditorOverlay.tsx` and `InlineEditingBridge.tsx` build DOM with raw
string APIs inside the preview iframe, where React can't render, so they write
`<i class="bi bi-pencil-fill">` directly. That iframe document loads the `bi` stylesheet itself, which is why the
class resolves there. If you need another such glyph, use a `bi` class — never
an inline SVG.

---

## Typography — brand faces via design tokens

The apps use the same pair as the marketing site (`ondros-cms-site`):
**Plus Jakarta Sans** for UI, **JetBrains Mono** for code and ids.

- The woff2 files are **vendored** in `<app>/src/app/fonts/` and loaded with
  `next/font/local` in each `layout.tsx`, which sets `--font-sans` and
  `--font-mono` on `<html>`. They are not fetched from Google at build time:
  that breaks in the Docker dev containers (the CDN resolves IPv6-only and the
  bridge network can't route it) and in offline CI.
- `globals.css` maps them onto the design tokens `--font` and `--mono`.

**Never hardcode a font stack.** Use `font-family: var(--font)` or
`var(--mono)`, or inherit. Only the three `globals.css` files may name a
concrete family, and only as fallbacks after the token.

---

## Before you commit frontend changes

Re-read the rules above, then:

```bash
docker compose exec editor npm run typecheck     # also: preview, superadmin
```

A quick self-check while reviewing a diff — each of these should find nothing
outside the icon modules themselves:

```bash
grep -rn "<select"                editor/src preview/src superadmin/src
grep -rn "<svg\|react-bootstrap-icons"  editor/src preview/src superadmin/src
```
