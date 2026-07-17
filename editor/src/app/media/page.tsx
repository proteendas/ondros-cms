'use client';

/**
 * Media library: grid with filters, drag-and-drop upload, multi-select bulk
 * actions, and a metadata detail panel (title, description, alt text, tags).
 */
import { useCallback, useEffect, useState } from 'react';

import { API_URL, api, getToken } from '@/lib/api';
import { ConfirmDialog, Modal, formatBytes, formatDate, useToast } from '@/components/ui';
import { assetThumb } from '@/components/MediaPicker';
import { useWorkspace } from '@/lib/workspace';
import type { MediaAsset, MediaList } from '@/lib/types';

const PAGE_SIZE = 40;

export default function MediaLibraryPage() {
  const toast = useToast();
  const { envPath, spacePath, can } = useWorkspace();

  const [list, setList] = useState<MediaList | null>(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    if (!spacePath) return;
    const qs = new URLSearchParams({ limit: String(PAGE_SIZE), skip: String(page * PAGE_SIZE) });
    if (q) qs.set('q', q);
    if (kind) qs.set('kind', kind);
    if (tag) qs.set('tag', tag);
    api<MediaList>(`${spacePath}/media?${qs}`)
      .then((d) => {
        setList(d);
        setSelected(new Set());
      })
      .catch(() => setList({ items: [], total: 0, skip: 0, limit: PAGE_SIZE }));
  }, [spacePath, q, kind, tag, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function upload(files: FileList | File[] | null) {
    if (!files || !envPath) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_URL}${envPath}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).detail ?? `Upload failed: ${file.name}`);
      }
      toast(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`);
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  }

  async function bulkDelete() {
    for (const id of Array.from(selected)) {
      await api(`/media/${id}`, { method: 'DELETE' }).catch(() => {});
    }
    toast(`Deleted ${selected.size} assets`);
    load();
  }

  function toggle(id: string, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(id);
    else next.delete(id);
    setSelected(next);
  }

  const totalPages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;

  if (!spacePath || !envPath) return <p className="muted">Select a space…</p>;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (can('manage_media')) void upload(e.dataTransfer.files);
      }}
    >
      <div className="page-header">
        <div>
          <h1>Media</h1>
          <p className="subtitle">{list ? `${list.total} assets` : '…'}</p>
        </div>
        <span className="spacer" />
        {can('manage_media') && (
          <label className="btn" style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : '⬆ Upload'}
            <input type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
          </label>
        )}
      </div>

      {can('manage_media') && (
        <div className={`dropzone${dragOver ? ' over' : ''}`}>
          Drag & drop files anywhere on this page to upload
        </div>
      )}

      <div className="toolbar">
        <input className="input" placeholder="Search media…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className="input" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }}>
          <option value="">All kinds</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="file">Files</option>
        </select>
        <input className="input" placeholder="Filter by tag…" value={tag} onChange={(e) => { setTag(e.target.value); setPage(0); }} style={{ minWidth: 140 }} />
        {selected.size > 0 && can('manage_media') && (
          <>
            <span className="muted">{selected.size} selected</span>
            <button className="btn danger secondary small" onClick={() => setConfirmDelete(true)}>
              Delete selected
            </button>
          </>
        )}
      </div>

      <div className="media-grid">
        {(list?.items ?? []).map((asset) => (
          <div
            key={asset.id}
            className={`media-card${selected.has(asset.id) ? ' selected' : ''}`}
            onClick={() => setDetail(asset)}
          >
            <span className="check" onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={selected.has(asset.id)}
                onChange={(e) => toggle(asset.id, e.target.checked)}
              />
            </span>
            <div className="thumb">{assetThumb(asset)}</div>
            <div className="media-meta">
              <div className="media-name" title={asset.filename}>{asset.title || asset.filename}</div>
              <div className="media-sub">
                {asset.mime_type.split('/')[1] ?? asset.mime_type} · {formatBytes(asset.size_bytes)}
                {asset.width ? ` · ${asset.width}×${asset.height}` : ''}
              </div>
              {asset.tags.length > 0 && (
                <div className="media-sub">{asset.tags.map((t) => `#${t}`).join(' ')}</div>
              )}
            </div>
          </div>
        ))}
      </div>
      {list && list.items.length === 0 && (
        <p className="muted" style={{ textAlign: 'center', padding: 24 }}>No media found.</p>
      )}

      {list && list.total > PAGE_SIZE && (
        <div className="pagination">
          <button className="btn secondary small" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="muted">Page {page + 1} of {totalPages}</span>
          <button className="btn secondary small" disabled={page + 1 >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {detail && (
        <AssetDetailModal
          asset={detail}
          canEdit={can('manage_media')}
          onClose={() => setDetail(null)}
          onSaved={(updated) => {
            setDetail(updated);
            load();
          }}
          onDeleted={() => {
            setDetail(null);
            load();
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete ${selected.size} assets?`}
          message="Files are removed from storage. Entries referencing them will show broken media."
          onClose={() => setConfirmDelete(false)}
          onConfirm={bulkDelete}
        />
      )}
    </div>
  );
}

function AssetDetailModal({
  asset,
  canEdit,
  onClose,
  onSaved,
  onDeleted,
}: {
  asset: MediaAsset;
  canEdit: boolean;
  onClose: () => void;
  onSaved: (a: MediaAsset) => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const [title, setTitle] = useState(asset.title);
  const [altText, setAltText] = useState(asset.alt_text);
  const [description, setDescription] = useState(asset.description);
  const [tags, setTags] = useState(asset.tags.join(', '));
  const [confirming, setConfirming] = useState(false);

  async function save() {
    const updated = await api<MediaAsset>(`/media/${asset.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title,
        alt_text: altText,
        description,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      }),
    });
    toast('Asset updated');
    onSaved(updated);
  }

  return (
    <Modal title={asset.filename} onClose={onClose} wide>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 280px' }}>
          <div className="thumb" style={{ borderRadius: 8, overflow: 'hidden', background: 'var(--surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200, fontSize: 48 }}>
            {assetThumb(asset)}
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>
            {asset.mime_type} · {formatBytes(asset.size_bytes)}
            {asset.width ? ` · ${asset.width}×${asset.height}px` : ''}
            <br />
            Uploaded {formatDate(asset.created_at)}
          </p>
          <p className="mono small" style={{ wordBreak: 'break-all' }}>
            <a href={`${API_URL}${asset.url}`} target="_blank" rel="noreferrer">
              {API_URL}{asset.url}
            </a>
          </p>
          {asset.mime_type.startsWith('image/') && (
            <p className="muted small">
              Variants: <code>/media/{asset.id.slice(0, 8)}…/variant?w=800&fmt=webp</code>
            </p>
          )}
        </div>
        <div style={{ flex: '1 1 280px' }}>
          <label className="field-label" style={{ marginTop: 0 }}>Title</label>
          <input className="input" value={title} disabled={!canEdit} onChange={(e) => setTitle(e.target.value)} />
          <label className="field-label">Alt text</label>
          <input className="input" value={altText} disabled={!canEdit} onChange={(e) => setAltText(e.target.value)} />
          <label className="field-label">Description</label>
          <textarea className="input" rows={3} value={description} disabled={!canEdit} onChange={(e) => setDescription(e.target.value)} />
          <label className="field-label">Tags (comma-separated)</label>
          <input className="input" value={tags} disabled={!canEdit} onChange={(e) => setTags(e.target.value)} />
        </div>
      </div>
      <div className="modal-footer">
        {canEdit && (
          <button className="btn danger secondary" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
        <span className="spacer" />
        <button className="btn secondary" onClick={onClose}>Close</button>
        {canEdit && <button className="btn" onClick={save}>Save</button>}
      </div>
      {confirming && (
        <ConfirmDialog
          title="Delete this asset?"
          message="The file is removed from storage."
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await api(`/media/${asset.id}`, { method: 'DELETE' });
            onDeleted();
          }}
        />
      )}
    </Modal>
  );
}
