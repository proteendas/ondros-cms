import type { Metadata } from 'next';

import SiteFooter from '@/components/SiteFooter';
import SiteNav from '@/components/SiteNav';
import { BRAND } from '@/lib/brand';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: `${BRAND.name} — ${BRAND.tagline}`,
    template: `%s — ${BRAND.name}`,
  },
  description:
    'Ondros CMS is an API-first headless CMS with visual editing, live preview, AI-assisted authoring, localization, and a typed SDK.',
  icons: {
    icon: [
      { url: BRAND.favicon, sizes: '32x32' },
      { url: BRAND.logoIcon, type: 'image/svg+xml' },
    ],
  },
  openGraph: {
    title: `${BRAND.name} — ${BRAND.tagline}`,
    description:
      'Model content visually, edit with live preview, generate with AI, and deliver anywhere through the Ondros SDK.',
    siteName: BRAND.name,
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
