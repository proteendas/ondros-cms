/**
 * Compact legal link row for unauthenticated pages (login, signup, reset…),
 * where there is no app chrome to carry these links.
 */
import Link from 'next/link';

import { LEGAL_DOCS, PRIMARY_LEGAL } from '@/lib/legal';

export default function LegalFooter() {
  const docs = PRIMARY_LEGAL.map((slug) => LEGAL_DOCS.find((d) => d.slug === slug)!).filter(Boolean);
  return (
    <nav className="legal-footer" aria-label="Legal">
      {docs.map((d) => (
        <Link key={d.slug} href={`/legal/${d.slug}`}>{d.title}</Link>
      ))}
      <Link href="/legal">All policies</Link>
      <Link href="/support">Support</Link>
    </nav>
  );
}
