import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Ondros Platform Admin',
    template: '%s — Ondros Platform Admin',
  },
  description: 'Operator dashboard for the Ondros CMS platform.',
  icons: {
    icon: [
      { url: '/branding/favicon.ico', sizes: '32x32' },
      { url: '/branding/logo-icon.svg', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
