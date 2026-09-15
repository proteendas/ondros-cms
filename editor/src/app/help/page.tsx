/** Help centre — task-oriented entry points into the app and its docs. */
import type { Metadata } from 'next';
import Link from 'next/link';

import Icon, { type IconName } from '@/components/ui/Icon';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Help centre — ${BRAND.name}`,
  description: 'Guides for modelling, publishing, localization, API keys and more.',
};

const SECTIONS: {
  title: string;
  icon: IconName;
  items: { label: string; href: string; hint: string }[];
}[] = [
  {
    title: 'Getting started',
    icon: 'content-model',
    items: [
      { label: 'Create your first content type', href: '/content-types', hint: 'Define the shape of a page or component, field by field.' },
      { label: 'Write and publish an entry', href: '/entries', hint: 'Draft in the split view, then publish when it looks right.' },
      { label: 'Upload media', href: '/media', hint: 'Images, video and files you can reference from entries.' },
    ],
  },
  {
    title: 'Structure & localization',
    icon: 'locale',
    items: [
      { label: 'Add a language', href: '/settings/locales', hint: 'Locales, fallback chains and per-field translation.' },
      { label: 'Work with environments', href: '/settings/environments', hint: 'Clone master into staging to try schema changes safely.' },
    ],
  },
  {
    title: 'Delivering content',
    icon: 'api-key',
    items: [
      { label: 'Create an API key', href: '/settings/api-keys', hint: 'Delivery keys for public reads, preview keys for drafts.' },
      { label: 'Send webhooks', href: '/settings/webhooks', hint: 'Notify your site when content changes. Payloads are signed.' },
    ],
  },
  {
    title: 'Administration',
    icon: 'users',
    items: [
      { label: 'Invite people and set roles', href: '/settings/roles', hint: 'Five system roles, or build your own from capabilities.' },
      { label: 'Review the audit log', href: '/settings/audit-log', hint: 'Who changed what, and when.' },
      { label: 'Manage billing', href: '/settings/billing', hint: 'Plans, usage meters and limits.' },
    ],
  },
];

export default function HelpCentrePage() {
  return (
    <div style={{ maxWidth: 820 }}>
      <div className="page-header">
        <div>
          <h1>Help centre</h1>
          <p className="subtitle">Guides for the most common tasks in {BRAND.name}.</p>
        </div>
      </div>

      {SECTIONS.map((section) => (
        <section key={section.title} style={{ marginBottom: 26 }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Icon name={section.icon} size={15} /> {section.title}
          </h2>
          <div className="link-grid">
            {section.items.map((item) => (
              <Link key={item.href + item.label} href={item.href} className="link-card">
                <span className="t">{item.label}</span>
                <span className="d">{item.hint}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <section className="card profile-card">
        <h2>Still stuck?</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Send us a report with diagnostics attached — it usually saves a round trip.
        </p>
        <Link href="/support" className="btn">
          <Icon name="help" size={13} /> Contact support
        </Link>
      </section>
    </div>
  );
}
