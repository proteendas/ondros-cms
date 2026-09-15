'use client';

/**
 * Settings hub.
 *
 * `/settings/*` sub-pages existed but `/settings` itself 404'd, so there was no
 * single place that showed everything configurable. This is that index — plus
 * General space settings (rename / delete), which previously had no home in the
 * UI at all despite the API supporting them.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { ConfirmDialog, useToast } from '@/components/ui';
import Icon, { type IconName } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

interface SettingsLink {
  href: string;
  icon: IconName;
  label: string;
  hint: string;
  /** Capability needed to do anything useful there. */
  capability?: string;
}

const SPACE_SETTINGS: SettingsLink[] = [
  { href: '/settings/locales', icon: 'locale', label: 'Locales', hint: 'Languages, fallback chains and the default locale.', capability: 'manage_settings' },
  { href: '/settings/environments', icon: 'environment', label: 'Environments', hint: 'Clone master into staging; pick the default environment.', capability: 'manage_environments' },
  { href: '/settings/api-keys', icon: 'api-key', label: 'API keys', hint: 'Delivery, preview and management tokens.', capability: 'manage_api_keys' },
  { href: '/settings/webhooks', icon: 'webhook', label: 'Webhooks', hint: 'Notify your systems when content changes.', capability: 'manage_webhooks' },
  { href: '/settings/audit-log', icon: 'audit', label: 'Audit log', hint: 'Who changed what, and when.' },
];

const ACCOUNT_SETTINGS: SettingsLink[] = [
  { href: '/settings/roles', icon: 'users', label: 'Roles & users', hint: 'Invite people, assign roles, build custom roles.', capability: 'manage_users' },
  { href: '/settings/security', icon: 'security', label: 'Security & SSO', hint: 'Single sign-on and enforcement.', capability: 'manage_settings' },
  { href: '/settings/billing', icon: 'billing', label: 'Billing & usage', hint: 'Plan, usage meters and limits.' },
];

const PERSONAL: SettingsLink[] = [
  { href: '/profile', icon: 'users', label: 'Your profile', hint: 'Name, password, organizations and sessions.' },
  { href: '/legal/cookie-preferences', icon: 'lock', label: 'Cookie preferences', hint: 'What this app stores in your browser.' },
  { href: '/support', icon: 'help', label: 'Support', hint: 'Report a bug or ask a question.' },
];

function LinkGrid({ items, can }: { items: SettingsLink[]; can: (c: string) => boolean }) {
  return (
    <div className="link-grid">
      {items.map((item) => {
        const locked = item.capability ? !can(item.capability) : false;
        return (
          <Link key={item.href} href={item.href} className="link-card">
            <span className="t" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Icon name={item.icon} size={14} />
              {item.label}
              {locked && (
                <span className="chip" title="You can view this, but changes need a higher role">
                  <Icon name="lock" size={9} /> view only
                </span>
              )}
            </span>
            <span className="d">{item.hint}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default function SettingsIndexPage() {
  const toast = useToast();
  const router = useRouter();
  const { space, spaces, can, refresh } = useWorkspace();

  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => setName(space?.name ?? ''), [space?.name]);

  const manage = can('manage_spaces');
  const dirty = space != null && name.trim() !== space.name && name.trim().length > 0;

  async function saveName() {
    if (!space || !dirty) return;
    setBusy(true);
    try {
      await api(`/spaces/${space.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      });
      await refresh();
      toast('Space renamed');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not rename the space', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteSpace() {
    if (!space) return;
    await api(`/spaces/${space.id}`, { method: 'DELETE' });
    window.localStorage.removeItem('cms_space_id');
    window.localStorage.removeItem('cms_env_key');
    toast('Space deleted');
    window.location.href = '/';
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">
            Everything configurable for this space, your organization and you.
          </p>
        </div>
      </div>

      {/* --- General (space) --- */}
      <section className="card profile-card">
        <h2>General</h2>
        {!space ? (
          <p className="muted" style={{ margin: 0 }}>Select a space to edit its details.</p>
        ) : (
          <>
            <label className="field-label" htmlFor="space-name">Space name</label>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <input
                id="space-name"
                className="input"
                value={name}
                disabled={!manage || busy}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void saveName()}
                style={{ maxWidth: 320 }}
              />
              <button className="btn" disabled={!manage || !dirty || busy} onClick={() => void saveName()}>
                {busy ? '…' : 'Save'}
              </button>
            </div>
            {!manage && (
              <p className="help-text">
                <Icon name="lock" size={11} /> Renaming a space needs the
                <code> manage_spaces </code> capability.
              </p>
            )}

            <dl className="profile-meta">
              <dt>Space ID</dt>
              <dd><code>{space.id}</code></dd>
              <dt>Default locale</dt>
              <dd><code>{space.default_locale}</code></dd>
              <dt>Environments</dt>
              <dd>{(space.environments ?? []).map((e) => e.key).join(', ') || '—'}</dd>
            </dl>
          </>
        )}
      </section>

      {/* --- Space settings --- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Space</h2>
        <LinkGrid items={SPACE_SETTINGS} can={can} />
      </section>

      {/* --- Account settings --- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Organization</h2>
        <LinkGrid items={ACCOUNT_SETTINGS} can={can} />
      </section>

      {/* --- Personal --- */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ marginBottom: 10 }}>Personal</h2>
        <LinkGrid items={PERSONAL} can={can} />
      </section>

      {/* --- Danger zone --- */}
      {space && manage && (
        <section className="card profile-card" style={{ borderColor: 'var(--danger)' }}>
          <h2 style={{ color: 'var(--danger)' }}>Danger zone</h2>
          <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <p className="muted" style={{ margin: 0, maxWidth: 460 }}>
              Deleting <strong>{space.name}</strong> permanently removes its content
              types, entries, media, keys and webhooks. This cannot be undone.
            </p>
            <span className="spacer" />
            <button
              className="btn danger"
              disabled={spaces.length <= 1}
              title={spaces.length <= 1 ? 'You cannot delete your only space' : undefined}
              onClick={() => setDeleting(true)}
            >
              <Icon name="delete" size={13} /> Delete space
            </button>
          </div>
          {spaces.length <= 1 && (
            <p className="help-text">
              This is your only space — create another before deleting this one.
            </p>
          )}
        </section>
      )}

      {deleting && space && (
        <ConfirmDialog
          title={`Delete “${space.name}”?`}
          message="Every content type, entry, asset, API key and webhook in this space will be permanently deleted. This cannot be undone."
          confirmLabel="Delete space"
          onConfirm={deleteSpace}
          onClose={() => setDeleting(false)}
        />
      )}
    </div>
  );
}
