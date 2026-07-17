# 003 — Dynamic, Per-Space Locales

## Current state (before this spec)

- Locales already **dynamic per space**, stored as `spaces.locales` JSONB
  (`[{code, name}]`) + `spaces.default_locale`; editor tabs and validation
  read that list (NOT a hardcoded enum).
- Gaps vs. requirements: no first-class `Locale` rows (no fallback chain, no
  is_active), the settings UI is a small modal with free-text codes (no ISO
  catalog), delivery fallback is default-locale only, AI translate button is
  hardwired to default→active locale.

## Requirements

- `Locale` model: id, space_id, code, name, is_default, fallback_locale_id,
  is_active, position.
- Space wizard + Settings → Locales pick from a full ISO 639-1 + region
  catalog; add/remove anytime.
- Validation reads the space's configured Locale list (already true — keep
  `spaces.locales` as a synced cache so existing consumers don't change).
- Delivery `?locale=` walks the configured fallback chain
  (locale → fallback → … → default), cycle-safe.
- `/ai/translate-fields` accepts ANY active pair (already true) + editor
  exposes "AI translate to…" for every other active locale.

## Data model

| Table | Columns |
|-------|---------|
| `locales` | id, tenant_id, space_id, code, name, is_default, is_active, position, fallback_locale_id → locales.id — unique(space_id, code) |

`spaces.locales` / `spaces.default_locale` remain as a denormalized cache,
rebuilt by `sync_space_locale_cache()` after every locale mutation (single
writer path: the locales router + space create).

## API surface

```
GET    /spaces/{id}/locales
POST   /spaces/{id}/locales              {code, name, fallback_code?}   (manage_settings)
PATCH  /spaces/{id}/locales/{localeId}   {name?, is_active?, fallback_code?, position?}
POST   /spaces/{id}/locales/{localeId}/make-default
DELETE /spaces/{id}/locales/{localeId}   (blocked for default; content values remain, ignored)
```

## Acceptance criteria

- [x] CRUD + default switching + cache sync (`test_locales.py`)
- [x] Migration backfills Locale rows from existing `spaces.locales` JSONB
- [x] Delivery fallback chain: hi-IN → en-GB → en-US resolves through the chain
- [x] Fallback cycles cannot 500 (visited-set guard)
- [x] Publish validation accepts any configured locale, rejects unknown ones
- [x] Editor tabs + AI translate dropdown driven by /locales

## Tasks

- [x] Model + dev migration backfill + Alembic
- [x] locales router + space-create integration
- [x] Delivery `_resolve_locale` chain walk
- [x] ISO catalog (`editor/src/lib/localeCatalog.ts`, ~90 locales)
- [x] Settings → Locales page (catalog picker, fallback, default, active)
- [x] Editor: dynamic tabs (already) + translate-to dropdown
- [x] Tests
