'use client';

/**
 * Locales settings (spec 003): add from the ISO catalog, set default,
 * configure fallback chains, activate/deactivate, remove.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, useToast } from '@/components/ui';
import { LOCALE_CATALOG } from '@/lib/localeCatalog';
import { useWorkspace } from '@/lib/workspace';
import type { LocaleRow } from '@/lib/types';

export default function LocalesPage() {
  const toast = useToast();
  const { spacePath, refresh, can } = useWorkspace();
  const [rows, setRows] = useState<LocaleRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<LocaleRow | null>(null);

  const load = useCallback(() => {
    if (!spacePath) return;
    api<LocaleRow[]>(`${spacePath}/locales`).then(setRows).catch(() => setRows([]));
  }, [spacePath]);

  useEffect(load, [load]);

  if (!spacePath) return <p className="muted">Select a space…</p>;
  const manage = can('manage_settings');

  async function mutate(row: LocaleRow, patch: Record<string, unknown>) {
    await api(`${spacePath}/locales/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    load();
    await refresh(); // editor tabs read the synced space cache
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Locales</h1>
          <p className="subtitle">
            Languages for localized fields. Fallback chains apply on delivery
            (locale → fallback → default).
          </p>
        </div>
        <span className="spacer" />
        {manage && (
          <button className="btn" onClick={() => setAdding(true)}>+ Add locale</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Fallback</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <tr key={row.id} style={{ opacity: row.is_active ? 1 : 0.55 }}>
                <td>
                  <code>{row.code}</code>{' '}
                  {row.is_default && <span className="chip">default ★</span>}
                </td>
                <td>{row.name}</td>
                <td>
                  {manage ? (
                    <select
                      className="input" style={{ maxWidth: 160 }}
                      value={row.fallback_code ?? ''}
                      disabled={row.is_default}
                      onChange={(e) => void mutate(row, { fallback_code: e.target.value })}
                    >
                      <option value="">— default locale —</option>
                      {(rows ?? [])
                        .filter((l) => l.id !== row.id)
                        .map((l) => (
                          <option key={l.id} value={l.code}>{l.code}</option>
                        ))}
                    </select>
                  ) : (
                    <code>{row.fallback_code ?? '—'}</code>
                  )}
                </td>
                <td>
                  <span className={`badge plain ${row.is_active ? 'published' : 'draft'}`}>
                    {row.is_active ? 'active' : 'inactive'}
                  </span>
                </td>
                <td className="actions">
                  {manage && !row.is_default && (
                    <>
                      <button
                        className="btn ghost small"
                        onClick={async () => {
                          await api(`${spacePath}/locales/${row.id}/make-default`, { method: 'POST' });
                          toast(`${row.code} is now the default locale`);
                          load();
                          await refresh();
                        }}
                      >
                        Make default
                      </button>
                      <button className="btn ghost small"
                              onClick={() => void mutate(row, { is_active: !row.is_active })}>
                        {row.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="btn ghost small" style={{ color: 'var(--danger)' }}
                              onClick={() => setDeleting(row)}>
                        Remove
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddLocaleModal
          spacePath={spacePath}
          existing={(rows ?? []).map((r) => r.code)}
          fallbackOptions={(rows ?? []).map((r) => r.code)}
          onClose={() => setAdding(false)}
          onAdded={async () => {
            setAdding(false);
            toast('Locale added');
            load();
            await refresh();
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Remove locale ${deleting.code}?`}
          message="Entry values stored for this locale stay in the JSON (ignored) and come back if you re-add the locale."
          confirmLabel="Remove"
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`${spacePath}/locales/${deleting.id}`, { method: 'DELETE' });
            load();
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function AddLocaleModal({
  spacePath,
  existing,
  fallbackOptions,
  onClose,
  onAdded,
}: {
  spacePath: string;
  existing: string[];
  fallbackOptions: string[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [fallback, setFallback] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const available = useMemo(
    () =>
      LOCALE_CATALOG.filter(
        (l) =>
          !existing.includes(l.code) &&
          (l.code.toLowerCase().includes(query.toLowerCase()) ||
            l.name.toLowerCase().includes(query.toLowerCase())),
      ),
    [existing, query],
  );

  async function add() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api(`${spacePath}/locales`, {
        method: 'POST',
        body: JSON.stringify({
          code: selected,
          name: LOCALE_CATALOG.find((l) => l.code === selected)?.name ?? selected,
          fallback_code: fallback || null,
        }),
      });
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add locale');
      setBusy(false);
    }
  }

  return (
    <Modal title="Add locale" subtitle="Pick any ISO language/region combination." onClose={onClose}>
      <input className="input" placeholder="Search (e.g. hindi, hi-IN, portuguese)…" autoFocus
             value={query} onChange={(e) => setQuery(e.target.value)} />
      <div style={{ maxHeight: 260, overflowY: 'auto', margin: '10px 0', border: '1px solid var(--border)', borderRadius: 8, padding: 6 }}>
        {available.map((l) => (
          <label key={l.code} className="checkbox-row" style={{ margin: '2px 0' }}>
            <input type="radio" name="locale" checked={selected === l.code}
                   onChange={() => setSelected(l.code)} />
            <code>{l.code}</code> {l.name}
          </label>
        ))}
        {available.length === 0 && <p className="muted small">No matches.</p>}
      </div>
      <label className="field-label">Fallback locale (when a translation is missing)</label>
      <select className="input" value={fallback} onChange={(e) => setFallback(e.target.value)}>
        <option value="">— default locale —</option>
        {fallbackOptions.map((code) => (
          <option key={code} value={code}>{code}</option>
        ))}
      </select>
      {error && <p className="error-text">{error}</p>}
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!selected || busy} onClick={add}>
          {busy ? 'Adding…' : `Add ${selected ?? 'locale'}`}
        </button>
      </div>
    </Modal>
  );
}
