/** Index of every legal document. */
import type { Metadata } from 'next';
import Link from 'next/link';

import { BRAND } from '@/lib/brand';
import { LEGAL_DOCS, LEGAL_ENTITY } from '@/lib/legal';

export const metadata: Metadata = {
  title: `Legal — ${BRAND.name}`,
  description: 'Policies, agreements and trust documents.',
};

const GROUPS = ['Policies', 'Agreements', 'Trust & safety'] as const;

export default function LegalIndexPage() {
  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1>Legal</h1>
          <p className="subtitle">
            Policies and agreements for {BRAND.name}. Last updated {LEGAL_ENTITY.lastUpdated}.
          </p>
        </div>
      </div>

      {GROUPS.map((group) => {
        const docs = LEGAL_DOCS.filter((d) => d.group === group);
        if (!docs.length) return null;
        return (
          <section key={group} style={{ marginBottom: 26 }}>
            <h2 style={{ marginBottom: 10 }}>{group}</h2>
            <div className="link-grid">
              {docs.map((d) => (
                <Link key={d.slug} href={`/legal/${d.slug}`} className="link-card">
                  <span className="t">{d.title}</span>
                  <span className="d">{d.summary}</span>
                </Link>
              ))}
              {group === 'Policies' && (
                <Link href="/legal/cookie-preferences" className="link-card">
                  <span className="t">Cookie Preferences</span>
                  <span className="d">Review and clear the data this app stores in your browser.</span>
                </Link>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
