'use client';

/**
 * Entries list: filterable, searchable, paginated table with bulk actions.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, formatDate, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { ContentType, Entry, EntryList, EntryStatus } from '@/lib/types';

const PAGE_SIZE = 25;
const STATUSES: EntryStatus[] = ['draft', 'in_review', 'published', 'archived'];

function entryTitle(entry: Entry, ct: ContentType | undefined, defaultLocale: string): string {
  if (!ct) return entry.slug;
  const displayId =
    ct.display_field || ct.fields.find((f) => ['text', 'slug'].includes(f.type))?.id;
  const fd = ct.fields.find((f) => f.id === displayId);
  if (!fd) return entry.slug;
  const raw = entry.fields?.[fd.id];
  const value =
    fd.localized && raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[defaultLocale]
      : raw;
  return typeof value === 'string' && value.trim() ? value : entry.slug;
}

export default function EntriesPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <EntriesPageInner />
    </Suspense>
  );
}

function EntriesPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const { envPath, space, can } = useWorkspace();

  const [types, setTypes] = useState<ContentType[]>([]);
  const [list, setList] = useState<EntryList | null>(null);
  const [typeFilter, setTypeFilter] = useState(params.get('type') ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [confirmBulk, setConfirmBulk] = useState<string | null>(null);

  const typesByid = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  useEffect(() => {
    if (!envPath) return;
    api<ContentType[]>(`${envPath}/content-types`).then(setTypes).catch(() => {});
  }, [envPath]);

  const load = useCallback(() => {
    if (!envPath) return;
    const qs = new URLSearchParams();
    if (typeFilter) qs.set('content_type', typeFilter);
    if (statusFilter) qs.set('status', statusFilter);
    if (search) qs.set('q', search);
    qs.set('limit', String(PAGE_SIZE));
    qs.set('skip', String(page * PAGE_SIZE));
    api<EntryList>(`${envPath}/entries?${qs}`)
      .then((data) => {
        setList(data);
        setSelected(new Set());
      })
      .catch(() => setList({ items: [], total: 0, skip: 0, limit: PAGE_SIZE }));
  }, [envPath, typeFilter, statusFilter, search, page]);

  useEffect(load, [load]);

  async function bulk(action: string) {
    if (!envPath || selected.size === 0) return;
    const res = await api<{ succeeded: string[]; failed: Record<string, string> }>(
      `${envPath}/entries/bulk`,
      { method: 'POST', body: JSON.stringify({ entry_ids: Array.from(selected), action }) },
    );
    const failures = Object.keys(res.failed).length;
    toast(
      `${action}: ${res.succeeded.length} succeeded${failures ? `, ${failures} failed` : ''}`,
      failures ? 'error' : 'info',
    );
    load();
  }

  function toggleAll(check: boolean) {
    setSelected(check ? new Set((list?.items ?? []).map((e) => e.id)) : new Set());
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  if (!envPath) return <p className="muted">Select a space…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Content</h1>
          <p className="subtitle">{list ? `${list.total} entries` : '…'}</p>
        </div>
        <span className="spacer" />
        {can('manage_entries') && (
          <button className="btn" onClick={() => setCreating(true)} disabled={!types.length}>
            + Add entry
          </button>
        )}
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Search entries…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
        />
        <select
          className="input"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.api_id}>{t.name}</option>
          ))}
        </select>
        <select
          className="input"
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
        >
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        {selected.size > 0 && (
          <>
            <span style={{ width: 1, height: 22, background: 'var(--border)' }} />
            <span className="muted">{selected.size} selected</span>
            {can('publish_entries') && (
              <>
                <button className="btn secondary small" onClick={() => bulk('publish')}>Publish</button>
                <button className="btn secondary small" onClick={() => bulk('unpublish')}>Unpublish</button>
                <button className="btn secondary small" onClick={() => bulk('archive')}>Archive</button>
              </>
            )}
            {can('manage_entries') && (
              <button className="btn danger secondary small" onClick={() => setConfirmBulk('delete')}>
                Delete
              </button>
            )}
          </>
        )}
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={!!list?.items.length && selected.size === list.items.length}
                  onChange={(e) => toggleAll(e.target.checked)}
                />
              </th>
              <th>Title</th>
              <th>Type</th>
              <th>Status</th>
              <th>Updated</th>
              <th style={{ width: 60 }} />
            </tr>
          </thead>
          <tbody>
            {(list?.items ?? []).map((entry) => {
              const ct = typesByid.get(entry.content_type_id);
              return (
                <tr key={entry.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(entry.id)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(entry.id);
                        else next.delete(entry.id);
                        setSelected(next);
                      }}
                    />
                  </td>
                  <td>
                    <Link href={`/entries/${entry.id}`} style={{ fontWeight: 500 }}>
                      {entryTitle(entry, ct, space?.default_locale ?? 'en-US')}
                    </Link>
                    <div className="muted small mono">/{entry.slug}</div>
                  </td>
                  <td>{ct?.name ?? '—'}</td>
                  <td><span className={`badge ${entry.status}`}>{entry.status.replace('_', ' ')}</span></td>
                  <td className="muted">{formatDate(entry.updated_at)}</td>
                  <td className="actions">
                    <Link href={`/entries/${entry.id}`} className="btn ghost small">Edit</Link>
                  </td>
                </tr>
              );
            })}
            {list && list.items.length === 0 && (
              <tr>
                <td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 30 }}>
                  No entries match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {list && list.total > PAGE_SIZE && (
        <div className="pagination">
          <button className="btn secondary small" disabled={page === 0} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span className="muted">Page {page + 1} of {totalPages}</span>
          <button
            className="btn secondary small"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next →
          </button>
        </div>
      )}

      {creating && (
        <NewEntryModal
          envPath={envPath}
          types={types}
          initialType={typeFilter}
          onClose={() => setCreating(false)}
          onCreated={(id) => router.push(`/entries/${id}`)}
        />
      )}
      {confirmBulk && (
        <ConfirmDialog
          title={`Delete ${selected.size} entries?`}
          message="Deleted entries cannot be recovered."
          onClose={() => setConfirmBulk(null)}
          onConfirm={() => bulk('delete')}
        />
      )}
    </div>
  );
}

function NewEntryModal({
  envPath,
  types,
  initialType,
  onClose,
  onCreated,
}: {
  envPath: string;
  types: ContentType[];
  initialType: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [typeId, setTypeId] = useState(
    types.find((t) => t.api_id === initialType)?.id ?? types[0]?.id ?? '',
  );
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const entry = await api<Entry>(`${envPath}/entries`, {
        method: 'POST',
        body: JSON.stringify({ content_type_id: typeId, slug, fields: {} }),
      });
      onCreated(entry.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
      setBusy(false);
    }
  }

  return (
    <Modal title="New entry" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="field-label">Content type</label>
        <select className="input" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <label className="field-label">Slug</label>
        <input
          className="input mono"
          value={slug}
          required
          pattern="^[a-z0-9][a-z0-9\-]*$"
          placeholder="my-first-entry"
          onChange={(e) => setSlug(e.target.value)}
          autoFocus
        />
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy || !typeId}>
            {busy ? 'Creating…' : 'Create entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
