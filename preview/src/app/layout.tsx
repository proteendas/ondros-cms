import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { draftMode } from 'next/headers';
import Link from 'next/link';

import { readPreviewContext } from '@/lib/previewContext';

// Bootstrap Icons webfont — every <Icon> renders `<i class="bi bi-…">`.
import 'bootstrap-icons/font/bootstrap-icons.css';

import './globals.css';

// Brand typography — matches the marketing site (ondros-cms-site): Plus Jakarta
// Sans for UI, JetBrains Mono for code/ids. The woff2 files are vendored in
// ./fonts (see its README) and loaded with next/font/local, so the build is
// hermetic — no fonts.googleapis.com fetch that Docker/offline CI can't make.
const sans = localFont({
  src: './fonts/PlusJakartaSans-Variable.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-sans',
});

const mono = localFont({
  src: './fonts/JetBrainsMono-Variable.woff2',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-mono',
});

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export const metadata: Metadata = {
  title: 'Acme Site (CMS preview frontend)',
  description: 'Delivery/preview frontend for the headless CMS',
};

// Without this, mobile browsers render at a 980px virtual width and scale
// down — every layout below looks correct but is unusably small.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const { isEnabled } = draftMode();
  const ctx = isEnabled ? readPreviewContext() : { environment: null, locale: null };
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
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
        {/* Ondros Universal Editor bridge — the same script a connected
            project includes (docs/20-code-sync.md). It no-ops unless the page
            is open inside the editor, so it is safe on production pages. */}
        <script src={`${API_URL}/code-sync/ondros-editor.js`} defer />
      </body>
    </html>
  );
}
