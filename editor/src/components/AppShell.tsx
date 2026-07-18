'use client';

/**
 * Contentful-style chrome: top bar (brand, ACCOUNT switcher, space + environment
 * selectors, user menu) and left sidebar navigation. Hidden on auth pages.
 * Branding comes from lib/brand.ts (spec 007); icons from ui/Icon (spec 008).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import Icon, { IconName } from '@/components/ui/Icon';
import { setTokens, switchAccount } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { useWorkspace } from '@/lib/workspace';

const CHROME_FREE_PREFIXES = [
  '/login', '/signup', '/verify-email', '/forgot-password',
  '/reset-password', '/accept-invite', '/onboarding',
];

const NAV: { section: string; items: { href: string; icon: IconName; label: string }[] }[] = [
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
    { href: '/settings/webhooks', icon: 'webhook', label: 'Webhooks' },
    { href: '/settings/audit-log', icon: 'audit', label: 'Audit log' },
  ]},
  { section: 'Account', items: [
    { href: '/settings/roles', icon: 'users', label: 'Roles & users' },
    { href: '/settings/security', icon: 'security', label: 'Security (SSO)' },
    { href: '/settings/billing', icon: 'billing', label: 'Billing & usage' },
  ]},
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, spaces, space, environment, selectSpace, selectEnvironment } = useWorkspace();

  if (CHROME_FREE_PREFIXES.some((p) => pathname.startsWith(p))) return <>{children}</>;

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

  return (
    <div className="shell">
      <header className="topbar">
        <Link href="/" className="brand" style={{ textDecoration: 'none' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logoIcon} alt="" width={26} height={26} style={{ borderRadius: 7 }} />
          {BRAND.name}
        </Link>
        <span className="divider" />
        {accounts.length > 1 && (
          <label className="selector">
            <span className="selector-label">Account</span>
            <select
              value={user?.tenant_id ?? ''}
              onChange={(e) => void onSwitchAccount(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.is_owner ? ' ★' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="selector">
          <span className="selector-label">Space</span>
          <select
            value={space?.id ?? ''}
            onChange={(e) => selectSpace(e.target.value)}
            disabled={!spaces.length}
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="selector">
          <span className="selector-label">Env</span>
          <select
            value={environment?.key ?? ''}
            onChange={(e) => selectEnvironment(e.target.value)}
            disabled={!space}
          >
            {(space?.environments ?? []).map((env) => (
              <option key={env.id} value={env.key}>
                {env.key}
                {env.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        {user ? (
          <>
            <span className="muted" style={{ color: '#94a3b8' }}>
              {user.full_name || user.email}
            </span>
            <button className="btn secondary small" onClick={signOut}>
              Sign out
            </button>
          </>
        ) : (
          <Link href="/login" className="btn small">
            Sign in
          </Link>
        )}
      </header>

      <div className="body-wrap">
        <nav className="sidebar">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="nav-section">{group.section}</div>
              {group.items.map((item) => {
                const active =
                  pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`nav-item${active ? ' active' : ''}`}
                  >
                    <span className="nav-icon">
                      <Icon name={item.icon} size={15} />
                    </span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
