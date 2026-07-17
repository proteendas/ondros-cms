# @acme/cms-client

Typed, zero-dependency client for the CMS **delivery** and **preview** APIs.
Use it from any frontend (Next.js, React, Remix, Node scripts, edge functions).

## Install

The SDK lives in this monorepo. Consume it directly:

```bash
npm install file:../sdk        # from a sibling app
# or copy sdk/src/index.ts into your project — it has zero dependencies
```

## Quick start

```ts
import { createClient } from '@acme/cms-client';

const client = createClient({
  baseUrl: process.env.CMS_URL!,          // e.g. http://localhost:8000
  spaceId: process.env.CMS_SPACE_ID!,
  environment: 'master',                  // optional (default: master)
  accessToken: process.env.CMS_DELIVERY_TOKEN!, // cms_del_... or cms_pre_...
});

// One entry by id
const { entry } = await client.getEntry({ id: '2b1e...' });

// Query entries
const posts = await client.getEntries({
  contentType: 'article',
  q: 'launch',
  locale: 'fr',
  order: '-published_at',
  limit: 10,
});

// Assembly pages: resolve nested references from `includes`
const page = await client.getEntryBySlug({ contentType: 'landing_page', slug: 'home', include: 2 });
const hero = page.resolve(page.entry?.fields.hero);          // linked entry
const cards = (page.entry?.fields.sections as string[]).map(page.resolve);
```

## Delivery vs preview

The same client serves both planes — behavior follows the token type:

| Token        | Sees                        | Use for                    |
|--------------|-----------------------------|----------------------------|
| `cms_del_…`  | published content only      | production sites           |
| `cms_pre_…`  | drafts + published, status  | preview deployments/editor |

Create keys under **Settings → API keys** in the editor (or `POST /spaces/{id}/api-keys`).

## Next.js example

```ts
// app/articles/[slug]/page.tsx
import { createClient } from '@acme/cms-client';

const client = createClient({
  baseUrl: process.env.CMS_URL!,
  spaceId: process.env.CMS_SPACE_ID!,
  accessToken: process.env.CMS_DELIVERY_TOKEN!,
});

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const { entry } = await client.getEntryBySlug({ contentType: 'article', slug: params.slug });
  if (!entry) return <h1>Not found</h1>;
  return (
    <article>
      <h1>{entry.fields.title as string}</h1>
      <div dangerouslySetInnerHTML={{ __html: entry.fields.body as string }} />
    </article>
  );
}
```

Localized fields arrive already resolved for the requested `locale`
(with fallback to the space's default locale). Pass `locale: '*'` to get the
raw `{ 'en-US': ..., fr: ... }` maps.
