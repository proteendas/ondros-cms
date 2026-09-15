# Management API

Everything that writes. Authenticate with a **user JWT** or a `cms_mgm_…` key;
every route is checked against the caller's capabilities for the space in
question ([07-auth-and-permissions.md](../07-auth-and-permissions.md)).

The capability column below names what you need. `—` means any authenticated
member of the account.

---

## Auth (12)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/signup` | Create an account + its first ORG_ADMIN, send verification |
| `POST` | `/auth/login` | JSON login → access + refresh pair |
| `POST` | `/auth/token` | OAuth2 **form** login (Swagger's Authorize button) |
| `POST` | `/auth/refresh` | Rotate a refresh token — the presented one is revoked |
| `POST` | `/auth/verify-email` | Confirm the address and sign in |
| `POST` | `/auth/forgot-password` | Always 200 — never leaks whether an email exists |
| `POST` | `/auth/reset-password` | Consume the token, set the password, sign in |
| `POST` | `/auth/switch-account` | Re-scope the token to another account you belong to |
| `GET` | `/auth/me` | Profile, roles, capabilities and accounts for the **active** account |
| `PATCH` | `/auth/me` | Update your own name — works at any role |
| `POST` | `/auth/change-password` | Requires the current password; revokes other sessions |
| `POST` | `/auth/sign-out-everywhere` | Revoke every refresh token for this user |

```bash
curl -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"admin123"}'
# → { "access_token": "eyJ…", "refresh_token": "…", "token_type": "bearer" }
```

`POST /auth/signup` and the reset flow return the action token directly **only
when `AUTH_DEV_MODE=true`** — never enable that outside local development, or
anyone can verify any address.

---

## Spaces & environments (8)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces` | — |
| `POST` | `/spaces` | `manage_spaces` |
| `PATCH` | `/spaces/{space_id}` | `manage_spaces` |
| `DELETE` | `/spaces/{space_id}` | `manage_spaces` |
| `GET` | `/spaces/{space_id}/environments` | — |
| `POST` | `/spaces/{space_id}/environments` | `manage_environments` |
| `DELETE` | `/spaces/{space_id}/environments/{environment}` | `manage_environments` |
| `POST` | `/spaces/{space_id}/environments/{environment}/make-default` | `manage_environments` |

`PATCH /spaces/{id}` accepts `name`, `locales` and `default_locale`.

**Creating an environment optionally clones another**, copying content types
*and* entries and remapping every reference id so the clone is internally
consistent — without that remap, staging entries would silently point at
production content.

```bash
curl -X POST "localhost:8000/spaces/$SPACE/environments" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"key":"staging","name":"Staging","type":"staging","clone_from":"<env-id>","clone_entries":true}'
```

Deleting an environment deletes its content types, entries and media. The
default environment cannot be deleted — promote another first.

---

## Content types (5)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/environments/{environment}/content-types` | `read_content` |
| `POST` | `/spaces/{space_id}/environments/{environment}/content-types` | `manage_content_types` |
| `GET` | `/content-types/{content_type_id}` | `read_content` |
| `PUT` | `/content-types/{content_type_id}` | `manage_content_types` |
| `DELETE` | `/content-types/{content_type_id}` | `manage_content_types` |

Update is `PUT`, not `PATCH`: you send the whole `fields` array, because field
**order** is part of the schema and a partial merge could not express a
reorder.

```json
{
  "name": "Article",
  "api_id": "article",
  "display_field": "title",
  "fields": [
    { "id": "title", "name": "Title", "type": "text", "validations": { "required": true, "max": 120 } },
    { "id": "body",  "name": "Body",  "type": "richtext", "localized": true },
    { "id": "hero",  "name": "Hero",  "type": "reference", "allowed_content_types": ["hero"] }
  ]
}
```

Field types and validation rules: [08-content-modeling.md](../08-content-modeling.md).
Deleting a type with entries is refused — delete or move the entries first.

---

## Entries (13)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/environments/{environment}/entries` | `read_content` |
| `POST` | `/spaces/{space_id}/environments/{environment}/entries` | `manage_entries` |
| `POST` | `/spaces/{space_id}/environments/{environment}/entries/bulk` | per action |
| `GET` | `/entries/{entry_id}` | `read_content` |
| `PATCH` | `/entries/{entry_id}` | `manage_entries` |
| `DELETE` | `/entries/{entry_id}` | `manage_entries` |
| `POST` | `/entries/{entry_id}/publish` | `publish_entries` |
| `POST` | `/entries/{entry_id}/unpublish` | `publish_entries` |
| `POST` | `/entries/{entry_id}/archive` | `publish_entries` |
| `POST` | `/entries/{entry_id}/transition` | depends on target |
| `GET` | `/entries/{entry_id}/versions` | `read_content` |
| `GET` | `/entries/{entry_id}/versions/{version}` | `read_content` |
| `POST` | `/entries/{entry_id}/versions/{version}/restore` | `manage_entries` |

`PATCH` writes the **draft** (`fields`). Published output is unaffected until
you publish — which is why an author can keep editing a live page safely.

Publishing validates the fields against the schema **and** checks that every
referenced id still exists, then copies the draft into `published_fields`,
snapshots a version, writes an audit row and fires webhooks.

**Bulk** actions take `{"action": "publish", "entry_ids": [...]}`. Per-entry
permission and validation failures are reported in a `failed` array rather than
aborting the whole batch — one invalid entry doesn't block the other forty-nine.

**Restore** copies an old snapshot's fields and slug back into the draft as a
*new* version. History is append-only; nothing is rewritten.

```bash
curl -X POST "localhost:8000/entries/$ID/publish" -H "Authorization: Bearer $TOKEN"
```

---

## Media (6)

| Method | Path | Capability |
|---|---|---|
| `POST` | `/spaces/{space_id}/environments/{environment}/media` | `manage_media` |
| `GET` | `/spaces/{space_id}/media` | `read_content` |
| `GET` | `/media/{asset_id}` | `read_content` |
| `PATCH` | `/media/{asset_id}` | `manage_media` |
| `DELETE` | `/media/{asset_id}` | `manage_media` |
| `GET` | `/media/{asset_id}/variant` | `read_content` |

Upload is `multipart/form-data`. Image dimensions are extracted on upload;
`/variant` serves resized renditions.

```bash
curl -X POST "localhost:8000/spaces/$SPACE/environments/master/media" \
  -H "Authorization: Bearer $TOKEN" -F "file=@hero.jpg" -F "title=Hero image"
```

`PATCH` edits metadata only — `title`, `description`, `alt_text`, `tags`.
Files live on local disk by default; see
[18-configuration.md](../18-configuration.md) before deploying anywhere with an
ephemeral filesystem.

---

## Locales (5)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/locales` | — |
| `POST` | `/spaces/{space_id}/locales` | `manage_settings` |
| `PATCH` | `/spaces/{space_id}/locales/{locale_id}` | `manage_settings` |
| `DELETE` | `/spaces/{space_id}/locales/{locale_id}` | `manage_settings` |
| `POST` | `/spaces/{space_id}/locales/{locale_id}/make-default` | `manage_settings` |

`PATCH` sets `fallback_code`, `is_active` and `position`. Fallbacks chain, and
delivery guards against loops. The default locale cannot be deleted or given a
fallback.

---

## API keys (5)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/api-keys` | `manage_api_keys` |
| `POST` | `/spaces/{space_id}/api-keys` | `manage_api_keys` |
| `PATCH` | `/spaces/{space_id}/api-keys/{key_id}` | `manage_api_keys` |
| `DELETE` | `/spaces/{space_id}/api-keys/{key_id}` | `manage_api_keys` |
| `POST` | `/spaces/{space_id}/api-keys/{key_id}/regenerate` | `manage_api_keys` |

```bash
curl -X POST "localhost:8000/spaces/$SPACE/api-keys" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Website","type":"delivery","environment_ids":[]}'
# → { "token": "cms_del_…", … }   ← the ONLY time the token is returned
```

Tokens are stored as SHA-256 hashes. Lose one and you regenerate; there is no
recovery. `environment_ids: []` means all environments in the space.

---

## Webhooks (6)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/spaces/{space_id}/webhooks` | `manage_webhooks` |
| `POST` | `/spaces/{space_id}/webhooks` | `manage_webhooks` |
| `GET` | `/spaces/{space_id}/webhooks/event-types` | `manage_webhooks` |
| `PATCH` | `/spaces/{space_id}/webhooks/{webhook_id}` | `manage_webhooks` |
| `DELETE` | `/spaces/{space_id}/webhooks/{webhook_id}` | `manage_webhooks` |
| `GET` | `/spaces/{space_id}/webhooks/{webhook_id}/deliveries` | `manage_webhooks` |

Full payload shape, signing and filters: [12-webhooks.md](../12-webhooks.md).

---

## Users, roles & permissions (10)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/users` | `manage_users` |
| `POST` | `/users` | `manage_users` |
| `PATCH` | `/users/{user_id}` | `manage_users` |
| `GET` | `/roles` | — |
| `POST` | `/roles` | `manage_users` |
| `PATCH` | `/roles/{role_id}` | `manage_users` |
| `DELETE` | `/roles/{role_id}` | `manage_users` |
| `POST` | `/role-assignments` | `manage_users` |
| `DELETE` | `/role-assignments/{assignment_id}` | `manage_users` |
| `GET` | `/permissions/catalog` | — |

`POST /role-assignments` takes `{user_id, role_id, space_id?}`. Omitting
`space_id` grants the role **organization-wide**; supplying one scopes it to
that space. System roles can't be edited or deleted.

To let a user edit their own profile without `manage_users`, use
`PATCH /auth/me` instead.

---

## Accounts & invitations (6)

| Method | Path | Capability |
|---|---|---|
| `GET` | `/accounts` | — |
| `GET` | `/accounts/{account_id}/invitations` | `manage_users` |
| `POST` | `/accounts/{account_id}/invitations` | `manage_users` |
| `DELETE` | `/accounts/{account_id}/invitations/{invitation_id}` | `manage_users` |
| `GET` | `/invitations/{token}` | public |
| `POST` | `/invitations/{token}/accept` | public |

Invitations carry a role and optional space scope, are single-use, and expire.
The two token routes are public because the recipient has no account yet.

---

## Guidelines (6) · AI (7)

| Method | Path | Capability |
|---|---|---|
| `GET` `POST` `DELETE` | `/guidelines[/{id}]` | `use_ai` |
| `POST` | `/guidelines/upload` | `use_ai` |
| `POST` | `/guidelines/{guideline_id}/ingest` | `use_ai` |
| `GET` | `/guidelines/search` | `use_ai` |
| `GET` | `/ai/status` | — |
| `POST` | `/ai/generate-entry` · `/ai/transform-field` · `/ai/suggest-titles` · `/ai/seo-meta` · `/ai/translate-fields` · `/ai/check-compliance` | `use_ai` |

All AI routes return `503` when no provider is configured — the default. See
[11-ai-features.md](../11-ai-features.md).

---

## Billing (5) · Audit (2)

| Method | Path | Notes |
|---|---|---|
| `GET` | `/billing/plans` | Public plan catalogue |
| `GET` | `/billing/subscription` | Current plan, usage and limits |
| `POST` | `/billing/checkout` | Returns a Stripe URL, or activates directly in dev mode |
| `POST` | `/billing/dev-activate` | Dev-mode plan switch without Stripe |
| `POST` | `/billing/webhook` | Stripe callback — signature-verified, not for you |
| `GET` | `/audit-log` | Account-wide trail |
| `GET` | `/spaces/{space_id}/audit-log` | Space-scoped trail |

Details: [13-billing-and-usage.md](../13-billing-and-usage.md).

---

## SSO (11)

OIDC/SAML configuration per account, plus the social login callbacks:

```
GET|POST        /accounts/{account_id}/sso
PATCH|DELETE    /accounts/{account_id}/sso/{config_id}
POST            /accounts/{account_id}/sso/{config_id}/test
GET             /sso/{provider}/login   ·   /sso/{provider}/callback
```

Redirect URIs always follow `BACKEND_URL`, so each environment needs only its
own value. See [07-auth-and-permissions.md](../07-auth-and-permissions.md).

## Where to go next

- Reading content → [delivery-api.md](delivery-api.md)
- Permission model → [07-auth-and-permissions.md](../07-auth-and-permissions.md)
- Operator API → [platform-admin-api.md](platform-admin-api.md)
