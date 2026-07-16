'use client';

/**
 * Entry editor: three panes.
 *   left   — DynamicEntryForm (schema-driven inputs, TipTap for richtext)
 *   center — LivePreviewPane (draft-mode iframe of the preview app)
 *   right  — AISidebar (generate / transform / compliance)
 *
 * Data flow:
 *   typing -> local state -> debounced PATCH /entries/{id}
 *          -> backend broadcasts entry.updated on /ws/entries/{id}
 *          -> preview bridge refreshes (plus an instant postMessage patch)
 *   preview click  -> postMessage -> useInspectorMessages -> select field
 *   preview inline edit -> postMessage -> PATCH (editor owns the JWT)
 */
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import AISidebar from '@/components/AISidebar';
import DynamicEntryForm from '@/components/DynamicEntryForm';
import LivePreviewPane, { LivePreviewHandle } from '@/components/LivePreviewPane';
import { useInspectorMessages } from '@/components/InspectorMode';
import { api } from '@/lib/api';
import { useEntrySocket } from '@/lib/useEntrySocket';
import type { ContentType, Entry, EntryStatus } from '@/lib/types';

const SAVE_DEBOUNCE_MS = 600;

const NEXT_STATUS: Record<EntryStatus, { label: string; to: EntryStatus }[]> = {
  draft: [
    { label: 'Submit for review', to: 'in_review' },
    { label: 'Publish', to: 'published' },
  ],
  in_review: [
    { label: 'Back to draft', to: 'draft' },
    { label: 'Publish', to: 'published' },
  ],
  published: [{ label: 'Unpublish', to: 'draft' }],
  archived: [{ label: 'Restore to draft', to: 'draft' }],
};

export default function EntryEditorPage() {
  const { id } = useParams<{ id: string }>();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);

  const previewRef = useRef<LivePreviewHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});

  // ---- initial load -------------------------------------------------------
  useEffect(() => {
    api<Entry>(`/entries/${id}`)
      .then(async (e) => {
        setEntry(e);
        setValues(e.fields ?? {});
        const ct = await api<ContentType>(`/content-types/${e.content_type_id}`);
        setContentType(ct);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  // ---- saving (debounced, merge-patch) ------------------------------------
  const flushSave = useCallback(async () => {
    const patch = pendingPatch.current;
    pendingPatch.current = {};
    if (Object.keys(patch).length === 0) return;
    setSaveState('saving');
    try {
      const updated = await api<Entry>(`/entries/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ fields: patch }),
      });
      setEntry((prev) => (prev ? { ...prev, version: updated.version, status: updated.status } : updated));
      setSaveState('saved');
    } catch (e) {
      setSaveState('error');
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  }, [id]);

  const queueSave = useCallback(
    (fieldId: string, value: unknown) => {
      pendingPatch.current[fieldId] = value;
      setSaveState('dirty');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  const handleFieldChange = useCallback(
    (fieldId: string, value: unknown) => {
      setValues((prev) => ({ ...prev, [fieldId]: value }));
      queueSave(fieldId, value);
      // Optimistically patch the preview DOM before the WS round-trip lands.
      if (entry) previewRef.current?.notifyFieldUpdated(entry.id, fieldId, value);
    },
    [queueSave, entry],
  );

  const applyGeneratedFields = useCallback(
    (fields: Record<string, unknown>) => {
      setValues((prev) => ({ ...prev, ...fields }));
      Object.entries(fields).forEach(([fieldId, value]) => queueSave(fieldId, value));
    },
    [queueSave],
  );

  // ---- inspector + inline edits arriving from the preview iframe ----------
  const onFieldSelected = useCallback((entryId: string, fieldId: string) => {
    setSelectedFieldId(fieldId);
    document.getElementById(`field-${fieldId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const onInlineEdit = useCallback(
    (entryId: string, fieldId: string, value: string) => {
      setValues((prev) => ({ ...prev, [fieldId]: value }));
      queueSave(fieldId, value);
    },
    [queueSave],
  );

  useInspectorMessages({ onFieldSelected, onInlineEdit });

  // ---- live updates from other clients ------------------------------------
  useEntrySocket(entry?.id ?? null, (msg) => {
    // Track version/status only; merging remote field edits into a form the
    // user is typing in needs OT/CRDT (see README "Real-time collaboration").
    if (msg.type === 'entry.updated' || msg.type === 'entry.transitioned') {
      setEntry((prev) =>
        prev
          ? {
              ...prev,
              version: (msg.version as number) ?? prev.version,
              status: (msg.status as EntryStatus) ?? prev.status,
            }
          : prev,
      );
    }
  });

  // ---- workflow ------------------------------------------------------------
  async function transition(to: EntryStatus) {
    if (!entry) return;
    setError(null);
    await flushSave();
    try {
      const updated = await api<Entry>(`/entries/${entry.id}/transition`, {
        method: 'POST',
        body: JSON.stringify({ status: to }),
      });
      setEntry(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transition failed');
    }
  }

  if (error && !entry) return <p className="error-text">{error}</p>;
  if (!entry || !contentType) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h1 style={{ margin: 0 }}>
          {contentType.name}: {entry.slug}
        </h1>
        <span className={`badge ${entry.status}`}>{entry.status}</span>
        <span className="muted">v{entry.version}</span>
        <span className="muted">
          {saveState === 'saved' && '✓ saved'}
          {saveState === 'dirty' && '…'}
          {saveState === 'saving' && 'saving…'}
          {saveState === 'error' && <span className="error-text">save failed</span>}
        </span>
        <span className="spacer" />
        {NEXT_STATUS[entry.status].map(({ label, to }) => (
          <button key={to} className="btn secondary" onClick={() => transition(to)}>
            {label}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}

      <div className="editor-layout">
        <div className="editor-form card">
          <DynamicEntryForm
            contentType={contentType}
            values={values}
            onChange={handleFieldChange}
            selectedFieldId={selectedFieldId}
            onFieldFocus={setSelectedFieldId}
          />
        </div>

        <div className="editor-preview">
          <LivePreviewPane
            ref={previewRef}
            entry={entry}
            contentType={contentType}
            onFieldSelected={onFieldSelected}
            onInlineCommit={onInlineEdit}
          />
        </div>

        <div className="editor-ai">
          <AISidebar
            contentType={contentType}
            entryId={entry.id}
            spaceId={entry.space_id}
            values={values}
            selectedFieldId={selectedFieldId}
            onApplyField={handleFieldChange}
            onApplyFields={applyGeneratedFields}
          />
        </div>
      </div>
    </div>
  );
}
