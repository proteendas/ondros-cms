'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { ContentType, Space } from '@/lib/types';

export default function ContentTypesPage() {
  const router = useRouter();
  const [types, setTypes] = useState<ContentType[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [name, setName] = useState('');
  const [apiId, setApiId] = useState('');
  const [spaceId, setSpaceId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ContentType[]>('/content-types').then(setTypes).catch(() => {});
    api<Space[]>('/content-types/spaces/all')
      .then((s) => {
        setSpaces(s);
        if (s.length) setSpaceId(s[0].id);
      })
      .catch(() => {});
  }, []);

  async function createType(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const ct = await api<ContentType>('/content-types', {
        method: 'POST',
        body: JSON.stringify({ name, api_id: apiId, space_id: spaceId, fields: [] }),
      });
      router.push(`/content-types/${ct.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create');
    }
  }

  return (
    <div>
      <h1>Content types</h1>

      <form className="card row" onSubmit={createType} style={{ flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ maxWidth: 220 }}
          placeholder="Name (e.g. Article)"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            // Auto-derive api_id from the name; editors can still override.
            setApiId(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
          }}
          required
        />
        <input
          className="input"
          style={{ maxWidth: 180 }}
          placeholder="api_id"
          value={apiId}
          onChange={(e) => setApiId(e.target.value)}
          pattern="^[a-z][a-z0-9_]*$"
          required
        />
        <select className="input" style={{ maxWidth: 200 }} value={spaceId} onChange={(e) => setSpaceId(e.target.value)}>
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn">Create</button>
        {error && <span className="error-text">{error}</span>}
      </form>

      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>api_id</th>
            <th>Fields</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {types.map((ct) => (
            <tr key={ct.id}>
              <td>
                <Link href={`/content-types/${ct.id}`}>{ct.name}</Link>
              </td>
              <td>
                <code>{ct.api_id}</code>
              </td>
              <td>{ct.fields.length}</td>
              <td>{new Date(ct.updated_at).toLocaleString()}</td>
            </tr>
          ))}
          {types.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No content types yet — create one above, or run the seed script.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
