'use client';

/**
 * Contentful-style chrome: top bar (brand, ACCOUNT switcher, space + environment
 * selectors, user menu) and left sidebar navigation. Hidden on auth pages.
 * Branding comes from lib/brand.ts (spec 007); icons from ui/Icon (spec 008).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import Icon, { IconName } from '@/components/ui/Icon';
import Select from '@/components/ui/Select';
import { setTokens, switchAccount } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { useWorkspace } from '@/lib/workspace';

/** Routes that NEVER show app chrome — the unauthenticated flows. */
const CHROME_FREE_PREFIXES = [
  '/login', '/signup', '/verify-email', '/forgot-password',
  '/reset-password', '/accept-invite', '/onboarding',
  // Full-screen preview: the whole window belongs to the previewed site.
  '/preview',
];

/**
 * Routes readable without an account. Signed-in users get the normal chrome
 * (so they can navigate back); signed-out visitors get a clean standalone
 * document with no sidebar or workspace pickers to tease them with.
 */
const PUBLIC_PREFIXES = ['/legal', '/support', '/help', '/403', '/maintenance', '/offline', '/session-expired'];

const NAV_PINNED_KEY = 'cms_nav_pinned';

const NAV: {
  section: string;
  items: { href: string; icon: IconName; label: string; exact?: boolean }[];
}[] = [
  { section: 'Content', items: [
    { href: '/content-types', icon: 'content-model', label: 'Content model' },
    { href: '/entries', icon: 'content', label: 'Content' },
    { href: '/media', icon: 'media', label: 'Media' },
    { href: '/guidelines', icon: 'guidelines', label: 'Guidelines' },
  ]},
  { section: 'Space settings', items: [
    { href: '/settings/locales', icon: 'locale', label: 'Locales' },
    { href: '/settings/api-keys', icon: 'api-key', label: 'API keys' },
    { href: '/settings/environments', icon: 'environment', label: 'Environments' },
    { href: '/settings/code-sync', icon: 'code-sync', label: 'Code Sync' },
    { href: '/settings/webhooks', icon: 'webhook', label: 'Webhooks' },
    { href: '/settings/audit-log', icon: 'audit', label: 'Audit log' },
  ]},
  { section: 'Account', items: [
    { href: '/settings/roles', icon: 'users', label: 'Roles & users' },
    { href: '/settings/security', icon: 'security', label: 'Security (SSO)' },
    { href: '/settings/billing', icon: 'billing', label: 'Billing & usage' },
  ]},
  { section: 'Workspace', items: [
    // exact: otherwise it lights up on every /settings/* sub-page too.
    { href: '/settings', icon: 'security', label: 'All settings', exact: true },
    { href: '/help', icon: 'guidelines', label: 'Help centre' },
    { href: '/support', icon: 'help', label: 'Support' },
  ]},
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, spaces, space, environment, selectSpace, selectEnvironment } = useWorkspace();
  const [navOpen, setNavOpen] = useState(false);
  // Desktop sidebar: an icon rail that opens on hover, or stays open when
  // pinned. Starts collapsed and reads the stored choice after mount — doing
  // it during render would not match what the server sent.
  const [navPinned, setNavPinned] = useState(false);

  useEffect(() => {
    try {
      setNavPinned(window.localStorage.getItem(NAV_PINNED_KEY) === '1');
    } catch {
      /* private mode / blocked storage: the rail just stays unpinned */
    }
  }, []);

  function toggleNavPinned() {
    setNavPinned((was) => {
      const next = !was;
      try {
        window.localStorage.setItem(NAV_PINNED_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Navigating on mobile should dismiss the drawer, not leave it covering the
  // page you just opened. Declared before the early return below so the hook
  // order stays stable on chrome-free routes.
  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  if (CHROME_FREE_PREFIXES.some((p) => pathname.startsWith(p))) return <>{children}</>;

  // On public routes the chrome depends on who's asking. `user` is null while
  // /auth/me is still in flight, which is the correct default here: a visitor
  // should never see a flash of an app shell they have no access to.
  if (!user && PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return (
      <div className="public-shell">
        <header className="public-topbar">
          <Link href="/login" className="brand" style={{ textDecoration: 'none' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logoIcon} alt="" width={24} height={24} style={{ borderRadius: 6 }} />
            {BRAND.name}
          </Link>
          <span className="spacer" />
          <Link href="/login" className="btn secondary small">Sign in</Link>
        </header>
        <main className="public-content">{children}</main>
        <footer className="public-foot">
          <Link href="/legal/privacy-policy">Privacy</Link>
          <Link href="/legal/terms-of-service">Terms</Link>
          <Link href="/legal">All policies</Link>
          <Link href="/support">Support</Link>
        </footer>
      </div>
    );
  }

  function signOut() {
    setTokens(null, null);
    router.push('/login');
  }

  async function onSwitchAccount(accountId: string) {
    if (!accountId || accountId === user?.tenant_id) return;
    await switchAccount(accountId);
    window.localStorage.removeItem('cms_space_id');
    window.localStorage.removeItem('cms_env_key');
    window.location.href = '/'; // reboot the workspace under the new account
  }

  const accounts = user?.accounts ?? [];

  // Rendered twice: in the topbar on desktop, inside the drawer on mobile.
  // CSS decides which copy is visible; both drive the same workspace state.
  const pickers = (
    <>
          {accounts.length > 1 && (
            <span className="selector">
              <span className="selector-label">Account</span>
              <Select
                variant="chrome"
                ariaLabel="Account"
                value={user?.tenant_id ?? ''}
                onChange={(v) => void onSwitchAccount(v)}
                options={accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  icon: a.is_owner ? ('star' as const) : undefined,
                  iconTitle: a.is_owner ? 'You own this account' : undefined,
                }))}
              />
            </span>
          )}
          <span className="selector">
            <span className="selector-label">Space</span>
            <Select
              variant="chrome"
              ariaLabel="Space"
              placeholder="No spaces"
              value={space?.id ?? ''}
              onChange={selectSpace}
              disabled={!spaces.length}
              options={spaces.map((s) => ({ value: s.id, label: s.name }))}
            />
          </span>
          <span className="selector">
            <span className="selector-label">Env</span>
            <Select
              variant="chrome"
              ariaLabel="Environment"
              placeholder="No environment"
              value={environment?.key ?? ''}
              onChange={selectEnvironment}
              disabled={!space}
              options={(space?.environments ?? []).map((env) => ({
                value: env.key,
                label: `${env.key}${env.is_default ? ' (default)' : ''}`,
              }))}
            />
          </span>
    </>
  );

  return (
    <div className={`shell${navPinned ? ' nav-pinned' : ''}`}>
      <header className="topbar">
        {/* Mobile only: toggles the sidebar drawer (hidden at >=900px). */}
        <button
          className="topbar-burger"
          aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen}
          aria-controls="app-sidebar"
          onClick={() => setNavOpen((o) => !o)}
        >
          <Icon name={navOpen ? 'close' : 'menu'} size={18} />
        </button>
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoIcon} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
          {BRAND.name}
        </Link>
        <span className="divider" />
        <div className="topbar-pickers">{pickers}</div>
        <span className="spacer" />
        {user ? (
          <>
            <Link
              href="/profile"
              className={`topbar-user${pathname === '/profile' ? ' active' : ''}`}
              title="User profile"
            >
              <span className="topbar-avatar" aria-hidden>
                {(user.full_name || user.email).trim().charAt(0).toUpperCase()}
              </span>
              {/* Name is hidden below 900px — the avatar carries the meaning there. */}
              <span className="topbar-user-name">{user.full_name || user.email}</span>
            </Link>
            <Link href="/support" className="topbar-icon-btn" title="Help and support" aria-label="Help and support">
              <Icon name="help" size={17} />
            </Link>
            <button
              className="topbar-icon-btn"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
            >
              <Icon name="sign-out" size={16} />
            </button>
          </>
        ) : (
          <Link href="/login" className="btn small">
            Sign in
          </Link>
        )}
      </header>

      <div className="body-wrap">
        {navOpen && (
          <div className="sidebar-scrim" onClick={() => setNavOpen(false)} aria-hidden />
        )}
        <nav id="app-sidebar" className={`sidebar${navOpen ? ' open' : ''}`}>
          {/* Below 900px the topbar has no room for these, so they live here. */}
          <div className="drawer-pickers">{pickers}</div>
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                  >
                    <span className="nav-icon">
                      <Icon name={item.icon} size={15} />
                    </span>
                    <span className="nav-label">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
          {/* Desktop only (CSS): keeps the menu open instead of collapsing
              back to the rail when the pointer leaves. */}
          <button
            type="button"
            className="nav-pin"
            onClick={toggleNavPinned}
            aria-pressed={navPinned}
            title={navPinned ? 'Unpin the menu' : 'Keep the menu open'}
          >
            <span className="nav-icon">
              <Icon name={navPinned ? 'pin-filled' : 'pin'} size={15} />
            </span>
            <span className="nav-label">{navPinned ? 'Unpin menu' : 'Pin menu'}</span>
          </button>
          <div className="sidebar-foot">
            <Link href="/legal/privacy-policy">Privacy</Link>
            <Link href="/legal/terms-of-service">Terms</Link>
            <Link href="/legal">Legal</Link>
          </div>
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
