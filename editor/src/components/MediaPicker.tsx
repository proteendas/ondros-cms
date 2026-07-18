'use client';

/**
 * Media field widget: pick one or many assets from the media library,
 * with inline search and drag-and-drop upload inside the picker modal.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { API_URL, api, getToken } from '@/lib/api';
import { Modal, formatBytes } from '@/components/ui';
import type { MediaAsset, MediaList } from '@/lib/types';

interface Props {
  spacePath: string; // /spaces/{id}
  envPath: string;   // /spaces/{id}/environments/{key}
  multiple: boolean;
  value: unknown; // string | string[] | null
  onChange: (value: unknown) => void;
}

export function assetThumb(asset: MediaAsset): React.ReactNode {
  if (asset.mime_type.startsWith('image/')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`${API_URL}${asset.url}`} alt={asset.alt_text || asset.filename} />;
  }
  if (asset.mime_type.startsWith('video/')) return <Icon name="media-video" size={26} />;
  if (asset.mime_type === 'application/pdf') return <Icon name="media-pdf" size={26} />;
  return <Icon name="media-file" size={26} />;
}

export default function MediaPicker({ spacePath, envPath, multiple, value, onChange }: Props) {
  const ids = useMemo<string[]>(() => {
    if (multiple) return Array.isArray(value) ? (value as string[]) : [];
    return typeof value === 'string' && value ? [value] : [];
  }, [value, multiple]);

  const [assets, setAssets] = useState<Map<string, MediaAsset>>(new Map());
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    const missing = ids.filter((id) => !assets.has(id));
    if (!missing.length) return;
    Promise.all(missing.map((id) => api<MediaAsset>(`/media/${id}`).catch(() => null))).then(
      (fetched) => {
        setAssets((prev) => {
          const next = new Map(prev);
          fetched.forEach((a) => a && next.set(a.id, a));
          return next;
        });
      },
    );
  }, [ids, assets]);

  function commit(nextIds: string[]) {
    onChange(multiple ? nextIds : nextIds[0] ?? null);
  }

  return (
    <div>
      {ids.length > 0 && (
        <div className="picker-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', maxHeight: 'none' }}>
          {ids.map((id) => {
            const asset = assets.get(id);
            return (
              <div key={id} className="picker-tile" style={{ cursor: 'default' }}>
                <div className="thumb">{asset ? assetThumb(asset) : '…'}</div>
                <div className="tile-name">{asset?.filename ?? id.slice(0, 8)}</div>
                <button
                  type="button"
                  className="btn ghost tiny"
                  style={{ margin: '0 0 6px', color: 'var(--danger)' }}
                  onClick={() => commit(ids.filter((x) => x !== id))}
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
      <button type="button" className="btn secondary small" style={{ marginTop: 8 }} onClick={() => setPicking(true)}>
        <Icon name="media" size={13} /> {ids.length ? (multiple ? 'Add more media' : 'Replace media') : 'Choose media'}
      </button>

      {picking && (
        <MediaPickerModal
          spacePath={spacePath}
          envPath={envPath}
          onClose={() => setPicking(false)}
          onPick={(asset) => {
            setAssets((prev) => new Map(prev).set(asset.id, asset));
            commit(multiple ? [...ids.filter((x) => x !== asset.id), asset.id] : [asset.id]);
            if (!multiple) setPicking(false);
          }}
        />
      )}
    </div>
  );
}

export function MediaPickerModal({
  spacePath,
  envPath,
  onClose,
  onPick,
}: {
  spacePath: string;
  envPath: string;
  onClose: () => void;
  onPick: (asset: MediaAsset) => void;
}) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<MediaAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: '60' });
    if (q) qs.set('q', q);
    if (kind) qs.set('kind', kind);
    api<MediaList>(`${spacePath}/media?${qs}`).then((d) => setItems(d.items)).catch(() => {});
  }, [spacePath, q, kind]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`${API_URL}${envPath}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${getToken()}` },
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).detail ?? 'Upload failed');
      }
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal title="Media library" onClose={onClose} wide>
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input className="input" placeholder="Search media…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">All kinds</option>
          <option value="image">Images</option>
          <option value="video">Videos</option>
          <option value="file">Files</option>
        </select>
        <span className="spacer" />
        <label className="btn secondary small" style={{ cursor: 'pointer' }}>
          {uploading ? 'Uploading…' : <><Icon name="upload" size={13} /> Upload</>}
          <input type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
        </label>
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="picker-grid">
        {items.map((asset) => (
          <div key={asset.id} className="picker-tile" onClick={() => onPick(asset)}>
            <div className="thumb">{assetThumb(asset)}</div>
            <div className="tile-name" title={asset.filename}>
              {asset.filename}
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="muted">No media yet — upload something.</p>}
      </div>
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}
