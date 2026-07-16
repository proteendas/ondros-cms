import type { Metadata } from 'next';
import Link from 'next/link';

import './globals.css';

export const metadata: Metadata = {
  title: 'CMS Editor',
  description: 'Headless CMS visual editor',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="topnav">
          <span className="brand">CMS</span>
          <Link href="/content-types">Content types</Link>
          <Link href="/entries">Entries</Link>
          <Link href="/guidelines">Guidelines</Link>
          <span className="spacer" />
          <Link href="/login">Sign in</Link>
        </nav>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
