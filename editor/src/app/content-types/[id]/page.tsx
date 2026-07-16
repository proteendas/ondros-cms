'use client';

/**
 * Content Type Builder: define fields, types, and validations.
 * Produces the FieldDef[] schema consumed by DynamicEntryForm, the preview
 * renderer, and the AI prompt builder.
 */
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { ContentType, FieldDef, FieldType } from '@/lib/types';

const FIELD_TYPES: FieldType[] = [
  'text',
  'richtext',
  'number',
  'boolean',
  'date',
  'media',
  'reference',
  'slug',
  'select',
];

function emptyField(): FieldDef {
  return {
    id: '',
    name: '',
    type: 'text',
    validations: {},
    help_text: '',
    ai_hint: '',
  };
}

export default function ContentTypeBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [ct, setCt] = useState<ContentType | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ContentType>(`/content-types/${id}`)
      .then((data) => {
        setCt(data);
        setFields(data.fields);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  function patchField(index: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function patchValidations(index: number, patch: Partial<FieldDef['validations']>) {
    setFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, validations: { ...f.validations, ...patch } } : f)),
    );
  }

  function move(index: number, delta: number) {
    setFields((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function save() {
    if (!ct) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await api<ContentType>(`/content-types/${ct.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: ct.name, description: ct.description, fields }),
      });
      setCt(updated);
      setFields(updated.fields);
      setMessage('Saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  async function remove() {
    if (!ct || !confirm(`Delete content type "${ct.name}" and ALL its entries?`)) return;
    await api(`/content-types/${ct.id}`, { method: 'DELETE' });
    router.push('/content-types');
  }

  if (error && !ct) return <p className="error-text">{error}</p>;
  if (!ct) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="row">
        <h1>
          Content type: {ct.name} <code style={{ fontSize: 14 }}>({ct.api_id})</code>
        </h1>
        <span className="spacer" />
        <button className="btn danger small" onClick={remove}>
          Delete
        </button>
      </div>

      <div className="card">
        <label className="field-label">Name</label>
        <input
          className="input"
          value={ct.name}
          onChange={(e) => setCt({ ...ct, name: e.target.value })}
        />
        <label className="field-label">Description</label>
        <textarea
          className="input"
          rows={2}
          value={ct.description}
          onChange={(e) => setCt({ ...ct, description: e.target.value })}
        />
      </div>

      <h2>Fields</h2>
      {fields.map((f, i) => (
        <div className="card" key={i}>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ maxWidth: 170 }}
              placeholder="Field name"
              value={f.name}
              onChange={(e) => patchField(i, { name: e.target.value })}
            />
            <input
              className="input"
              style={{ maxWidth: 150 }}
              placeholder="field_id"
              value={f.id}
              onChange={(e) => patchField(i, { id: e.target.value })}
            />
            <select
              className="input"
              style={{ maxWidth: 130 }}
              value={f.type}
              onChange={(e) => patchField(i, { type: e.target.value as FieldType })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label className="row" style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={!!f.validations.required}
                onChange={(e) => patchValidations(i, { required: e.target.checked })}
              />
              required
            </label>
            <input
              className="input"
              style={{ maxWidth: 100 }}
              type="number"
              placeholder="min len"
              value={f.validations.min_length ?? ''}
              onChange={(e) =>
                patchValidations(i, { min_length: e.target.value ? +e.target.value : null })
              }
            />
            <input
              className="input"
              style={{ maxWidth: 100 }}
              type="number"
              placeholder="max len"
              value={f.validations.max_length ?? ''}
              onChange={(e) =>
                patchValidations(i, { max_length: e.target.value ? +e.target.value : null })
              }
            />
            <span className="spacer" />
            <button className="btn secondary small" onClick={() => move(i, -1)}>
              ↑
            </button>
            <button className="btn secondary small" onClick={() => move(i, 1)}>
              ↓
            </button>
            <button
              className="btn danger small"
              onClick={() => setFields((prev) => prev.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <input
              className="input"
              placeholder="Help text (shown to editors)"
              value={f.help_text}
              onChange={(e) => patchField(i, { help_text: e.target.value })}
            />
            <input
              className="input"
              placeholder="AI hint (injected into generation prompts)"
              value={f.ai_hint}
              onChange={(e) => patchField(i, { ai_hint: e.target.value })}
            />
            {f.type === 'select' && (
              <input
                className="input"
                placeholder="Allowed values, comma-separated"
                value={(f.validations.allowed_values ?? []).join(',')}
                onChange={(e) =>
                  patchValidations(i, {
                    allowed_values: e.target.value
                      ? e.target.value.split(',').map((s) => s.trim())
                      : null,
                  })
                }
              />
            )}
          </div>
        </div>
      ))}

      <div className="row">
        <button
          className="btn secondary"
          onClick={() => setFields((prev) => [...prev, emptyField()])}
        >
          + Add field
        </button>
        <span className="spacer" />
        {message && <span className="muted">{message}</span>}
        {error && <span className="error-text">{error}</span>}
        <button className="btn" onClick={save}>
          Save content type
        </button>
      </div>
    </div>
  );
}
