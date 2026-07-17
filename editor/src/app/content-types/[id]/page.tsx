'use client';

/**
 * Content Type Builder.
 *  - Field list with drag-and-drop (or ↑/↓) reordering.
 *  - Field dialog: type picker, validations, localization, reference targets.
 *  - Live "sample entry form" preview built from the current schema.
 */
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import { FIELD_TYPE_INFO } from '@/lib/types';
import type { ContentType, FieldDef, FieldType } from '@/lib/types';

const PICKABLE_TYPES: FieldType[] = [
  'text', 'longtext', 'richtext', 'number', 'boolean', 'datetime',
  'select', 'media', 'media_many', 'reference', 'reference_many', 'json', 'slug',
];

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export default function ContentTypeBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { envPath } = useWorkspace();

  const [ct, setCt] = useState<ContentType | null>(null);
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [siblingTypes, setSiblingTypes] = useState<ContentType[]>([]);
  const [dialogIndex, setDialogIndex] = useState<number | 'new' | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    api<ContentType>(`/content-types/${id}`)
      .then((data) => {
        setCt(data);
        setFields(data.fields);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!envPath) return;
    api<ContentType[]>(`${envPath}/content-types`).then(setSiblingTypes).catch(() => {});
  }, [envPath]);

  function mutateFields(next: FieldDef[]) {
    setFields(next);
    setDirty(true);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= fields.length) return;
    const next = [...fields];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    mutateFields(next);
  }

  async function save() {
    if (!ct) return;
    setError(null);
    try {
      const updated = await api<ContentType>(`/content-types/${ct.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: ct.name,
          description: ct.description,
          display_field: ct.display_field,
          fields,
        }),
      });
      setCt(updated);
      setFields(updated.fields);
      setDirty(false);
      toast('Content type saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  const fieldIds = useMemo(() => fields.map((f) => f.id), [fields]);

  if (error && !ct) return <p className="error-text">{error}</p>;
  if (!ct) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>
            {ct.name} <code style={{ fontSize: 13 }}>{ct.api_id}</code>
          </h1>
          <p className="subtitle">{fields.length} fields</p>
        </div>
        <span className="spacer" />
        {dirty && <span className="muted">Unsaved changes</span>}
        <button className="btn danger secondary small" onClick={() => setDeleting(true)}>
          Delete
        </button>
        <button className="btn" onClick={save} disabled={!dirty && !!ct}>
          Save
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="editor-layout">
        <div style={{ flex: '1.4 1 480px', minWidth: 380 }}>
          <div className="card">
            <div className="row wrap">
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="field-label" style={{ marginTop: 0 }}>Name</label>
                <input
                  className="input"
                  value={ct.name}
                  onChange={(e) => { setCt({ ...ct, name: e.target.value }); setDirty(true); }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <label className="field-label" style={{ marginTop: 0 }}>Display field</label>
                <select
                  className="input"
                  value={ct.display_field || ''}
                  onChange={(e) => { setCt({ ...ct, display_field: e.target.value }); setDirty(true); }}
                >
                  <option value="">(first text field)</option>
                  {fieldIds.map((fid) => (
                    <option key={fid} value={fid}>{fid}</option>
                  ))}
                </select>
              </div>
            </div>
            <label className="field-label">Description</label>
            <textarea
              className="input"
              rows={2}
              value={ct.description}
              onChange={(e) => { setCt({ ...ct, description: e.target.value }); setDirty(true); }}
            />
          </div>

          <div className="row" style={{ margin: '18px 0 4px' }}>
            <h2 style={{ margin: 0 }}>Fields</h2>
            <span className="spacer" />
            <button className="btn secondary small" onClick={() => setDialogIndex('new')}>
              + Add field
            </button>
          </div>

          {fields.map((f, i) => {
            const info = FIELD_TYPE_INFO[f.type] ?? { label: f.type, icon: '?' };
            return (
              <div
                key={`${f.id}-${i}`}
                className={`field-row${dragIndex === i ? ' dragging' : ''}`}
                draggable
                onDragStart={() => setDragIndex(i)}
                onDragEnd={() => setDragIndex(null)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
                  setDragIndex(null);
                }}
              >
                <span className="drag-handle" title="Drag to reorder">⠿</span>
                <span className="type-icon" style={{ width: 28, height: 28, fontSize: 12 }}>
                  {info.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="f-name">
                    {f.name || <em className="muted">unnamed</em>}{' '}
                    <span className="f-id">{f.id}</span>
                  </div>
                  <div className="muted small">{info.label}</div>
                </div>
                <div className="f-flags">
                  {f.validations.required && <span className="chip">required</span>}
                  {f.localized && <span className="chip">localized</span>}
                  {(f.type === 'reference' || f.type === 'reference_many') &&
                    (f.allowed_content_types?.length ? (
                      <span className="chip">→ {f.allowed_content_types.join(', ')}</span>
                    ) : (
                      <span className="chip">→ any type</span>
                    ))}
                </div>
                <button className="btn ghost small" onClick={() => move(i, i - 1)} title="Move up">↑</button>
                <button className="btn ghost small" onClick={() => move(i, i + 1)} title="Move down">↓</button>
                <button className="btn secondary small" onClick={() => setDialogIndex(i)}>Edit</button>
                <button
                  className="btn ghost small"
                  style={{ color: 'var(--danger)' }}
                  onClick={() => mutateFields(fields.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            );
          })}
          {fields.length === 0 && (
            <p className="muted" style={{ marginTop: 12 }}>
              No fields yet — add your first field to start modeling.
            </p>
          )}
        </div>

        <div className="editor-side">
          <div className="card">
            <h2>Sample entry form</h2>
            <p className="muted small">Live preview of what editors will see.</p>
            {fields.map((f) => (
              <div key={f.id}>
                <label className="field-label">
                  {f.name || f.id}
                  {f.validations.required && <span className="error-text">*</span>}
                  <span className="field-type-tag">{f.type}</span>
                  {f.localized && <span className="field-type-tag">en-US ▾</span>}
                </label>
                <SampleWidget field={f} />
                {f.help_text && <p className="help-text">{f.help_text}</p>}
              </div>
            ))}
            {fields.length === 0 && <p className="muted small">Empty form.</p>}
          </div>
        </div>
      </div>

      {dialogIndex !== null && (
        <FieldDialog
          field={dialogIndex === 'new' ? null : fields[dialogIndex]}
          existingIds={fieldIds.filter((_, i) => i !== dialogIndex)}
          siblingTypes={siblingTypes.filter((t) => t.id !== ct.id).map((t) => t.api_id).concat(ct.api_id)}
          onClose={() => setDialogIndex(null)}
          onSave={(f) => {
            if (dialogIndex === 'new') mutateFields([...fields, f]);
            else mutateFields(fields.map((old, i) => (i === dialogIndex ? f : old)));
            setDialogIndex(null);
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete "${ct.name}"?`}
          message="This deletes the content type and ALL of its entries in this environment."
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api(`/content-types/${ct.id}`, { method: 'DELETE' });
            router.push('/content-types');
          }}
        />
      )}
    </div>
  );
}

