import Link from 'next/link';

export default function HomePage() {
  return (
    <div>
      <h1>CMS Editor</h1>
      <div className="card">
        <p>
          Sign in with the seeded account (<code>admin@example.com</code> / <code>admin123</code>),
          then:
        </p>
        <ul>
          <li>
            <Link href="/content-types">Content types</Link> — model your content (field builder)
          </li>
          <li>
            <Link href="/entries">Entries</Link> — create and edit content with live preview and the
            AI sidebar
          </li>
          <li>
            <Link href="/guidelines">Guidelines</Link> — manage the brand/editorial docs that power
            guideline-aware AI
          </li>
        </ul>
      </div>
    </div>
  );
}
