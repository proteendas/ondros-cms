'use client';

/**
 * Security settings (spec 002): per-account SSO providers (OIDC / SAML),
 * domain restriction, enforcement, JIT default role, test connection.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { API_URL, api } from '@/lib/api';
import { ConfirmDialog, Modal, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { Role, SSOConfigInfo } from '@/lib/types';

export default function SecurityPage() {
  const toast = useToast();
  const { user, can } = useWorkspace();
  const [configs, setConfigs] = useState<SSOConfigInfo[] | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [editing, setEditing] = useState<SSOConfigInfo | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SSOConfigInfo | null>(null);

  const accountId = user?.tenant_id;
  const accountSlug = user?.accounts.find((a) => a.is_active)?.slug;

  const load = useCallback(() => {
    if (!accountId) return;
    api<SSOConfigInfo[]>(`/accounts/${accountId}/sso`).then(setConfigs).catch(() => setConfigs([]));
    api<Role[]>('/roles').then(setRoles).catch(() => {});
  }, [accountId]);

  useEffect(load, [load]);

  if (!accountId) return <p className="muted">Loading…</p>;
  if (!can('manage_settings')) return <p className="muted">You need the manage_settings capability.</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Security — Single Sign-On</h1>
          <p className="subtitle">
            Connect your identity provider (Google Workspace, Entra ID, Okta…). Users signing in
            through SSO are provisioned automatically (JIT).
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditing('new')}>+ Add provider</button>
      </div>

      {accountSlug && (
        <div className="card" style={{ marginBottom: 14 }}>
          <p className="muted" style={{ margin: 0 }}>
            Your SSO sign-in URL: <code>{API_URL}/sso/{accountSlug}/login</code>
          </p>
        </div>
      )}

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Type</th>
              <th>Email domain</th>
              <th>JIT role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(configs ?? []).map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name || '(unnamed)'}</strong></td>
                <td><span className="chip">{c.provider_type.toUpperCase()}</span></td>
                <td><code>{c.email_domain || 'any'}</code></td>
                <td>{c.default_role_name}</td>
                <td>
                  <span className={`badge plain ${c.enabled ? 'published' : 'draft'}`}>
                    {c.enabled ? 'enabled' : 'disabled'}
                  </span>{' '}
                  {c.enforced && <span className="chip" style={{ color: 'var(--warning)' }}>enforced</span>}
                </td>
                <td className="actions">
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      try {
                        const res = await api<{ ok: boolean; issuer: string }>(
                          `/accounts/${accountId}/sso/${c.id}/test`, { method: 'POST' });
                        toast(`Connection OK — issuer ${res.issuer}`);
                      } catch (e) {
                        toast(e instanceof Error ? e.message : 'Connection failed', 'error');
                      }
                    }}
                  >
                    Test
                  </button>
                  <button className="btn ghost small" onClick={() => setEditing(c)}>Edit</button>
                  <button className="btn ghost small" style={{ color: 'var(--danger)' }}
                          onClick={() => setDeleting(c)}>Delete</button>
                </td>
              </tr>
            ))}
            {configs && configs.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No SSO providers configured — password login applies to everyone.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <SsoModal
          accountId={accountId}
          config={editing === 'new' ? null : editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('SSO configuration saved');
            load();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message="Users from this provider will no longer be able to sign in via SSO."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/accounts/${accountId}/sso/${deleting.id}`, { method: 'DELETE' });
            load();
          }}
        />
      )}
    </div>
  );
}

function SsoModal({
  accountId,
  config,
  roles,
  onClose,
  onSaved,
}: {
  accountId: string;
  config: SSOConfigInfo | null;
  roles: Role[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [providerType, setProviderType] = useState(config?.provider_type ?? 'oidc');
  const [name, setName] = useState(config?.name ?? '');
  const [discoveryUrl, setDiscoveryUrl] = useState(config?.discovery_url ?? '');
  const [clientId, setClientId] = useState(config?.client_id ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [metadataXml, setMetadataXml] = useState('');
  const [emailDomain, setEmailDomain] = useState(config?.email_domain ?? '');
  const [defaultRole, setDefaultRole] = useState(config?.default_role_name ?? 'EDITOR');
  const [enforced, setEnforced] = useState(config?.enforced ?? false);
  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload = {
      provider_type: providerType,
      name,
      discovery_url: discoveryUrl,
      client_id: clientId,
      client_secret: clientSecret,
      metadata_xml: metadataXml,
      email_domain: emailDomain,
      default_role_name: defaultRole,
      enforced,
      enabled,
    };
    try {
      if (config) {
        await api(`/accounts/${accountId}/sso/${config.id}`, {
          method: 'PATCH', body: JSON.stringify(payload),
        });
      } else {
        await api(`/accounts/${accountId}/sso`, { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setBusy(false);
    }
  }

  return (
    <Modal title={config ? `Edit ${config.name}` : 'Add SSO provider'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 300px' }}>
            <label className="field-label" style={{ marginTop: 0 }}>Provider type</label>
            <div className="row">
              {(['oidc', 'saml'] as const).map((t) => (
                <label key={t} className="checkbox-row" style={{ margin: 0 }}>
                  <input type="radio" checked={providerType === t} onChange={() => setProviderType(t)} />
                  {t.toUpperCase()}
                </label>
              ))}
            </div>
            {providerType === 'saml' && (
              <p className="help-text">
                ⚠ SAML configs are stored, but the runtime needs <code>python3-saml</code> installed
                (see specs/002-sso.md). Prefer OIDC if your IdP supports it.
              </p>
            )}
            <label className="field-label">Display name</label>
            <input className="input" value={name} placeholder="e.g. Okta, Entra ID"
                   onChange={(e) => setName(e.target.value)} />
            {providerType === 'oidc' ? (
              <>
                <label className="field-label">OIDC discovery URL</label>
                <input className="input mono" value={discoveryUrl}
                       placeholder="https://idp.example.com/.well-known/openid-configuration"
                       onChange={(e) => setDiscoveryUrl(e.target.value)} />
                <label className="field-label">Client ID</label>
                <input className="input mono" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                <label className="field-label">
                  Client secret {config?.has_client_secret && <span className="muted small">(blank = keep current)</span>}
                </label>
                <input className="input mono" type="password" value={clientSecret}
                       onChange={(e) => setClientSecret(e.target.value)} />
              </>
            ) : (
              <>
                <label className="field-label">IdP metadata XML</label>
                <textarea className="input mono" rows={6} value={metadataXml}
                          placeholder="Paste the IdP EntityDescriptor XML…"
                          onChange={(e) => setMetadataXml(e.target.value)} />
              </>
            )}
          </div>
          <div style={{ flex: '1 1 260px' }}>
            <label className="field-label" style={{ marginTop: 0 }}>Restrict to email domain</label>
            <input className="input" value={emailDomain} placeholder="example.com (empty = any)"
                   onChange={(e) => setEmailDomain(e.target.value)} />
            <label className="field-label">Default role for new (JIT) users</label>
            <select className="input" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.name}>{r.name}</option>
              ))}
            </select>
            <label className="checkbox-row" style={{ marginTop: 14 }}>
              <input type="checkbox" checked={enforced} onChange={(e) => setEnforced(e.target.checked)} />
              <span>
                <strong>Enforce SSO</strong>
                <span className="muted small" style={{ display: 'block' }}>
                  Blocks password login for this domain; the login page auto-redirects to the IdP.
                </span>
              </span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save provider'}</button>
        </div>
      </form>
    </Modal>
  );
}
