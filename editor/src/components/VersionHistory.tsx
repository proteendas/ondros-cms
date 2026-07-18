'use client';

/**
 * Version history panel (spec 006): lists snapshots, shows a per-field diff
 * against the CURRENT draft, restores with one click.
 */
import { useCallback, useEffect, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { Modal, formatDate, useToast } from '@/components/ui';
import type { Entry, EntryVersionFull, EntryVersionMeta } from '@/lib/types';

function preview(value: unknown): string {
  if (value === null || value === undefined) return '—';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  const clean = s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? `${clean.slice(0, 120)}…` : clean || '—';
}

export default function VersionHistory({
  entryId,
  currentFields,
  onClose,
  onRestored,
}: {
  entryId: string;
  currentFields: Record<string, unknown>;
  onClose: () => void;
  onRestored: (entry: Entry) => void;
}) {
  const toast = useToast();
  const [versions, setVersions] = useState<EntryVersionMeta[] | null>(null);
  const [selected, setSelected] = useState<EntryVersionFull | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<EntryVersionMeta[]>(`/entries/${entryId}/versions`)
      .then(setVersions)
      .catch(() => setVersions([]));
  }, [entryId]);

  const openVersion = useCallback(
    (version: number) => {
      api<EntryVersionFull>(`/entries/${entryId}/versions/${version}`).then(setSelected).catch(() => {});
    },
    [entryId],
  );

  async function restore(version: number) {
    setBusy(true);
    try {
      const entry = await api<Entry>(`/entries/${entryId}/versions/${version}/restore`, {
        method: 'POST',
      });
      toast(`Restored version ${version} (now v${entry.version})`);
      onRestored(entry);
      onClose();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Restore failed', 'error');
      setBusy(false);
    }
  }

  const diffKeys = selected
    ? Array.from(
        new Set([...Object.keys(selected.fields ?? {}), ...Object.keys(currentFields ?? {})]),
      ).filter((k) => JSON.stringify(selected.fields?.[k]) !== JSON.stringify(currentFields?.[k]))
    : [];

  return (
    <Modal title="Version history" subtitle="Snapshots are captured on every save." onClose={onClose} wide>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 240px', maxHeight: 420, overflowY: 'auto' }}>
          {versions === null && <p className="muted">Loading…</p>}
          {versions?.length === 0 && <p className="muted">No snapshots yet — edit the entry to create some.</p>}
          {(versions ?? []).map((v) => (
            <div
              key={v.version}
              className="ref-item"
              style={{
                cursor: 'pointer',
                borderColor: selected?.version === v.version ? 'var(--primary)' : undefined,
              }}
              onClick={() => openVersion(v.version)}
            >
              <strong>v{v.version}</strong>
              <span className={`badge ${v.status}`}>{v.status.replace('_', ' ')}</span>
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                {formatDate(v.created_at)}
              </span>
            </div>
          ))}
        </div>

        <div style={{ flex: '1 1 380px', minWidth: 320 }}>
          {!selected ? (
            <p className="muted">Select a version to compare it with the current draft.</p>
          ) : (
            <>
              <div className="row" style={{ marginBottom: 8 }}>
                <h3 style={{ margin: 0 }}>
                  v{selected.version} vs current draft
                </h3>
                <span className="spacer" />
                <button className="btn" disabled={busy} onClick={() => restore(selected.version)}>
                  {busy ? 'Restoring…' : <><Icon name="restore" size={13} /> Restore v{selected.version}</>}
                </button>
              </div>
              {diffKeys.length === 0 && (
                <p className="muted">No differences — this snapshot matches the current draft.</p>
              )}
              <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                {diffKeys.map((key) => (
                  <div key={key} className="ai-issue" style={{ borderColor: 'var(--primary)' }}>
                    <strong>{key}</strong>
                    <div className="muted small" style={{ marginTop: 4 }}>
                      <span style={{ color: 'var(--danger)' }}>− {preview(currentFields?.[key])}</span>
                      <br />
                      <span style={{ color: 'var(--success)' }}>+ {preview(selected.fields?.[key])}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
