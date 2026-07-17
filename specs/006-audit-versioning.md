# 006 — Audit Log & Entry Version History

## Current state (before this spec)

- `Entry.version` int increments on every save, but no snapshots are kept —
  no history, no diff, no restore. No audit trail of who did what.

## Requirements

- `AuditLog`: account_id, actor_id, action, resource_type, resource_id, diff,
  timestamp — written for every content/settings mutation.
- `EntryVersion`: snapshot on every save (fields + slug + status), "Version
  history" panel in the entry editor with field-level diff and 1-click restore.

## Data model

| Table | Columns |
|-------|---------|
| `audit_logs` | id, tenant_id, space_id?, actor_id?, actor_label, action, resource_type, resource_id, diff JSONB, created_at (indexed tenant+created) |
| `entry_versions` | id, entry_id, version, slug, status, fields JSONB, created_by, created_at — unique(entry_id, version); pruned to last 50 |

## Write paths (helper `app/core/audit.py`)

- `record_audit(db, actor, action, resource_type, resource_id, diff, space_id)`
  — called from entries (create/update/transition/delete/bulk/restore),
  content_types, media, api_keys, webhooks, spaces/environments, locales,
  sso config, billing changes.
- `snapshot_entry(db, entry, actor)` — called before counters bump on every
  entry mutation; computes a shallow field diff for the audit row.

## API surface

```
GET  /entries/{id}/versions                    list (meta only)
GET  /entries/{id}/versions/{version}          full snapshot
POST /entries/{id}/versions/{version}/restore  copy snapshot into draft (new version)
GET  /spaces/{id}/audit-log?resource_type=&q=&skip=&limit=   (read_content; settings UI)
```

## Acceptance criteria

- [x] Every PATCH creates a version; restore brings old fields back as a new
      version (`test_versions_audit.py`)
- [x] Audit rows written for entry create/update/publish/delete with diffs
- [x] Version list pruned (keeps most recent 50)
- [x] Editor: History panel lists versions, shows per-field diff, restores
- [x] Settings → Audit log page with filters

## Tasks

- [x] Models + migrations
- [x] core/audit.py + hooks in routers
- [x] versions endpoints + restore
- [x] Editor VersionHistory component + AuditLog settings page
- [x] Tests
