# UI conventions

Three rules hold across `editor/`, `preview/` and `superadmin/`. They are not
stylistic preferences — each exists because the obvious alternative was tried
and caused a real problem.

The authoritative copy lives in [CLAUDE.md](../CLAUDE.md) at the repo root,
where Claude Code loads it automatically. This page explains the reasoning.

## 1. Dropdowns — always `ui/Select`

**Never use a native `<select>`.**

A native select's popup list is drawn by the operating system. It ignores every
design token, and looks completely different on macOS, Windows, Android and
iOS. You cannot style it, and no amount of CSS on the `<select>` element
changes the menu.

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

`editor/src/components/ui/Select.tsx` is the single implementation: a button
plus a listbox popover **portalled to `<body>`**, so it is never clipped by a
modal, toolbar or scroll container.

It keeps full native parity, which is the part that's easy to get wrong:

| Interaction | Behaviour |
|---|---|
| ↑ / ↓ | Move the active option, skipping disabled ones |
| Home / End | First / last enabled option |
| Enter / Space | Commit |
| Escape | Close, restoring focus to the trigger |
| Tab | Close and move on |
| Typing | Type-ahead jump, 700ms window |

ARIA: `combobox` on the trigger, `listbox` on the menu, `option` on each row,
with `aria-activedescendant` tracking the active one.

| Prop | Purpose |
|---|---|
| `variant` | `input` (light forms) · `chrome` (dark topbar) · `toolbar` (rich-text bar) |
| `placeholder` | Shown when `value` matches no option |
| `ariaLabel` | **Required** when there's no visible `<label>` |
| `icon` / `iconTitle` | Optional trailing marker on an option |
| `disabled` | On the control, or per option |

**Adding a variant:** extend `SelectVariant` and add a
`.select-trigger.<variant>` block in `globals.css`. Don't style a `Select` from
the call site beyond layout (`style={{ maxWidth: … }}`) — visual treatment
belongs in the variant, so every dropdown of that kind stays identical.

## 2. Icons — Bootstrap Icons webfont, via `<Icon>`

**No emoji. No unicode glyphs (`→ ← ★ ⚠ ✕ ▾ ✎`). No `<svg>`. No
`react-bootstrap-icons`.**

Emoji render differently on every platform and can't take design-token colours.
Hand-written SVG drifts from the icon set the moment someone eyeballs a path.

Everything renders as `<i class="bi bi-…">` through each app's central `Icon`
component, so glyphs inherit `currentColor` and `font-size` for free and the
whole set is swappable in one file per app.

```tsx
import Icon from '@/components/ui/Icon';   // superadmin/preview: '@/components/Icon'

<Icon name="warning" size={13} />
<button aria-label="Remove"><Icon name="close" size={12} /></button>
```

| App | Icon layer |
|---|---|
| `editor/` | `src/components/ui/Icon.tsx` |
| `superadmin/` | `src/components/Icon.tsx` |
| `preview/` | `src/components/Icon.tsx` |

**Adding an icon** — add a *semantic* name to the map, never a visual one:

```ts
export const ICONS = {
  delete: 'trash',            // ✓ semantic
  publish: 'check-circle',    // ✓
  // trash: 'trash',          // ✗ describes the picture, not the meaning
};
```

Semantic names are what let the icon set be re-skinned without touching a
single screen. The class suffix must be a real Bootstrap icon —
[icons.getbootstrap.com](https://icons.getbootstrap.com), or the full list at
`node_modules/bootstrap-icons/font/bootstrap-icons.json`.

**The one exception:** `InlineEditorOverlay.tsx` and `InlineEditingBridge.tsx`
build DOM with raw string APIs inside the preview iframe, where React can't
render. They write `<i class="bi bi-pencil-fill">` directly — still a `bi`
class, never an inline SVG.

## 3. Typography — tokens, never literal stacks

Plus Jakarta Sans for UI, JetBrains Mono for code and ids — the same pair as
the marketing site.

```css
font-family: var(--font);   /* UI */
font-family: var(--mono);   /* code, ids, tokens */
```

**Never hardcode a font stack.** Only the three `globals.css` files may name a
concrete family, and only as a fallback after the token.

The woff2 files are **vendored** under `<app>/src/app/fonts/` and loaded with
`next/font/local` rather than `next/font/google`. That isn't preference:
`fonts.googleapis.com` resolves IPv6-only from the Docker bridge network, so
`next/font/google` fails there and in any offline CI. Vendoring makes the build
hermetic.

## Sensitive inputs

Passwords and secrets go through `PasswordInput`, which adds a reveal toggle:

```tsx
<PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
```

Worth preserving if you touch it:

- the toggle's `aria-label` reflects **state** ("Show password" / "Hide
  password"), not the picture of an eye
- `tabIndex={-1}` keeps Tab going field → submit, the order people expect while
  typing a password
- the browser's own `::-ms-reveal` is suppressed, so there aren't two eyes
- the field always starts masked; revealed state is never persisted

## Design tokens

Everything visual comes from custom properties at the top of `globals.css`:

```css
--bg --surface --surface-2 --border --border-strong
--text --text-2 --text-3
--primary --primary-hover --primary-soft
--danger --success --warning --purple  (+ -soft variants)
--chrome --chrome-2 --chrome-text --chrome-active
--radius --shadow-sm --shadow-lg --font --mono
```

Use a token rather than a literal colour. A new shade of grey in one component
is how a design system stops being one.

## Checking your work

```bash
docker compose exec editor npm run typecheck   # also: preview, superadmin
```

Quick self-check on a diff — each should find nothing outside the icon modules:

```bash
grep -rn "<select"                        editor/src preview/src superadmin/src
grep -rn "<svg\|react-bootstrap-icons"    editor/src preview/src superadmin/src
```

## Where to go next

- App structure → [09-frontend-apps.md](09-frontend-apps.md)
- The rules as loaded by tooling → [CLAUDE.md](../CLAUDE.md)
