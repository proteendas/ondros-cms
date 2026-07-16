'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { ContentType, Entry } from '@/lib/types';

export default function EntriesPage() {
  const router = useRouter();
  const [types, setTypes] = useState<ContentType[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [filterType, setFilterType] = useState<string>('');
  const [newTypeId, setNewTypeId] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ContentType[]>('/content-types')
      .then((ts) => {
        setTypes(ts);
        if (ts.length) setNewTypeId(ts[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const qs = filterType ? `?content_type_id=${filterType}` : '';
    api<Entry[]>(`/entries${qs}`).then(setEntries).catch(() => {});
  }, [filterType]);

  const typeById = new Map(types.map((t) => [t.id, t]));

  async function createEntry(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const ct = typeById.get(newTypeId);
    if (!ct) return;
    try {
      const entry = await api<Entry>('/entries', {
        method: 'POST',
        body: JSON.stringify({
          content_type_id: ct.id,
          space_id: ct.space_id,
          slug: newSlug,
          fields: {},
        }),
      });
      router.push(`/entries/${entry.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create entry');
    }
  }

  return (
    <div>
      <h1>Entries</h1>

      <form className="card row" onSubmit={createEntry} style={{ flexWrap: 'wrap' }}>
        <select
          className="input"
          style={{ maxWidth: 200 }}
          value={newTypeId}
          onChange={(e) => setNewTypeId(e.target.value)}
        >
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          style={{ maxWidth: 240 }}
          placeholder="slug (e.g. my-first-post)"
          value={newSlug}
          onChange={(e) => setNewSlug(e.target.value)}
          pattern="^[a-z0-9][a-z0-9\-]*$"
          required
        />
        <button className="btn">New entry</button>
        {error && <span className="error-text">{error}</span>}
        <span className="spacer" />
        <label className="muted">Filter:</label>
        <select
          className="input"
          style={{ maxWidth: 200 }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">All types</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </form>

      <table className="list">
        <thead>
          <tr>
            <th>Slug</th>
            <th>Type</th>
            <th>Status</th>
            <th>Version</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>
                <Link href={`/entries/${e.id}`}>{e.slug}</Link>
              </td>
              <td>{typeById.get(e.content_type_id)?.name ?? '?'}</td>
              <td>
                <span className={`badge ${e.status}`}>{e.status}</span>
              </td>
              <td>v{e.version}</td>
              <td>{new Date(e.updated_at).toLocaleString()}</td>
            </tr>
          ))}
          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No entries. Create one above.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
