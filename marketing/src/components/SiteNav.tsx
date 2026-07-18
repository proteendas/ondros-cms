'use client';

/** Site-wide top navigation (specs 009/010): logo, section links, Login CTA.
 * Collapses to an accessible hamburger sheet at ≤768px (44px tap targets). */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { List, XLg } from 'react-bootstrap-icons';

import { APP_LOGIN_URL, BRAND } from '@/lib/brand';

const LINKS = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/docs', label: 'Docs' },
  { href: '/support', label: 'Support' },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the sheet on navigation and lock body scroll while open.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header className="site-nav">
      <div className="container inner">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoIcon} alt={`${BRAND.short} logo`} width={30} height={30} style={{ borderRadius: 8 }} />
          {BRAND.short}
        </Link>
        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="nav-link">{l.label}</Link>
          ))}
        </nav>
        <span className="spacer" />
        <a href={APP_LOGIN_URL} className="btn small nav-login">Login</a>
        <button
          className="nav-burger"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <XLg size={20} /> : <List size={22} />}
        </button>
      </div>
      {open && (
        <nav className="nav-sheet" aria-label="Mobile">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="sheet-link">{l.label}</Link>
          ))}
          <a href={APP_LOGIN_URL} className="btn" style={{ justifyContent: 'center', marginTop: 10 }}>
            Login
          </a>
        </nav>
      )}
    </header>
  );
}
