import Link from 'next/link';

import { listEntries } from '@/lib/cms';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let articles: Awaited<ReturnType<typeof listEntries>> = [];
  let pages: Awaited<ReturnType<typeof listEntries>> = [];
  let error: string | null = null;
  try {
    [articles, pages] = await Promise.all([
      listEntries('article'),
      listEntries('landing_page'),
    ]);
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to reach the CMS API';
  }

  return (
    <main className="entry listing">
      <h1>Published content</h1>
      {error && <p>⚠ {error}</p>}

      {pages.length > 0 && (
        <>
          <h2>Pages</h2>
          <ul>
            {pages.map((p) => (
              <li key={p.id}>
                <Link href={`/landing_page/${p.slug}`}>{String(p.fields.title ?? p.slug)}</Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Articles</h2>
      <ul>
        {articles.map((a) => (
          <li key={a.id}>
            <Link href={`/article/${a.slug}`}>{String(a.fields.title ?? a.slug)}</Link>
          </li>
        ))}
      </ul>
      {articles.length === 0 && pages.length === 0 && !error && (
        <p>Nothing published yet. Publish an entry from the editor, or run the seed script.</p>
      )}
    </main>
  );
}
