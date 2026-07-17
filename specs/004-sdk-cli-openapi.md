# 004 — SDK (@yourcms/sdk), CLI (yourcms-cli), OpenAPI

## Current state (before this spec)

- `sdk/` ships `@acme/cms-client`: typed `createClient` with
  getEntries/getEntry/getEntryBySlug/getAssets + `resolve()` over `includes`.
- Gaps: no retry/backoff, no caching, no `fields.*` filters (backend lacked
  them too), single `baseUrl` (no host/previewHost split), no codegen, no CLI,
  no exported OpenAPI artifact.

## Requirements

- Package renamed **`@yourcms/sdk`**; config `{spaceId, environmentId,
  accessToken, host, previewHost?}` — previewHost used automatically for
  `cms_pre_*` tokens.
- `getEntries({contentType, locale, 'fields.<id>': value, limit, skip, ...})`.
- Retry with exponential backoff + jitter on 429/5xx/network (idempotent GETs).
- In-memory stale-while-revalidate cache (TTL, off by default in Node SSR when
  `cache: false`).
- Link resolution to `include` depth (server resolves; SDK exposes
  `resolve()` and `resolveLinks()` deep-inliner).
- `yourcms-cli`: login, spaces list, content-type export/import,
  `generate-types` (content types → TypeScript interfaces).
- OpenAPI 3 spec exported to `openapi.json` via script.

## Backend change

- Delivery API: arbitrary `fields.<id>=<value>` query params filter entries by
  field value (exact match on plain values; localized values match any locale).

## CLI commands

```
yourcms-cli login --host http://localhost:8000        # stores JWT in ~/.yourcmsrc.json
yourcms-cli spaces
yourcms-cli types export --space <id> --env master -o types.json
yourcms-cli types import --space <id> --env master -i types.json
yourcms-cli generate-types --space <id> --env master -o cms-types.d.ts
```

## Acceptance criteria

- [x] `fields.*` filter test (plain + localized) in `test_delivery_keys.py`
- [x] SDK typechecks (`tsc --noEmit`); retry/backoff + SWR unit-testable design
- [x] CLI runs under node 18+ with zero runtime deps
- [x] `python scripts/export_openapi.py` writes `openapi.json`
- [ ] Publish to npm (needs org/token — manual)

## Tasks

- [x] Backend fields.* filters
- [x] sdk/ v2 (retry, cache, filters, host/previewHost, resolveLinks)
- [x] cli/ package (login/spaces/types export/import/generate-types)
- [x] scripts/export_openapi.py
- [x] README usage examples (Next.js draft-mode pattern)
