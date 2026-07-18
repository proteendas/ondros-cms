/** Site-wide footer (spec 009). Social/docs links are placeholders. */
import Link from 'next/link';
import { Discord, Github, TwitterX } from 'react-bootstrap-icons';

import { APP_LOGIN_URL, BRAND } from '@/lib/brand';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="cols">
          <div>
            <Link href="/" className="brand" style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#fff', fontWeight: 700 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND.logoIcon} alt="" width={28} height={28} style={{ borderRadius: 7 }} />
              {BRAND.name}
            </Link>
            <p style={{ fontSize: 14, color: '#64748b', maxWidth: 260 }}>{BRAND.tagline}</p>
          </div>
          <div>
            <h4>Product</h4>
            <Link href="/features">Features</Link>
            <Link href="/pricing">Pricing</Link>
            <a href={APP_LOGIN_URL}>Login</a>
          </div>
          <div>
            <h4>Resources</h4>
            <Link href="/docs">Documentation</Link>
            <Link href="/docs/api">API Reference</Link>
            {/* TODO: real status destination (spec 009) */}
            <a href="#status">Status</a>
            <Link href="/support">Support</Link>
          </div>
          <div>
            <h4>Company</h4>
            <Link href="/support">Contact</Link>
            <a href="#community">Community</a>
          </div>
        </div>
        <div className="fine">
          <span>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</span>
          <div className="socials">
            {/* TODO: real social profiles (spec 009) */}
            <a href="#x" aria-label="X / Twitter"><TwitterX size={16} /></a>
            <a href="#github" aria-label="GitHub"><Github size={16} /></a>
            <a href="#discord" aria-label="Discord"><Discord size={16} /></a>
          </div>
        </div>
      </div>
    </footer>
  );
}
