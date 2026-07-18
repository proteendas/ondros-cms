# 008 — Icon Migration → Bootstrap Icons

## Current state (before this spec)

- No icon library. Every icon in the editor is an emoji or unicode glyph
  (🧩 📄 🖼 🔑 📡 👥 ⠿ ✕ ↑ ↓ ✨ 💡 …) hardcoded at each call site; the
  preview inline-editing overlay uses a literal "✏️" in its hover tag.
- Emoji render inconsistently across platforms and can't take design-token
  colors.

## Requirements

- Single icon dependency: **react-bootstrap-icons** (typed React components
  over the Bootstrap Icons set; SVGs use `fill="currentColor"` so they inherit
  the design tokens).
- Central wrapper `editor/src/components/ui/Icon.tsx`:
  `<Icon name="webhook" size={16} />` — a semantic-name → Bootstrap-Icon map
  (`IconName` union) so the whole app's iconography is swappable in one file.
- Replace every icon usage: sidebar nav + dashboard cards, entries list &
  editor (history, panes), content-type builder (drag handle, reorder, field
  type glyphs via `FIELD_TYPE_INFO`), media library & pickers, reference
  picker, AI sidebar actions, top-bar/login logo (→ spec 007 logo asset),
  settings pages, modals/empty-states (`ui.tsx` accepts ReactNode icons).
- Preview app: the overlay hover tag embeds the Bootstrap `pencil-fill` SVG
  path inline (no runtime dep added to the preview bundle).
- Sizing/color must keep matching the existing tokens (16px default, semantic
  colors via `currentColor`).

## Semantic map (excerpt — full map in Icon.tsx)

| name | Bootstrap icon | | name | Bootstrap icon |
|------|----------------|-|------|----------------|
| content-model | Boxes | | media | Images |
| content | FileEarmarkText | | guidelines | BookHalf |
| locale | Globe2 | | api-key | Key |
| environment | Diagram3 | | webhook | Broadcast |
| users | People | | security | ShieldLock |
| billing | CreditCard | | audit | JournalText |
| edit | PencilSquare | | delete | Trash |
| history | ClockHistory | | drag | GripVertical |
| generate | Stars | | translate | Translate |

## Acceptance criteria

- [x] `react-bootstrap-icons` is the only icon dependency; no emoji icons left
      in editor UI chrome (`grep` sweep of components/pages)
- [x] All icons render through `Icon`/direct react-bootstrap-icons imports
- [x] `tsc --noEmit` clean; screens smoke-render

## Tasks

- [x] Install dep (container + package.json)
- [x] Icon.tsx wrapper + IconName union
- [x] FIELD_TYPE_INFO.icon → IconName migration
- [x] Sweep all editor screens; preview overlay inline SVG
