'use client';

/**
 * Reference field widget: link one or many entries.
 *  - Shows linked entries as cards with type + status.
 *  - "Link entry" opens a search modal (filter by allowed content types,
 *    keyword, status).
 *  - reference_many supports drag-and-drop ordering + remove.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui';
import type { ContentType, Entry, EntryList } from '@/lib/types';

interface Props {
  envPath: string;
  types: ContentType[];
  /** api_ids allowed as targets; empty = all */
  allowedContentTypes: string[];
  multiple: boolean;
  value: unknown; // string | string[] | null
  onChange: (value: unknown) => void;
  defaultLocale: string;
}

function displayTitle(entry: Entry, ct: ContentType | undefined, defaultLocale: string): string {
  const displayId =
    ct?.display_field || ct?.fields.find((f) => ['text', 'slug'].includes(f.type))?.id;
  const fd = ct?.fields.find((f) => f.id === displayId);
  const raw = fd ? entry.fields?.[fd.id] : undefined;
  const v =
    fd?.localized && raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)[defaultLocale]
      : raw;
  return typeof v === 'string' && v.trim() ? v : entry.slug;
}

export default function ReferencePicker({
  envPath,
  types,
  allowedContentTypes,
  multiple,
  value,
  onChange,
  defaultLocale,
}: Props) {
  const ids = useMemo<string[]>(() => {
    if (multiple) return Array.isArray(value) ? (value as string[]) : [];
    return typeof value === 'string' && value ? [value] : [];
  }, [value, multiple]);

  const [linked, setLinked] = useState<Map<string, Entry>>(new Map());
  const [picking, setPicking] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const typesById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  useEffect(() => {
    const missing = ids.filter((id) => !linked.has(id));
    if (!missing.length) return;
    Promise.all(
      missing.map((id) => api<Entry>(`/entries/${id}`).catch(() => null)),
    ).then((fetched) => {
      setLinked((prev) => {
        const next = new Map(prev);
        fetched.forEach((e) => e && next.set(e.id, e));
        return next;
      });
    });
  }, [ids, linked]);

  function commit(nextIds: string[]) {
    onChange(multiple ? nextIds : nextIds[0] ?? null);
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    commit(next);
  }

  return (
    <div>
      {ids.map((id, i) => {
        const entry = linked.get(id);
        const ct = entry ? typesById.get(entry.content_type_id) : undefined;
        return (
          <div
            key={id}
            className={`ref-item${dragIndex === i ? ' dragging' : ''}`}
            draggable={multiple}
            onDragStart={() => setDragIndex(i)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIndex !== null && dragIndex !== i) move(dragIndex, i);
              setDragIndex(null);
            }}
          >
            {multiple && <span className="drag-handle"><Icon name="drag" size={13} /></span>}
            <Icon name="field-reference" size={14} />
            <span className="ref-title">
              {entry ? displayTitle(entry, ct, defaultLocale) : `${id.slice(0, 8)}…`}
            </span>
            {entry && <span className={`badge ${entry.status}`}>{entry.status.replace('_', ' ')}</span>}
            {ct && <span className="ref-type">{ct.name}</span>}
            <a className="icon-btn" href={`/entries/${id}`} target="_blank" rel="noreferrer" title="Open entry">
              <Icon name="open-external" size={12} />
            </a>
            <button
              className="icon-btn"
              title="Remove link"
              onClick={() => commit(ids.filter((x) => x !== id))}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        );
      })}

      <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={() => setPicking(true)}>
        + Link {multiple ? 'entries' : ids.length ? 'a different entry' : 'an entry'}
      </button>

      {picking && (
        <ReferenceSearchModal
          envPath={envPath}
          types={types}
          allowedContentTypes={allowedContentTypes}
          excludeIds={ids}
          defaultLocale={defaultLocale}
          onClose={() => setPicking(false)}
          onPick={(entry) => {
            setLinked((prev) => new Map(prev).set(entry.id, entry));
            commit(multiple ? [...ids, entry.id] : [entry.id]);
            if (!multiple) setPicking(false);
          }}
        />
      )}
    </div>
  );
}

export function ReferenceSearchModal({
  envPath,
  types,
  allowedContentTypes,
  excludeIds,
  defaultLocale,
  onClose,
  onPick,
}: {
  envPath: string;
  types: ContentType[];
  allowedContentTypes: string[];
  excludeIds: string[];
  defaultLocale: string;
  onClose: () => void;
  onPick: (entry: Entry) => void;
}) {
  const pickableTypes = useMemo(
    () =>
      allowedContentTypes.length
        ? types.filter((t) => allowedContentTypes.includes(t.api_id))
        : types,
    [types, allowedContentTypes],
  );
  const typesById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types]);

  const [q, setQ] = useState('');
  const [typeFilter, setTypeFilter] = useState(pickableTypes.length === 1 ? pickableTypes[0].api_id : '');
  const [status, setStatus] = useState('');
  const [results, setResults] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(() => {
    setLoading(true);
    const qs = new URLSearchParams({ limit: '25' });
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (typeFilter) qs.set('content_type', typeFilter);
    api<EntryList>(`${envPath}/entries?${qs}`)
      .then((data) => {
        let items = data.items.filter((e) => !excludeIds.includes(e.id));
        if (!typeFilter && allowedContentTypes.length) {
          const allowedTypeIds = new Set(pickableTypes.map((t) => t.id));
          items = items.filter((e) => allowedTypeIds.has(e.content_type_id));
        }
        setResults(items);
      })
      .finally(() => setLoading(false));
  }, [envPath, q, status, typeFilter, excludeIds, allowedContentTypes, pickableTypes]);

  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <Modal title="Link an entry" onClose={onClose} wide>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input
          className="input"
          placeholder="Search…"
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
          <option value="">{allowedContentTypes.length ? 'All allowed types' : 'All types'}</option>
          {pickableTypes.map((t) => (
            <option key={t.id} value={t.api_id}>{t.name}</option>
          ))}
        </select>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any status</option>
          <option value="published">published</option>
          <option value="draft">draft</option>
          <option value="in_review">in review</option>
        </select>
      </div>

      <div style={{ maxHeight: 380, overflowY: 'auto' }}>
        {loading && <p className="muted">Searching…</p>}
        {!loading && results.length === 0 && <p className="muted">No matching entries.</p>}
        {results.map((entry) => {
          const ct = typesById.get(entry.content_type_id);
          return (
            <div key={entry.id} className="ref-item" style={{ cursor: 'pointer' }} onClick={() => onPick(entry)}>
              <Icon name="content" size={14} />
              <span className="ref-title">{displayTitle(entry, ct, defaultLocale)}</span>
              <span className={`badge ${entry.status}`}>{entry.status.replace('_', ' ')}</span>
              <span className="ref-type">{ct?.name}</span>
              <span className="muted small mono">/{entry.slug}</span>
            </div>
          );
        })}
      </div>
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
