/**
 * One route renders all twelve legal documents (see lib/legal.tsx).
 * Server component: the content is static, so there's no reason to ship it
 * through a client bundle.
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import Icon from '@/components/ui/Icon';
import { BRAND } from '@/lib/brand';
import { LEGAL_DOCS, LEGAL_ENTITY, getLegalDoc } from '@/lib/legal';

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ slug: d.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const doc = getLegalDoc(params.slug);
  if (!doc) return { title: `Not found — ${BRAND.name}` };
  return { title: `${doc.title} — ${BRAND.name}`, description: doc.summary };
}

export default function LegalDocPage({ params }: { params: { slug: string } }) {
  const doc = getLegalDoc(params.slug);
  if (!doc) notFound();

  return (
    <article className="prose" style={{ margin: '0 auto' }}>
      <p style={{ marginBottom: 12 }}>
        <Link href="/legal" className="small">
          <Icon name="back" size={12} /> All legal documents
        </Link>
      </p>

      <h1 style={{ marginBottom: 6 }}>{doc.title}</h1>
      <div className="doc-meta">
        Last updated {LEGAL_ENTITY.lastUpdated} · {LEGAL_ENTITY.company}
      </div>

      <p className="help-text" style={{ margin: '12px 0 20px' }}>
        <Icon name="warning" size={12} /> Template for self-hosted deployments — have
        counsel review it and replace the placeholder entity details before relying on it.
      </p>

      {doc.body}

      <hr />
      <p className="muted small">
        Questions about this document? <Link href="/support">Contact support</Link>.
      </p>
    </article>
  );
}
