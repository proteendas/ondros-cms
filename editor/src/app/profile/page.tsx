'use client';

/**
 * User profile — the signed-in user's own account settings.
 *
 * Deliberately self-service: every section here works for ANY role, because it
 * acts on `/auth/me` rather than the admin `/users/{id}` endpoints that are
 * gated on MANAGE_USERS. An author with no admin rights can still rename
 * themselves and rotate their password.
 *
 * Organization-level settings (members, roles, SSO, billing) live under
 * /settings and stay admin-gated.
 */
import { useEffect, useState } from 'react';

import Link from 'next/link';

import { formatDate, useToast } from '@/components/ui';
import Icon from '@/components/ui/Icon';
import { api, switchAccount } from '@/lib/api';
import { LEGAL_DOCS, LEGAL_ENTITY } from '@/lib/legal';
import { useWorkspace } from '@/lib/workspace';
import type { CurrentUser } from '@/lib/types';
import PasswordInput from '@/components/ui/PasswordInput';

function initials(user: CurrentUser): string {
  const source = (user.full_name || user.email).trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export default function ProfilePage() {
  const toast = useToast();
  const { user, refresh, loading } = useWorkspace();

  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <p className="muted">Sign in to view your profile.</p>;

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1>User profile</h1>
          <p className="subtitle">
            Your personal account. Organization settings live under Settings.
          </p>
        </div>
      </div>

      <AccountSection user={user} refresh={refresh} toast={toast} />
      <PasswordSection toast={toast} />
      <OrganizationsSection user={user} />
      <AccessSection user={user} />
      <SessionsSection toast={toast} />
      <LegalSection />
    </div>
  );
}

/* ---- Account ------------------------------------------------------------- */

function AccountSection({
  user,
  refresh,
  toast,
}: {
  user: CurrentUser;
  refresh: () => Promise<void>;
  toast: (m: string, k?: 'info' | 'error') => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(user.full_name);
  const [busy, setBusy] = useState(false);

  useEffect(() => setFullName(user.full_name), [user.full_name]);

  async function save() {
    const name = fullName.trim();
    if (!name) {
      toast('Name cannot be empty', 'error');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ full_name: name }) });
      await refresh();
      setEditing(false);
      toast('Profile updated');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update profile', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card profile-card">
      <h2>Account</h2>

      <div className="profile-identity">
        <div className="profile-avatar" aria-hidden>{initials(user)}</div>
        <div style={{ minWidth: 0 }}>
          {editing ? (
            <div className="row" style={{ gap: 8 }}>
              <input
                className="input"
                value={fullName}
                autoFocus
                maxLength={200}
                onChange={(e) => setFullName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                  if (e.key === 'Escape') { setFullName(user.full_name); setEditing(false); }
                }}
                style={{ maxWidth: 280 }}
              />
              <button className="btn small" disabled={busy} onClick={() => void save()}>
                {busy ? '…' : 'Save'}
              </button>
              <button
                className="btn secondary small"
                onClick={() => { setFullName(user.full_name); setEditing(false); }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="profile-name">{user.full_name || '—'}</div>
              <div className="muted">
                {user.email}{' '}
                {user.email_verified ? (
                  <span className="chip success">
                    <Icon name="check" size={10} /> verified
                  </span>
                ) : (
                  <span className="chip warn">
                    <Icon name="warning" size={10} /> unverified
                  </span>
                )}
              </div>
            </>
          )}
        </div>
        {!editing && (
          <button className="btn secondary small" style={{ marginLeft: 'auto' }} onClick={() => setEditing(true)}>
            <Icon name="edit" size={13} /> Edit name
          </button>
        )}
      </div>

      <dl className="profile-meta">
        <dt>Member since</dt>
        <dd>{formatDate(user.created_at)}</dd>
        <dt>User ID</dt>
        <dd><code>{user.id}</code></dd>
      </dl>

      <p className="help-text">
        Your email address is used to sign in and can&apos;t be changed here —
        ask an organization admin if it needs updating.
      </p>
    </section>
  );
}

/* ---- Password ------------------------------------------------------------ */

