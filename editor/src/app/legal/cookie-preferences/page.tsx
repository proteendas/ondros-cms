'use client';

/**
 * Cookie preferences.
 *
 * This app sets no advertising or analytics cookies, so there is nothing to
 * opt out of — pretending otherwise with a fake toggle would be worse than
 * useless. Instead this page shows exactly what IS stored in this browser and
 * lets you clear the optional part.
 *
 * A static route, so it wins over ../[slug] for this path.
 */
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ui';
import Icon from '@/components/ui/Icon';

interface StoredItem {
  key: string;
  label: string;
  purpose: string;
  category: 'necessary' | 'functional';
  present: boolean;
}

const TRACKED: Omit<StoredItem, 'present'>[] = [
  {
    key: 'cms_token',
    label: 'Access token',
    purpose: 'Keeps you signed in. Clearing it signs you out.',
    category: 'necessary',
  },
  {
    key: 'cms_refresh_token',
    label: 'Refresh token',
    purpose: 'Renews your session without asking you to log in again.',
    category: 'necessary',
  },
  {
    key: 'cms_space_id',
    label: 'Selected space',
    purpose: 'Reopens the space you last worked in.',
    category: 'functional',
  },
  {
    key: 'cms_env_key',
    label: 'Selected environment',
    purpose: 'Reopens the environment you last worked in.',
    category: 'functional',
  },
];

export default function CookiePreferencesPage() {
  const toast = useToast();
  const [items, setItems] = useState<StoredItem[] | null>(null);

  function read() {
    // Storage access throws in some privacy modes — never let that break the page.
    setItems(
      TRACKED.map((t) => {
        let present = false;
        try {
          present = window.localStorage.getItem(t.key) !== null;
        } catch {
          present = false;
        }
        return { ...t, present };
      }),
    );
  }

  useEffect(read, []);

  function clearFunctional() {
    try {
      window.localStorage.removeItem('cms_space_id');
      window.localStorage.removeItem('cms_env_key');
      toast('Workspace preferences cleared');
    } catch {
      toast('Your browser blocked access to local storage', 'error');
    }
    read();
  }

  return (
    <div className="prose" style={{ margin: '0 auto' }}>
      <h1 style={{ marginBottom: 6 }}>Cookie Preferences</h1>
      <div className="doc-meta">What this application stores in your browser.</div>

      <p className="lede" style={{ marginTop: 16 }}>
        There are no advertising, analytics or cross-site tracking technologies in
        this application, so there is no consent to give or withdraw. Everything
        below is either strictly necessary to sign you in, or a convenience that
        remembers where you were working.
      </p>

      <h2>Stored in this browser</h2>
      {items === null ? (
        <p className="muted">Checking…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Category</th>
              <th>Purpose</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.key}>
                <td>
                  <code>{i.key}</code>
                  <br />
                  <span className="muted small">{i.label}</span>
                </td>
                <td>
                  <span className={`chip${i.category === 'necessary' ? '' : ' primary'}`}>
                    {i.category}
                  </span>
                </td>
                <td>{i.purpose}</td>
                <td>
                  {i.present ? (
                    <span className="chip success">
                      <Icon name="check" size={10} /> set
                    </span>
                  ) : (
                    <span className="muted small">not set</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Your choices</h2>
      <p>
        Functional items can be cleared without signing you out — you&apos;ll just
        land on the default space next time. Necessary items are cleared by signing
        out, or from your browser&apos;s own settings.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '14px 0' }}>
        <button className="btn secondary" onClick={clearFunctional}>
          <Icon name="delete" size={13} /> Clear workspace preferences
        </button>
        <button className="btn secondary" onClick={read}>
          <Icon name="reload" size={13} /> Re-check
        </button>
      </div>

      <hr />
      <p className="muted small">
        Full details in the <a href="/legal/cookie-policy">Cookie Policy</a> and{' '}
        <a href="/legal/privacy-policy">Privacy Policy</a>.
      </p>
    </div>
  );
}
