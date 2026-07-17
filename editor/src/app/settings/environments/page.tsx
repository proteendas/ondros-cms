'use client';

/**
 * Environments settings: list, create (optionally cloning content model +
 * entries from another environment), set default, delete. Also manages the
 * space's locales.
 */
import { FormEvent, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, formatDate, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { Environment } from '@/lib/types';

export default function EnvironmentsPage() {
  const toast = useToast();
  const { space, spacePath, refresh, environment: activeEnv } = useWorkspace();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Environment | null>(null);
  const [editingLocales, setEditingLocales] = useState(false);

  if (!space || !spacePath) return <p className="muted">Select a space…</p>;

  async function makeDefault(env: Environment) {
    await api(`${spacePath}/environments/${env.key}/make-default`, { method: 'POST' });
    toast(`${env.key} is now the default environment`);
    await refresh();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Environments</h1>
          <p className="subtitle">
            Isolated content branches — model and entries are scoped per environment.
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setCreating(true)}>+ Add environment</button>
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Key</th>
              <th>Name</th>
              <th>Type</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {space.environments.map((env) => (
              <tr key={env.id}>
                <td>
                  <code>{env.key}</code>{' '}
                  {env.is_default && <span className="chip">default</span>}{' '}
                  {activeEnv?.id === env.id && <span className="chip" style={{ color: 'var(--primary)' }}>active</span>}
                </td>
                <td>{env.name}</td>
                <td className="muted">{env.type}</td>
                <td className="muted">{formatDate(env.created_at)}</td>
                <td className="actions">
                  {!env.is_default && (
                    <>
                      <button className="btn ghost small" onClick={() => makeDefault(env)}>
                        Make default
                      </button>
                      <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(env)}>
                        Delete
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="row">
          <h2 style={{ margin: 0 }}>Locales</h2>
          <span className="spacer" />
          <button className="btn secondary small" onClick={() => setEditingLocales(true)}>Edit locales</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {space.locales.map((l) => (
            <span key={l.code} className="chip" style={{ marginRight: 6 }}>
              {l.code}
              {l.code === space.default_locale && ' ★'}
            </span>
          ))}
        </p>
      </div>

      {creating && (
        <CreateEnvironmentModal
          spacePath={spacePath}
          environments={space.environments}
          onClose={() => setCreating(false)}
          onCreated={async (stats) => {
            setCreating(false);
            toast(
              stats
                ? `Environment created — cloned ${stats.content_types} types, ${stats.entries} entries`
                : 'Environment created',
            );
            await refresh();
          }}
        />
      )}

      {editingLocales && (
        <LocalesModal
          spacePath={spacePath}
          locales={space.locales}
          defaultLocale={space.default_locale}
          onClose={() => setEditingLocales(false)}
          onSaved={async () => {
            setEditingLocales(false);
            toast('Locales updated');
            await refresh();
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete environment "${deleting.key}"?`}
          message="ALL content types and entries in this environment are permanently deleted."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`${spacePath}/environments/${deleting.key}`, { method: 'DELETE' });
            toast(`Deleted ${deleting.key}`);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function CreateEnvironmentModal({
  spacePath,
  environments,
  onClose,
  onCreated,
}: {
  spacePath: string;
  environments: Environment[];
  onClose: () => void;
  onCreated: (stats: { content_types: number; entries: number } | null) => void;
}) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'staging' | 'dev'>('dev');
  const [cloneFrom, setCloneFrom] = useState(environments.find((e) => e.is_default)?.id ?? '');
  const [cloneEntries, setCloneEntries] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ cloned: { content_types: number; entries: number } }>(
        `${spacePath}/environments`,
        {
          method: 'POST',
          body: JSON.stringify({
            key,
            name: name || key,
            type,
            clone_from_environment_id: cloneFrom || null,
            clone_content_types: !!cloneFrom,
            clone_entries: !!cloneFrom && cloneEntries,
          }),
        },
      );
      onCreated(cloneFrom ? res.cloned : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create environment');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New environment"
      subtitle="Branch your content to test model changes safely."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label className="field-label">Key</label>
        <input
          className="input mono"
          value={key}
          required
          pattern="^[a-z0-9][a-z0-9\-]*$"
          placeholder="e.g. staging, feature-x"
          autoFocus
          onChange={(e) => setKey(e.target.value)}
        />
        <label className="field-label">Display name</label>
        <input className="input" value={name} placeholder={key || 'Staging'} onChange={(e) => setName(e.target.value)} />
        <label className="field-label">Type</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value as 'staging' | 'dev')}>
          <option value="dev">dev</option>
          <option value="staging">staging</option>
        </select>
        <label className="field-label">Clone from</label>
        <select className="input" value={cloneFrom} onChange={(e) => setCloneFrom(e.target.value)}>
          <option value="">— start empty —</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>{env.key}</option>
          ))}
        </select>
        {cloneFrom && (
          <>
            <label className="checkbox-row">
              <input type="checkbox" checked={cloneEntries} onChange={(e) => setCloneEntries(e.target.checked)} />
              Also clone entries (references are remapped to the new copies)
            </label>
            <p className="help-text">
              ⚠ Cloning copies every content type{cloneEntries ? ' and entry' : ''} — for large
              spaces this can take a while and duplicates data volume.
            </p>
          </>
        )}
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create environment'}</button>
        </div>
      </form>
    </Modal>
  );
}

function LocalesModal({
  spacePath,
  locales,
  defaultLocale,
  onClose,
  onSaved,
}: {
  spacePath: string;
  locales: { code: string; name: string }[];
  defaultLocale: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [items, setItems] = useState(locales.map((l) => ({ ...l })));
  const [def, setDef] = useState(defaultLocale);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    try {
      await api(spacePath, {
        method: 'PATCH',
        body: JSON.stringify({ locales: items, default_locale: def }),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save locales');
    }
  }

  return (
    <Modal title="Locales" subtitle="Locales available for localized fields in this space." onClose={onClose}>
      {items.map((loc, i) => (
        <div key={i} className="row" style={{ marginTop: 8 }}>
          <input
            className="input mono"
            style={{ maxWidth: 110 }}
            value={loc.code}
            placeholder="en-US"
            onChange={(e) => setItems(items.map((l, j) => (j === i ? { ...l, code: e.target.value } : l)))}
          />
          <input
            className="input"
            value={loc.name}
            placeholder="English (US)"
            onChange={(e) => setItems(items.map((l, j) => (j === i ? { ...l, name: e.target.value } : l)))}
          />
          <label className="checkbox-row" style={{ margin: 0, whiteSpace: 'nowrap' }}>
            <input type="radio" name="default" checked={def === loc.code} onChange={() => setDef(loc.code)} />
            default
          </label>
          <button
            className="btn ghost small"
            style={{ color: 'var(--danger)' }}
            disabled={items.length === 1}
            onClick={() => setItems(items.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn secondary small"
        style={{ marginTop: 10 }}
        onClick={() => setItems([...items, { code: '', name: '' }])}
      >
        + Add locale
      </button>
      {error && <p className="error-text">{error}</p>}
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={save}>Save locales</button>
      </div>
    </Modal>
  );
}