function SampleWidget({ field }: { field: FieldDef }) {
  switch (field.type) {
    case 'richtext':
      return <div className="input" style={{ minHeight: 64, color: 'var(--text-3)' }}>Rich text…</div>;
    case 'longtext':
      return <textarea className="input" rows={3} disabled placeholder="Long text…" />;
    case 'boolean':
      return <input type="checkbox" disabled />;
    case 'number':
      return <input className="input" disabled placeholder="0" style={{ maxWidth: 140 }} />;
    case 'datetime':
    case 'date':
      return <input className="input" disabled placeholder="2026-01-01 10:00" style={{ maxWidth: 200 }} />;
    case 'select':
      return (
        <select className="input" disabled>
          <option>{(field.validations.allowed_values ?? ['option'])[0]}</option>
        </select>
      );
    case 'media':
    case 'media_many':
      return <div className="input" style={{ color: 'var(--text-3)' }}>🖼 Choose from media library…</div>;
    case 'reference':
    case 'reference_many':
      return <div className="input" style={{ color: 'var(--text-3)' }}>🔗 Link entr{field.type === 'reference' ? 'y' : 'ies'}…</div>;
    case 'json':
      return <textarea className="input mono" rows={2} disabled placeholder='{ "key": "value" }' />;
    default:
      return <input className="input" disabled placeholder="Text…" />;
  }
}

