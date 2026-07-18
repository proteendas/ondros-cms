# 015 — Rich Text Editor: Contentful Parity + Text Color

## Current state

`editor/src/components/RichTextField.tsx` is a minimal TipTap `StarterKit`
editor that stores **HTML strings** in `Entry.fields`. The preview app renders
that HTML via `dangerouslySetInnerHTML`. Backend validation treats richtext as
a plain string (`TEXT_TYPES`). No color, tables, embeds, links, or field-level
restrictions.

## Requirements

### 1. Structured JSON document model
- RichText fields store TipTap/ProseMirror **JSON** (`{ type: 'doc',
  content: [...] }`), not HTML — framework-agnostic for downstream renderers.
- A top-level `richTextSchemaVersion` (currently `1`) rides alongside the doc
  so future node/mark additions don't break stored entries.
- **Back-compat**: a stored *string* is treated as legacy HTML — the editor
  parses it (`generateJSON`), the delivery/preview renderers still accept it.
- Backend validates richtext values as either a legacy string OR a JSON doc
  whose node/mark types are all in the allowed set for that field.

### 2. Toolbar (Contentful parity)
- Marks: bold, italic, underline, strike, inline code, **text color**,
  **highlight**.
- Nodes: paragraph, heading H1–H6, blockquote, ordered/bullet list, list item,
  code block, horizontal rule, hard break.
- Links: external URL **and** internal link to an Ondros entry/asset (reuses
  the existing reference/media picker modals).
- Tables: insert / add-remove row+column / toggle header / delete, via
  `@tiptap/extension-table` (+ row/cell/header). External table paste keeps
  structure (ProseMirror's built-in table paste).

### 3. Text color + highlight
- `@tiptap/extension-color` (on `@tiptap/extension-text-style`) for text color;
  `@tiptap/extension-highlight` (`multicolor: true`) for background.
- Swatch popovers (curated brand palette + custom hex) for each, with a
  "remove color"/"clear" action (`unsetColor()` / `unsetHighlight()`).
- Colors persist in the mark JSON attrs (`textStyle.attrs.color`,
  `highlight.attrs.color`) and round-trip through the API.
- Accessibility: a small WCAG-AA contrast warning when a chosen text color is
  low-contrast on white (nice-to-have).

### 4. Embedded entries & assets + slash menu
- Custom TipTap nodes: `embeddedEntryBlock` (standalone block card),
  `embeddedEntryInline` (inline pill), `embeddedAssetBlock` (media block) —
  all atoms storing `{ id }`, selected via the existing pickers.
- Marks: `linkedEntry` / `linkedAsset` — reference-only links (not embeds)
  storing `{ id }`, resolved to a URL on render.
- `/` slash command (via `@tiptap/suggestion`) inserts headings, lists,
  quote, code, rule, table, embeds, and media without leaving the keyboard.
- **Delivery/preview**: richtext entry/asset ids (embeds + link marks) are
  collected and resolved into `includes` up to the `include` depth, same as
  reference fields.

### 5. Field-level restrictions (admin configurable)
- New `FieldDef.rich_text` config (backend + editor):
  `allowed_marks`, `allowed_nodes` (null = all), `allowed_embed_types`
  (content-type api_ids), `allow_color`, `allow_highlight`, `allow_tables`,
  `allow_links`.
- Enforced in the editor (disallowed toolbar buttons/slash items hidden,
  disallowed extensions omitted) **and** the backend (entries with disallowed
  node/mark types are rejected on publish; embeds of disallowed content types
  rejected).

### 6. AI sidebar
- AI transforms operate on the JSON doc: plain text is extracted for the
  prompt, and AI output (HTML/text) is converted to valid TipTap JSON matching
  the field's allowed schema before insertion — never raw HTML dropped in.
- Existing color/highlight marks are preserved where the original text
  survives a rewrite (best-effort; full doc replacement otherwise).

## Data model

`RichTextConfig` (Pydantic + TS mirror):

```
allowed_marks: list[str] | None = None        # None = all supported
allowed_nodes: list[str] | None = None
allowed_embed_types: list[str] = []           # content type api_ids
allow_color: bool = True
allow_highlight: bool = True
allow_tables: bool = True
allow_links: bool = True
```

Supported node types: `doc, paragraph, text, heading, blockquote, bulletList,
orderedList, listItem, codeBlock, horizontalRule, hardBreak, table, tableRow,
tableCell, tableHeader, embeddedEntryBlock, embeddedEntryInline,
embeddedAssetBlock`.

Supported mark types: `bold, italic, underline, strike, code, textStyle,
highlight, link, linkedEntry, linkedAsset`.

## API surface

No new endpoints. Changed behavior:
- Entry create/update: richtext JSON validated against allowed schema;
  embedded/linked ids added to reference-existence checks.
- Delivery/preview `entries` + `entries/{id}`: `includes` now also contains
  entries/assets referenced from richtext fields.

## Acceptance criteria

- [x] A richtext field saves and reloads a JSON doc with color, highlight,
      a table, an embedded entry, and an internal link — round-tripping intact.
- [x] Legacy HTML-string values still load in the editor and render in preview.
- [x] Publishing an entry whose richtext uses a node/mark disallowed by the
      field config returns a validation error.
- [x] Delivery `include=2` resolves an entry embedded in richtext into
      `includes.Entry`.
- [x] Restriction UI in the content-type builder toggles marks/nodes/embeds/
      color/highlight/tables/links for a richtext field.
- [x] Backend tests + `tsc --noEmit` (editor, preview) pass.

## Tasks

- [x] Install TipTap extensions + align core to one version.
- [x] Backend: `RichTextConfig`, `app/core/richtext.py` (allowed sets, JSON
      validation, id walker), wire into validation + entries + delivery.
- [x] Editor: custom nodes/marks module + shared id-walker; `RichTextField`
      rewrite (toolbar, color/highlight popovers, tables, embeds, slash menu,
      restrictions); JSON storage with HTML back-compat.
- [x] Editor: content-type builder restriction UI; AI sidebar JSON adaptation.
- [x] Preview: ProseMirror-JSON renderer with embeds + legacy HTML fallback.
- [x] Tests + typecheck + smoke.
