# SDK

`@ondros/sdk` — a zero-dependency, typed TypeScript client for the delivery and
preview planes. Source in [`sdk/`](../sdk).

Zero dependencies is deliberate: it runs in Node, the browser, edge runtimes and
React Native without pulling a tree of transitive packages into your app.

## Install

```bash
npm install @ondros/sdk
```

## Create a client

```ts
import { createClient } from '@ondros/sdk';

const client = createClient({
  host: 'https://your-api.onrender.com',
  spaceId: process.env.CMS_SPACE_ID!,
  environment: 'master',
  accessToken: process.env.CMS_DELIVERY_TOKEN!,
});
```

### Configuration

| Option | Default | Notes |
|---|---|---|
| `host` | — | Delivery host, e.g. `https://cdn.yourcms.com` |
| `spaceId` | — | Required |
| `environment` | `master` | Key or UUID (`environmentId` is an alias) |
| `accessToken` | — | `cms_del_…` or `cms_pre_…` |
| `previewHost` | — | Used automatically when the token is `cms_pre_…` |
| `fetch` | global | Supply your own, e.g. Next.js `fetch` with revalidate options |
| `retries` | `3` | Retries 429/5xx/network with exponential backoff + jitter |
| `cache` | `{ ttlMs: 30000 }` | Stale-while-revalidate; `false` disables |

**Preview switching is automatic.** Pass a `cms_pre_…` token and the client
targets `previewHost` when set — so a draft-mode route needs a different token,
not different code.

## Methods

```ts
await client.getEntries({ contentType: 'article', limit: 10, order: '-publishedAt' });
await client.getEntry({ id, locale: 'fr', include: 2 });
await client.getEntryBySlug({ contentType: 'landing_page', slug: 'home', include: 2 });
await client.getAssets({ q: 'hero', limit: 20 });
await client.getAsset({ id });
```

`getEntries` accepts the same filters as the [Delivery API](06-api/delivery-api.md):
`contentType`, `slug`, `q`, `locale`, `include`, `order`, `skip`, `limit`.

## Resolving links

References come back as ids, with the resolved objects in a flat `includes`
map. Two ways to walk it:

```ts
const page = await client.getEntryBySlug({
  contentType: 'landing_page', slug: 'home', include: 2,
});

// 1. Resolve one link at a time
const hero = page.resolve(page.entry?.fields.hero);
const cards = (page.entry?.fields.cards ?? []).map(page.resolve);

// 2. Or inline every link in one go
import { resolveLinks } from '@ondros/sdk';
const full = resolveLinks(page.entry!, page.includes, 3);
// full.fields.hero is now the hero OBJECT, not an id
```

`resolveLinks` has a `maxDepth` (default 3) so a cyclic model can't produce
infinite recursion.

## Errors

```ts
import { CmsApiError } from '@ondros/sdk';

try {
  await client.getEntryBySlug({ contentType: 'article', slug: 'missing' });
} catch (err) {
  if (err instanceof CmsApiError) {
    console.error(err.status, err.message);  // 404, "Entry not found"
  }
}
```

Retries are automatic for `429` and `5xx`; a `4xx` other than 429 throws
immediately, because retrying a bad request never helps.

## Next.js

```ts
// app/[slug]/page.tsx
import { draftMode } from 'next/headers';
import { createClient } from '@ondros/sdk';

function getClient() {
  const { isEnabled } = draftMode();
  return createClient({
    host: process.env.CMS_API_URL!,
    spaceId: process.env.CMS_SPACE_ID!,
    accessToken: isEnabled
      ? process.env.CMS_PREVIEW_TOKEN!     // drafts
      : process.env.CMS_DELIVERY_TOKEN!,   // published only
    // Let Next own caching rather than the SDK's in-memory cache
    cache: false,
    fetch: (url, init) =>
      fetch(url, { ...init, next: { revalidate: isEnabled ? 0 : 60 } }),
  });
}

export default async function Page({ params }: { params: { slug: string } }) {
  const { entry, resolve } = await getClient().getEntryBySlug({
    contentType: 'landing_page', slug: params.slug, include: 2,
  });
  if (!entry) return null;
  const hero = resolve(entry.fields.hero);
  return <Hero {...hero.fields} />;
}
```

Disabling the SDK cache when Next is caching avoids two layers with different
TTLs disagreeing about freshness.

## Typed fields

Out of the box `fields` is `Record<string, unknown>`. Generate types from your
actual content model:

```bash
npx ondros-cli generate-types --out ./src/cms-types.ts
```

```ts
import type { LandingPage } from './cms-types';
const page = entry.fields as LandingPage;
```

See [15-cli.md](15-cli.md).

## Notes

- **Delivery keys are safe in a browser bundle**; preview and management keys
  are not. Keep preview fetches server-side.
- The built-in cache is per-process and in-memory — useful in a long-lived Node
  server, meaningless in a serverless function that cold-starts per request.
- One `include=2` call beats N+1 follow-ups, and counts as one API call against
  your plan.

## Where to go next

- Endpoints and parameters → [06-api/delivery-api.md](06-api/delivery-api.md)
- Type generation → [15-cli.md](15-cli.md)
- Cache invalidation → [12-webhooks.md](12-webhooks.md)
