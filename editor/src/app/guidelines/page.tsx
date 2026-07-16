'use client';

/**
 * Manage guideline documents — the RAG source for all AI features.
 * Paste text and ingest; chunking + embedding happens server-side.
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { Guideline } from '@/lib/types';

export default function GuidelinesPage() {
  const [docs, setDocs] = useState<Guideline[]>([]);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [contentTypes, setContentTypes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api<Guideline[]>('/guidelines').then(setDocs).catch(() => {});
  }, []);

  useEffect(reload, [reload]);

  async function createDoc(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/guidelines', {
        method: 'POST',
        body: JSON.stringify({
          title,
          text,
          content_types: contentTypes ? contentTypes.split(',').map((s) => s.trim()) : [],
        }),
      });
      setTitle('');
      setText('');
      setContentTypes('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Guidelines</h1>
      <p className="muted">
        Documents here are chunked, embedded into PgVector, and retrieved automatically whenever AI
        generates, transforms, or audits content.
      </p>

      <form className="card" onSubmit={createDoc}>
        <label className="field-label">Title</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <label className="field-label">Guideline text (markdown or plain text)</label>
        <textarea
          className="input"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
        <label className="field-label">
          Applies to content types (comma-separated api_ids, empty = all)
        </label>
        <input
          className="input"
          value={contentTypes}
          onChange={(e) => setContentTypes(e.target.value)}
          placeholder="article, landing_page"
        />
        {error && <p className="error-text">{error}</p>}
        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={busy}>
            {busy ? 'Ingesting…' : 'Create & ingest'}
          </button>
        </div>
      </form>

      <table className="list">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Chunks</th>
            <th>Scope</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td>
              <td>
                <span className={`badge ${d.status === 'ingested' ? 'published' : 'draft'}`}>
                  {d.status}
                </span>
              </td>
              <td>{d.chunk_count}</td>
              <td className="muted">{d.content_types.length ? d.content_types.join(', ') : 'all types'}</td>
              <td>
                <button
                  className="btn secondary small"
                  onClick={() => api(`/guidelines/${d.id}/ingest`, { method: 'POST' }).then(reload)}
                >
                  Re-ingest
                </button>{' '}
                <button
                  className="btn danger small"
                  onClick={() => api(`/guidelines/${d.id}`, { method: 'DELETE' }).then(reload)}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {docs.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No guidelines yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
