# Delivery & Preview API

The read-only plane your website talks to. Five endpoints, no writes, and the
one you reach for in 95% of cases is the first.

**Base path**

```
/spaces/{space_id}/environments/{environment}/delivery
```

`{environment}` takes the key (`master`) or its UUID. Use the key.

## Delivery vs preview

Identical endpoints; the **key type decides what comes back**.

| | `cms_del_…` (delivery) | `cms_pre_…` (preview) |
|---|---|---|
| Entries returned | `status = published` only | Everything except `archived` |
| Field source | `published_fields` (frozen at publish) | `fields` (live draft) |
| `status` in the response | omitted | included |
| Safe in a browser bundle | **Yes** | No — exposes unpublished work |

That difference is the whole reason two key types exist. A delivery key can
only ever return content you have already chosen to publish.

## Authentication

```bash
# Preferred
curl "…/delivery/entries" -H "Authorization: Bearer cms_del_…"

# For contexts that can't set headers
curl "…/delivery/entries?access_token=cms_del_…"
```

Query tokens land in server logs, browser history and `Referer` headers — use
the header unless you genuinely can't.

Keys can be scoped to specific environments (`environment_ids`); an empty list
means all environments in the space. A disabled or revoked key returns `401`.

---

## `GET /delivery/entries`

List entries, with filtering, ordering, pagination and link resolution.

### Query parameters

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `content_type` | string | — | Filter by `api_id`, e.g. `landing_page` |
| `slug` | string | — | Exact match. Combine with `content_type` for a page lookup. Only types that model a `slug` field have one |
| `q` | string | — | Free-text search across field values |
| `locale` | string | space default | Locale code, or `*` for raw per-locale maps |
| `include` | int 0–3 | `1` | Depth of reference resolution |
| `order` | string | `-published_at` | Prefix `-` for descending |
| `skip` | int | `0` | Offset |
| `limit` | int 1–200 | `50` | Page size |

### Response

```json
{
  "items": [
    {
      "id": "b18c1722-…",
      "slug": "home",
      "version": 1,
      "createdAt": "2026-09-15T18:22:10Z",
      "updatedAt": "2026-09-15T18:22:10Z",
      "publishedAt": "2026-09-15T18:22:10Z",
      "contentType": { "apiId": "landing_page", "name": "Landing Page", "displayField": "title", "slugField": "slug", "fields": [...] },
      "fields": { "title": "Welcome", "hero": "9f2c…", "cards": ["a1…", "b2…"] }
    }
  ],
  "total": 1,
  "skip": 0,
  "limit": 50,
  "includes": { "Entry": [...], "Asset": [...] }
}
```

`slug` is `null`, and `contentType.slugField` is `null`, for reusable block
types (`hero`, `card`) — they model no slug field, so they have no URL of their
own and should be rendered inside the page that references them rather than
linked to.

Note that `fields.hero` is an **id**, not a nested object. Resolved entries and
assets live in `includes`.

### Link resolution

`include` controls how many levels of references are followed. Resolution is
breadth-first into a **flat map**, not nested objects:

```mermaid
flowchart LR
    LP["landing_page<br/><i>items[0]</i>"] -->|"hero: id"| H["hero<br/><i>includes.Entry</i>"]
    LP -->|"cards: [id, id]"| C1["card"]
    LP -->|"cards"| C2["card"]
    H -->|"image: id"| A["asset<br/><i>includes.Asset</i>"]
```

Flat means an entry referenced by five others is serialized **once**. Resolve a
link by looking its id up in `includes`:

```ts
const byId = Object.fromEntries(res.includes.Entry.map((e) => [e.id, e]));
const hero = byId[page.fields.hero];
```

The SDK's `resolve()` does exactly this — see [14-sdk.md](../14-sdk.md).

**Limits, and why they exist.** `include` is capped at **3** and a single
response at **200 included entities**. Each depth level costs one more round of
queries, so `include=3` is three sequential rounds. A cyclic model (page → hero
→ page) terminates on the depth cap rather than looping.

### Locales

Localized fields are stored as `{locale: value}` maps. `?locale=` resolves them
to plain values, walking the fallback chain:

```mermaid
flowchart LR
    REQ["?locale=fr-CA"] --> A{"fr-CA<br/>has a value?"}
    A -->|yes| OUT["return it"]
    A -->|no| B{"fallback:<br/>fr has one?"}
    B -->|yes| OUT
    B -->|no| C["space default<br/>(en-US)"]
    C --> OUT
```

Chains can be several hops; a `visited` set stops a mis-configured loop. Pass
`locale=*` to skip resolution entirely and receive the raw maps — useful for
translation tooling.

### Examples

```bash
BASE="http://localhost:8000/spaces/$SPACE/environments/master/delivery"
AUTH="Authorization: Bearer cms_del_dev-delivery-token-0000"

# One page by slug, with its hero and cards resolved, in French
curl "$BASE/entries?content_type=landing_page&slug=home&include=2&locale=fr" -H "$AUTH"

# Newest 10 articles
curl "$BASE/entries?content_type=article&order=-published_at&limit=10" -H "$AUTH"

# Search
curl "$BASE/entries?q=pricing" -H "$AUTH"

# Raw locale maps for a translation pass
curl "$BASE/entries?content_type=article&locale=*" -H "$AUTH"
```

---

## `GET /delivery/entries/{entry_id}`

A single entry by id. Takes `locale` and `include` with the same meaning.
Returns `404` if the id doesn't exist **or** the key can't see it — a delivery
key asking for a draft gets `404`, not `403`, so it can't be used to probe for
unpublished content.

---

## `GET /delivery/assets`

| Parameter | Type | Default |
|---|---|---|
| `q` | string | — |
| `skip` | int | `0` |
| `limit` | int | `50` |

Returns asset metadata — `url`, `mime_type`, `size_bytes`, `width`, `height`,
`title`, `alt_text`, `tags`. Files are served from `/files/…`.

## `GET /delivery/assets/{asset_id}`

A single asset by id.

---

## `GET /token-info`

Resolves a delivery or preview token to the space and environments it can
reach, so a consuming app can bootstrap from **only a token** rather than
hard-coding space UUIDs in its config.

```bash
curl "http://localhost:8000/token-info" -H "Authorization: Bearer cms_pre_…"
```

This is how `preview/` finds its space without a `CMS_SPACE_ID` variable.

---

## Caching and performance

- Responses carry no cache headers; put a CDN in front and key on the full URL
  including query string.
- Use webhooks to invalidate on publish rather than polling — see
  [12-webhooks.md](../12-webhooks.md).
- Prefer one `include=2` request over N+1 follow-up fetches.
- Delivery counts toward your plan's API-call meter; exceeding it returns
  `429`. See [13-billing-and-usage.md](../13-billing-and-usage.md).

## Errors

| Code | Meaning |
|---|---|
| 401 | Missing, invalid, disabled or revoked key |
| 403 | Key is valid but not scoped to this environment; or the account is suspended |
| 404 | No such space/environment/entry, or not visible to this key type |
| 422 | Bad parameter, e.g. `include=9` |
| 429 | Plan API-call limit exceeded |

## Where to go next

- The typed client → [14-sdk.md](../14-sdk.md)
- Creating keys → [management-api.md](management-api.md)
- Cache invalidation → [12-webhooks.md](../12-webhooks.md)
