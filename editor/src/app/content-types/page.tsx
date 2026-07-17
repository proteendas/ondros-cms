'use client';

/** Content model overview: one card per content type with usage + quick actions. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, EmptyState, Modal, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { ContentType } from '@/lib/types';

const TYPE_ICONS = ['🧩', '📄', '🧱', '🃏', '📰', '🎯', '🗂'];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function ContentTypesPage() {
  const router = useRouter();
  const toast = useToast();
  const { envPath, can } = useWorkspace();
  const [types, setTypes] = useState<ContentType[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ContentType | null>(null);

  const load = useCallback(() => {
    if (!envPath) return;
    api<ContentType[]>(`${envPath}/content-types`).then(setTypes).catch(() => setTypes([]));
  }, [envPath]);

  useEffect(load, [load]);

  if (!envPath) return <p className="muted">Select a space…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Content model</h1>
          <p className="subtitle">Types define the shape of your entries in this environment.</p>
        </div>
        <span className="spacer" />
        {can('manage_content_types') && (
          <button className="btn" onClick={() => setCreating(true)}>
            + Add content type
          </button>
        )}
      </div>

      {types === null ? (
        <div className="card-grid">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 130 }} />
          ))}
        </div>
      ) : types.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No content types yet"
          hint="Create your first type, or run the seed script for a sample model."
          action={
            can('manage_content_types') ? (
              <button className="btn" onClick={() => setCreating(true)}>
                + Add content type
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="card-grid">
          {types.map((ct, i) => (
            <div key={ct.id} className="card type-card">
              <div className="row">
                <div className="type-icon">{TYPE_ICONS[i % TYPE_ICONS.length]}</div>
                <div style={{ minWidth: 0 }}>
                  <div className="type-title">{ct.name}</div>
                  <code style={{ fontSize: 11 }}>{ct.api_id}</code>
                </div>
              </div>
              <div className="type-meta">
                {ct.fields.length} field{ct.fields.length === 1 ? '' : 's'} ·{' '}
                {ct.entry_count ?? 0} entr{(ct.entry_count ?? 0) === 1 ? 'y' : 'ies'}
              </div>
              {ct.description && (
                <div className="type-meta" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ct.description}
                </div>
              )}
              <div className="type-actions">
                <Link href={`/content-types/${ct.id}`} className="btn secondary small">
                  Edit model
                </Link>
                <Link href={`/entries?type=${ct.api_id}`} className="btn ghost small">
                  View entries
                </Link>
                {can('manage_content_types') && (
                  <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(ct)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <CreateTypeModal
          envPath={envPath}
          onClose={() => setCreating(false)}
          onCreated={(ct) => router.push(`/content-types/${ct.id}`)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${deleting.name}"?`}
          message={`This deletes the content type and ALL ${deleting.entry_count ?? 0} of its entries in this environment. This cannot be undone.`}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`/content-types/${deleting.id}`, { method: 'DELETE' });
            toast(`Deleted ${deleting.name}`);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateTypeModal({
  envPath,
  onClose,
  onCreated,
}: {
  envPath: string;
  onClose: () => void;
  onCreated: (ct: ContentType) => void;
}) {
  const [name, setName] = useState('');
  const [apiId, setApiId] = useState('');
  const [apiIdTouched, setApiIdTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const ct = await api<ContentType>(`${envPath}/content-types`, {
        method: 'POST',
        body: JSON.stringify({ name, api_id: apiId, description, fields: [] }),
      });
      onCreated(ct);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setBusy(false);
    }
  }

  return (
    <Modal
      title="New content type"
      subtitle="A reusable schema for entries — e.g. Article, Landing Page, Hero Section."
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <label className="field-label">Name</label>
        <input
          className="input"
          value={name}
          autoFocus
          required
          placeholder="e.g. Landing Page"
          onChange={(e) => {
            setName(e.target.value);
            if (!apiIdTouched) setApiId(slugify(e.target.value));
          }}
        />
        <label className="field-label">API identifier</label>
        <input
          className="input mono"
          value={apiId}
          required
          pattern="^[a-z][a-z0-9_]*$"
          onChange={(e) => {
            setApiId(e.target.value);
            setApiIdTouched(true);
          }}
        />
        <p className="help-text">Used in API queries: ?content_type={apiId || 'landing_page'}</p>
        <label className="field-label">Description</label>
        <textarea
          className="input"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" disabled={busy}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
