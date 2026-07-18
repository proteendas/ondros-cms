/** Site-wide top navigation (spec 009): logo, section links, Login CTA. */
import Link from 'next/link';

import { APP_LOGIN_URL, BRAND } from '@/lib/brand';

export default function SiteNav() {
  return (
    <header className="site-nav">
      <div className="container inner">
        <Link href="/" className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoIcon} alt={`${BRAND.short} logo`} width={30} height={30} style={{ borderRadius: 8 }} />
          {BRAND.short}
        </Link>
        <Link href="/features" className="nav-link">Features</Link>
        <Link href="/pricing" className="nav-link">Pricing</Link>
        <Link href="/support" className="nav-link">Support</Link>
        <span className="spacer" />
        <a href={APP_LOGIN_URL} className="btn small">Login</a>
      </div>
    </header>
  );
}