function PasswordSection({ toast }: { toast: (m: string, k?: 'info' | 'error') => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  function reset() {
    setCurrent(''); setNext(''); setConfirm(''); setOpen(false);
  }

  async function submit() {
    if (next.length < 8) return toast('New password must be at least 8 characters', 'error');
    if (next !== confirm) return toast('New passwords do not match', 'error');
    setBusy(true);
    try {
      const res = await api<{ detail: string }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      toast(res.detail || 'Password updated');
      reset();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change password', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card profile-card">
      <h2>Password</h2>
      {!open ? (
        <div className="row">
          <p className="muted" style={{ margin: 0 }}>
            Changing your password signs out every other device.
          </p>
          <span className="spacer" />
          <button className="btn secondary small" onClick={() => setOpen(true)}>
            <Icon name="lock" size={13} /> Change password
          </button>
        </div>
      ) : (
        <>
          <label className="field-label">Current password</label>
          <PasswordInput value={current} autoFocus autoComplete="current-password"
                         onChange={setCurrent} />

          <label className="field-label">New password</label>
          <PasswordInput value={next} autoComplete="new-password" minLength={8}
                         onChange={setNext} />
          <p className="help-text">At least 8 characters.</p>

          <label className="field-label">Confirm new password</label>
          <PasswordInput value={confirm} autoComplete="new-password"
                         onChange={setConfirm}
                         onKeyDown={(e) => e.key === 'Enter' && void submit()} />

          <div className="modal-footer">
            <button className="btn secondary" onClick={reset}>Cancel</button>
            <button className="btn" disabled={busy || !current || !next} onClick={() => void submit()}>
              {busy ? '…' : 'Update password'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ---- Organizations ------------------------------------------------------- */

function OrganizationsSection({ user }: { user: CurrentUser }) {
  const [switching, setSwitching] = useState<string | null>(null);

  async function go(accountId: string) {
    setSwitching(accountId);
    await switchAccount(accountId);
    window.localStorage.removeItem('cms_space_id');
    window.localStorage.removeItem('cms_env_key');
    window.location.href = '/'; // reboot the workspace under the new account
  }

  return (
    <section className="card profile-card">
      <h2>Organizations</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Accounts you belong to. Your roles and content are scoped to the active one.
      </p>
      <div className="profile-list">
        {user.accounts.map((a) => (
          <div key={a.id} className="profile-row">
            <div style={{ minWidth: 0 }}>
              <div className="profile-row-title">
                {a.name}
                {a.is_owner && (
                  <span className="chip"><Icon name="star" size={10} /> owner</span>
                )}
                {a.is_active && <span className="chip primary">active</span>}
              </div>
              <div className="muted"><code>{a.slug}</code></div>
            </div>
            <span className="spacer" />
            {!a.is_active && (
              <button
                className="btn secondary small"
                disabled={switching !== null}
                onClick={() => void go(a.id)}
              >
                {switching === a.id ? '…' : 'Switch to'}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---- Roles & permissions ------------------------------------------------- */

function AccessSection({ user }: { user: CurrentUser }) {
  const orgWide = user.roles.filter((r) => !r.space_id);
  const perSpace = user.roles.filter((r) => r.space_id);

  return (
    <section className="card profile-card">
      <h2>Roles &amp; permissions</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        What you can do in the active organization. Only an admin can change these.
      </p>

      <label className="field-label">Roles</label>
      {user.roles.length === 0 ? (
        <p className="muted">No roles assigned.</p>
      ) : (
        <div className="f-flags" style={{ flexWrap: 'wrap' }}>
          {orgWide.map((r) => (
            <span key={`org-${r.role_name}`} className="chip primary">
              {r.role_name} · organization-wide
            </span>
          ))}
          {perSpace.map((r) => (
            <span key={`sp-${r.role_name}-${r.space_id}`} className="chip">
              {r.role_name} · one space
            </span>
          ))}
        </div>
      )}

      <label className="field-label">Capabilities</label>
      {user.capabilities.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <div className="f-flags" style={{ flexWrap: 'wrap' }}>
          {user.capabilities.map((c) => (
            <span key={c} className="chip">{c.replace(/_/g, ' ')}</span>
          ))}
        </div>
      )}
      <p className="help-text">
        Space-scoped permissions are always re-checked on the server per request.
      </p>
    </section>
  );
}

/* ---- Sessions ------------------------------------------------------------ */

function SessionsSection({ toast }: { toast: (m: string, k?: 'info' | 'error') => void }) {
  const [busy, setBusy] = useState(false);

  async function signOutEverywhere() {
    setBusy(true);
    try {
      const res = await api<{ detail: string }>('/auth/sign-out-everywhere', { method: 'POST' });
      toast(res.detail || 'Signed out everywhere');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not sign out sessions', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card profile-card">
      <h2>Sessions</h2>
      <div className="row">
        <p className="muted" style={{ margin: 0, maxWidth: 440 }}>
          Revoke every saved session on all devices. You&apos;ll stay signed in here
          until this browser tab&apos;s token expires.
        </p>
        <span className="spacer" />
        <button className="btn secondary small" disabled={busy} onClick={() => void signOutEverywhere()}>
          {busy ? '…' : 'Sign out everywhere'}
        </button>
      </div>
    </section>
  );
}

/* ---- Legal & privacy ----------------------------------------------------- */

function LegalSection() {
  return (
    <section className="card profile-card">
      <h2>Legal &amp; privacy</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        The policies that govern your account, and the controls you have over your
        data.
      </p>

      <div className="link-grid">
        {LEGAL_DOCS.map((d) => (
          <Link key={d.slug} href={`/legal/${d.slug}`} className="link-card">
            <span className="t">{d.title}</span>
            <span className="d">{d.summary}</span>
          </Link>
        ))}
        <Link href="/legal/cookie-preferences" className="link-card">
          <span className="t">Cookie preferences</span>
          <span className="d">See and clear what this app stores in your browser.</span>
        </Link>
      </div>

      <dl className="profile-meta" style={{ marginTop: 26 }}>
        <dt>Privacy enquiries</dt>
        <dd><a href={`mailto:${LEGAL_ENTITY.privacyEmail}`}>{LEGAL_ENTITY.privacyEmail}</a></dd>
        <dt>Security reports</dt>
        <dd><a href={`mailto:${LEGAL_ENTITY.securityEmail}`}>{LEGAL_ENTITY.securityEmail}</a></dd>
        <dt>Support</dt>
        <dd><Link href="/support">Report a bug or ask a question</Link></dd>
      </dl>

      <p className="help-text">
        To export or delete your personal data, email{' '}
        <a href={`mailto:${LEGAL_ENTITY.privacyEmail}`}>{LEGAL_ENTITY.privacyEmail}</a> —
        see the <Link href="/legal/privacy-policy">Privacy Policy</Link> for what
        we hold and how long.
      </p>
    </section>
  );
}
