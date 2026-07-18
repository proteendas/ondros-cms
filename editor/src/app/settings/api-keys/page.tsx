'use client';

/**
 * API keys settings: create delivery/preview/management keys, scope them to
 * environments, and copy ready-to-use snippets (curl + SDK).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { API_URL, api } from '@/lib/api';
import { ConfirmDialog, Modal, formatDate, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { ApiKey } from '@/lib/types';

export default function ApiKeysPage() {
  const toast = useToast();
  const { space, spacePath, environment } = useWorkspace();
  const [keys, setKeys] = useState<ApiKey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<ApiKey | null>(null);
  const [deleting, setDeleting] = useState<ApiKey | null>(null);
  const [snippetKey, setSnippetKey] = useState<ApiKey | null>(null);

  const load = useCallback(() => {
    if (!spacePath) return;
    api<ApiKey[]>(`${spacePath}/api-keys`)
      .then(setKeys)
      .catch((e) => {
        setKeys([]);
        toast(e instanceof Error ? e.message : 'Failed to load keys', 'error');
      });
  }, [spacePath, toast]);

  useEffect(load, [load]);

  if (!spacePath || !space) return <p className="muted">Select a space…</p>;

  const envNames = new Map(space.environments.map((e) => [e.id, e.key]));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>API keys</h1>
          <p className="subtitle">
            Tokens for the delivery (published), preview (drafts) and management APIs.
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}>+ Create key</button>
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Token</th>
              <th>Environments</th>
              <th>Last used</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(keys ?? []).map((key) => (
              <tr key={key.id} style={{ opacity: key.enabled ? 1 : 0.5 }}>
                <td>
                  <strong>{key.name}</strong>
                  {!key.enabled && <span className="chip" style={{ marginLeft: 6 }}>disabled</span>}
                  {key.description && <div className="muted small">{key.description}</div>}
                </td>
                <td><span className={`key-type ${key.type}`}>{key.type}</span></td>
                <td><code>{key.token_prefix}…</code></td>
                <td className="muted">
                  {key.environment_ids.length
                    ? key.environment_ids.map((id) => envNames.get(id) ?? '?').join(', ')
                    : 'all'}
                </td>
                <td className="muted">{formatDate(key.last_used_at)}</td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => setSnippetKey(key)}>How to use</button>
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      const res = await api<ApiKey>(`${spacePath}/api-keys/${key.id}/regenerate`, { method: 'POST' });
                      setRevealed(res);
                      load();
                    }}
                  >
                    Regenerate
                  </button>
                  <button
                    className="btn ghost small"
                    onClick={async () => {
                      await api(`${spacePath}/api-keys/${key.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ enabled: !key.enabled }),
                      });
                      load();
                    }}
                  >
                    {key.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(key)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {keys && keys.length === 0 && (
              <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 24 }}>No API keys yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreateKeyModal
          spacePath={spacePath}
          environments={space.environments}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setRevealed(key);
            load();
          }}
        />
      )}

      {revealed && (
        <Modal
          title="Copy your token now"
          subtitle="This is the only time the full token is shown. It is stored hashed."
          onClose={() => setRevealed(null)}
        >
          <div className="token-reveal">
            <code>{revealed.access_token}</code>
            <button
              className="btn secondary small"
              onClick={() => {
                void navigator.clipboard.writeText(revealed.access_token ?? '');
                toast('Token copied');
              }}
            >
              Copy
            </button>
          </div>
          <div className="modal-footer">
            <button className="btn" onClick={() => setRevealed(null)}>Done</button>
          </div>
        </Modal>
      )}

      {snippetKey && (
        <Modal title={`Use "${snippetKey.name}"`} onClose={() => setSnippetKey(null)} wide>
          <UsageSnippets apiKey={snippetKey} spaceId={space.id} envKey={environment?.key ?? 'master'} />
          <div className="modal-footer">
            <button className="btn secondary" onClick={() => setSnippetKey(null)}>Close</button>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete key "${deleting.name}"?`}
          message="Apps using this token will immediately lose access."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`${spacePath}/api-keys/${deleting.id}`, { method: 'DELETE' });
            load();
          }}
        />
      )}
    </div>
  );
}

function UsageSnippets({ apiKey, spaceId, envKey }: { apiKey: ApiKey; spaceId: string; envKey: string }) {
  const token = `${apiKey.token_prefix}…`;
  const curl = `curl "${API_URL}/spaces/${spaceId}/environments/${envKey}/delivery/entries?content_type=article&include=2" \\
  -H "Authorization: Bearer ${token}"`;

  const sdk = `import { createClient } from '@ondros/sdk'; // sdk/ in this repo

const client = createClient({
  baseUrl: '${API_URL}',
  spaceId: '${spaceId}',
  environment: '${envKey}',
  accessToken: '${token}',
});

const page = await client.getEntryBySlug({
  contentType: 'landing_page',
  slug: 'home',
  include: 2,           // resolve hero + sections references
});
const hero = page.resolve(page.entry?.fields.hero);`;

  return (
    <div>
      <p className="muted small">
        {apiKey.type === 'delivery' && 'Delivery keys return published content only — safe for production frontends.'}
        {apiKey.type === 'preview' && 'Preview keys also return drafts (with status) — use in preview deployments and the visual editor.'}
        {apiKey.type === 'management' && 'Management keys have full space access — server-side automation only, never ship to browsers.'}
      </p>
      <h3>curl</h3>
      <pre className="code-block">{curl}</pre>
      <h3>TypeScript (SDK)</h3>
      <pre className="code-block">{sdk}</pre>
      <p className="muted small">Replace <code>{token}</code> with the full token you copied at creation.</p>
    </div>
  );
}

function CreateKeyModal({
  spacePath,
  environments,
  onClose,
  onCreated,
}: {
  spacePath: string;
  environments: { id: string; key: string }[];
  onClose: () => void;
  onCreated: (key: ApiKey) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'delivery' | 'preview' | 'management'>('delivery');
  const [description, setDescription] = useState('');
  const [envIds, setEnvIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const key = await api<ApiKey>(`${spacePath}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name, type, description, environment_ids: envIds }),
      });
      onCreated(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create key');
      setBusy(false);
    }
  }

  return (
    <Modal title="Create API key" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Name</label>
        <input className="input" value={name} required autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. Production website" />
        <label className="field-label">Type</label>
        <div className="row">
          {(['delivery', 'preview', 'management'] as const).map((t) => (
            <label key={t} className="checkbox-row" style={{ margin: 0 }}>
              <input type="radio" name="type" checked={type === t} onChange={() => setType(t)} />
              <span className={`key-type ${t}`}>{t}</span>
            </label>
          ))}
        </div>
        <p className="help-text">
          delivery = published only · preview = drafts too · management = full space CRUD
        </p>
        {type !== 'management' && (
          <>
            <label className="field-label">Environments (empty = all)</label>
            {environments.map((env) => (
              <label key={env.id} className="checkbox-row" style={{ margin: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={envIds.includes(env.id)}
                  onChange={(e) =>
                    setEnvIds(e.target.checked ? [...envIds, env.id] : envIds.filter((x) => x !== env.id))
                  }
                />
                <code>{env.key}</code>
              </label>
            ))}
          </>
        )}
        <label className="field-label">Description</label>
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create key'}</button>
        </div>
      </form>
    </Modal>
  );
}
