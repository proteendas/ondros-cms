'use client';

/** Audit log (spec 006): who did what, when — with diffs. */
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { formatDate } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { AuditLogRow } from '@/lib/types';

const PAGE_SIZE = 50;

const RESOURCE_TYPES = ['', 'entry', 'content_type', 'asset', 'locale', 'space',
  'api_key', 'webhook', 'invitation', 'sso_config', 'subscription', 'user'];

export default function AuditLogPage() {
  const { spacePath } = useWorkspace();
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [resourceType, setResourceType] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!spacePath) return;
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), skip: String(page * PAGE_SIZE) });
    if (resourceType) qs.set('resource_type', resourceType);
    if (q) qs.set('q', q);
    api<{ items: AuditLogRow[]; total: number }>(`${spacePath}/audit-log?${qs}`)
      .then((d) => {
        setRows(d.items);
        setTotal(d.total);
      })
      .catch(() => setRows([]));
  }, [spacePath, resourceType, q, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  if (!spacePath) return <p className="muted">Select a space…</p>;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="subtitle">{total} events in this space</p>
        </div>
      </div>

      <div className="toolbar">
        <input className="input" placeholder="Search actor / action / resource id…"
               value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className="input" value={resourceType}
                onChange={(e) => { setResourceType(e.target.value); setPage(0); }}>
          {RESOURCE_TYPES.map((t) => (
            <option key={t} value={t}>{t || 'All resources'}</option>
          ))}
        </select>
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Resource</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((row) => (
              <>
                <tr key={row.id}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{formatDate(row.created_at)}</td>
                  <td>{row.actor_label || 'system'}</td>
                  <td><code>{row.action}</code></td>
                  <td className="muted">
                    {row.resource_type}
                    {row.resource_id && <span className="mono small"> {row.resource_id.slice(0, 8)}…</span>}
                  </td>
                  <td className="actions">
                    {Object.keys(row.diff ?? {}).length > 0 && (
                      <button className="btn ghost small"
                              onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                        {expanded === row.id ? 'Hide diff' : 'Diff'}
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === row.id && (
                  <tr key={`${row.id}-diff`}>
                    <td colSpan={5}>
                      <pre className="code-block" style={{ margin: 0 }}>
                        {JSON.stringify(row.diff, null, 2)}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {rows && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  No audit events match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > PAGE_SIZE && (
        <div className="pagination">
          <button className="btn secondary small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page + 1} of {totalPages}</span>
          <button className="btn secondary small" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