function FieldDialog({
  field,
  existingIds,
  siblingTypes,
  onClose,
  onSave,
}: {
  field: FieldDef | null;
  existingIds: string[];
  siblingTypes: string[];
  onClose: () => void;
  onSave: (f: FieldDef) => void;
}) {
  const isNew = field === null;
  const [draft, setDraft] = useState<FieldDef>(
    field ?? { id: '', name: '', type: 'text', localized: false, validations: {}, allowed_content_types: [], help_text: '', ai_hint: '' },
  );
  const [idTouched, setIdTouched] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);

  const isReference = draft.type === 'reference' || draft.type === 'reference_many';
  const isMany = draft.type === 'reference_many' || draft.type === 'media_many';
  const isTextual = ['text', 'longtext', 'richtext', 'slug'].includes(draft.type);

  function patch(p: Partial<FieldDef>) {
    setDraft((d) => ({ ...d, ...p }));
  }
  function patchV(p: Partial<FieldDef['validations']>) {
    setDraft((d) => ({ ...d, validations: { ...d.validations, ...p } }));
  }

  function submit() {
    if (!draft.name.trim()) return setError('Name is required');
    if (!/^[a-z][a-z0-9_]*$/.test(draft.id)) return setError('Field id must be lowercase snake_case');
    if (existingIds.includes(draft.id)) return setError(`Field id "${draft.id}" already exists`);
    if (draft.type === 'select' && !(draft.validations.allowed_values ?? []).length)
      return setError('Enum fields need at least one allowed value');
    onSave(draft);
  }

  return (
    <Modal title={isNew ? 'New field' : `Edit field: ${field?.name}`} onClose={onClose} wide>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }}>
          <label className="field-label" style={{ marginTop: 0 }}>Field type</label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
            {PICKABLE_TYPES.map((t) => {
              const info = FIELD_TYPE_INFO[t];
              return (
                <button
                  key={t}
                  type="button"
                  className="picker-tile"
                  style={{
                    padding: '8px 6px',
                    borderColor: draft.type === t ? 'var(--primary)' : undefined,
                    background: draft.type === t ? 'var(--primary-soft)' : undefined,
                  }}
                  onClick={() => patch({ type: t })}
                  title={info.hint}
                >
                  <div style={{ fontSize: 15 }}>{info.icon}</div>
                  <div className="tile-name">{info.label}</div>
                </button>
              );
            })}
          </div>

          <label className="field-label">Name</label>
          <input
            className="input"
            value={draft.name}
            autoFocus={isNew}
            onChange={(e) => {
              patch({ name: e.target.value });
              if (!idTouched) patch({ id: slugify(e.target.value) });
            }}
          />
          <label className="field-label">Field ID</label>
          <input
            className="input mono"
            value={draft.id}
            disabled={!isNew}
            onChange={(e) => { patch({ id: e.target.value }); setIdTouched(true); }}
          />
          {!isNew && <p className="help-text">IDs are stable — renaming would orphan stored values.</p>}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!draft.localized}
              onChange={(e) => patch({ localized: e.target.checked })}
            />
            Localized — one value per locale
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={!!draft.validations.required}
              onChange={(e) => patchV({ required: e.target.checked })}
            />
            Required
          </label>
        </div>

        <div style={{ flex: '1 1 300px' }}>
          {isReference && (
            <>
              <label className="field-label" style={{ marginTop: 0 }}>Allowed content types</label>
              <p className="help-text" style={{ marginBottom: 6 }}>
                Empty = any type. {draft.type === 'reference_many' && 'Editors can order the linked entries — perfect for assemblies.'}
              </p>
              {siblingTypes.map((apiId) => (
                <label key={apiId} className="checkbox-row" style={{ margin: '4px 0' }}>
                  <input
                    type="checkbox"
                    checked={(draft.allowed_content_types ?? []).includes(apiId)}
                    onChange={(e) => {
                      const cur = draft.allowed_content_types ?? [];
                      patch({
                        allowed_content_types: e.target.checked
                          ? [...cur, apiId]
                          : cur.filter((x) => x !== apiId),
                      });
                    }}
                  />
                  <code>{apiId}</code>
                </label>
              ))}
            </>
          )}

          {draft.type === 'select' && (
            <>
              <label className="field-label" style={{ marginTop: 0 }}>Allowed values</label>
              <input
                className="input"
                placeholder="value1, value2, value3"
                value={(draft.validations.allowed_values ?? []).join(', ')}
                onChange={(e) =>
                  patchV({
                    allowed_values: e.target.value
                      ? e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                      : null,
                  })
                }
              />
            </>
          )}

          {isTextual && (
            <div className="row" style={{ marginTop: isReference ? 12 : 0 }}>
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Min length</label>
                <input
                  className="input" type="number"
                  value={draft.validations.min_length ?? ''}
                  onChange={(e) => patchV({ min_length: e.target.value ? +e.target.value : null })}
                />
              </div>
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Max length</label>
                <input
                  className="input" type="number"
                  value={draft.validations.max_length ?? ''}
                  onChange={(e) => patchV({ max_length: e.target.value ? +e.target.value : null })}
                />
              </div>
            </div>
          )}
          {isTextual && (
            <>
              <label className="field-label">Pattern (regex)</label>
              <input
                className="input mono"
                value={draft.validations.pattern ?? ''}
                onChange={(e) => patchV({ pattern: e.target.value || null })}
              />
            </>
          )}

          {draft.type === 'number' && (
            <div className="row">
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Min</label>
                <input className="input" type="number" value={draft.validations.min ?? ''}
                  onChange={(e) => patchV({ min: e.target.value ? +e.target.value : null })} />
              </div>
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Max</label>
                <input className="input" type="number" value={draft.validations.max ?? ''}
                  onChange={(e) => patchV({ max: e.target.value ? +e.target.value : null })} />
              </div>
            </div>
          )}

          {isMany && (
            <div className="row" style={{ marginTop: 8 }}>
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Min items</label>
                <input className="input" type="number" value={draft.validations.min_items ?? ''}
                  onChange={(e) => patchV({ min_items: e.target.value ? +e.target.value : null })} />
              </div>
              <div>
                <label className="field-label" style={{ marginTop: 0 }}>Max items</label>
                <input className="input" type="number" value={draft.validations.max_items ?? ''}
                  onChange={(e) => patchV({ max_items: e.target.value ? +e.target.value : null })} />
              </div>
            </div>
          )}

          <label className="field-label">Help text (shown to editors)</label>
          <input className="input" value={draft.help_text ?? ''} onChange={(e) => patch({ help_text: e.target.value })} />
          <label className="field-label">AI hint (injected into generation prompts)</label>
          <input className="input" value={draft.ai_hint ?? ''} onChange={(e) => patch({ ai_hint: e.target.value })} />
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" onClick={submit}>{isNew ? 'Add field' : 'Apply'}</button>
      </div>
    </Modal>
  );
}
