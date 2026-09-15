'use client';

/** Sidebar shell + auth gate: children render only for verified platform
 * admins (spec 013); anyone else is bounced to /login. */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Icon, { type IconName } from '@/components/Icon';
import { api, clearTokens, getAccess } from '@/lib/api';

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: '/', label: 'Overview', icon: 'overview' },
  { href: '/accounts', label: 'Accounts', icon: 'accounts' },
  { href: '/users', label: 'Users', icon: 'users' },
  { href: '/revenue', label: 'Revenue', icon: 'revenue' },
  { href: '/usage', label: 'Usage & limits', icon: 'usage' },
  { href: '/health', label: 'System health', icon: 'health' },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<{ email: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!getAccess()) {
      router.replace('/login');
      return;
    }
    api<{ email: string }>('/platform/me')
      .then((res) => {
        setMe(res);
        setReady(true);
      })
      .catch(() => {
        clearTokens();
        router.replace('/login');
      });
  }, [router]);

  // Opening a page should dismiss the drawer, not leave it covering the page.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (!ready) {
    return <div className="login-wrap"><p className="muted">Checking access…</p></div>;
  }

  return (
    <div className="shell">
      {/* Mobile only (<800px): the sidebar collapses behind this bar. */}
      <header className="sa-topbar">
        <button
          className="sa-burger"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="sa-sidebar"
          onClick={() => setNavOpen((o) => !o)}
        >
          <Icon name={navOpen ? 'close' : 'menu'} size={18} />
        </button>
        <span className="sa-topbar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/logo-icon.svg" alt="" width={22} height={22} style={{ borderRadius: 6 }} />
          Ondros <span className="muted">admin</span>
        </span>
        <span className="spacer" />
        <button
          className="sa-icon-btn"
          title="Sign out"
          aria-label="Sign out"
          onClick={() => {
            clearTokens();
            router.replace('/login');
          }}
        >
          <Icon name="sign-out" size={16} />
        </button>
      </header>

      {navOpen && <div className="sa-scrim" onClick={() => setNavOpen(false)} aria-hidden />}

      <aside id="sa-sidebar" className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/branding/logo-icon.svg" alt="Ondros logo" width={26} height={26} style={{ borderRadius: 7 }} />
          <span>
            Ondros
            <span className="sub">Platform admin</span>
          </span>
        </div>
        {NAV.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
              <Icon name={item.icon} size={15} /> {item.label}
            </Link>
          );
        })}
        <button
          className="btn ghost small"
          style={{ margin: '14px 12px 0', justifyContent: 'center' }}
          onClick={() => {
            clearTokens();
            router.replace('/login');
          }}
        >
          <Icon name="sign-out" size={13} /> Sign out
        </button>
        <div className="foot">{me?.email}</div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
