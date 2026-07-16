import Link from 'next/link';

import { listPublished } from '@/lib/cms';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let articles: Awaited<ReturnType<typeof listPublished>> = [];
  let error: string | null = null;
  try {
    articles = await listPublished('article');
  } catch (e) {
    error = e instanceof Error ? e.message : 'Failed to reach the CMS API';
  }

  return (
    <main className="entry listing">
      <h1>Published articles</h1>
      {error && <p>⚠ {error}</p>}
      <ul>
        {articles.map((a) => (
          <li key={a.id}>
            <Link href={`/article/${a.slug}`}>{String(a.fields.title ?? a.slug)}</Link>
          </li>
        ))}
      </ul>
      {articles.length === 0 && !error && (
        <p>No published articles yet. Publish one from the editor, or run the seed script.</p>
      )}
    </main>
  );
}
