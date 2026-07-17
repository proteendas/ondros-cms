import type { Metadata } from 'next';
import { draftMode } from 'next/headers';
import Link from 'next/link';

import { readPreviewContext } from '@/lib/previewContext';

import './globals.css';

export const metadata: Metadata = {
  title: 'Acme Site (CMS preview frontend)',
  description: 'Delivery/preview frontend for the headless CMS',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { isEnabled } = draftMode();
  const ctx = isEnabled ? readPreviewContext() : { environment: null, locale: null };
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/">Acme Site</Link>
        </header>
        {isEnabled && (
          <div className="draft-banner">
            Draft mode — viewing unpublished content
            {ctx.environment ? ` · env: ${ctx.environment}` : ''}
            {ctx.locale ? ` · ${ctx.locale}` : ''}.{' '}
            <a href="/api/exit-preview">Exit preview</a>
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
