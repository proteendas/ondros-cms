'use client';

/**
 * Entry editor: three panes.
 *   left   — DynamicEntryForm (schema-driven inputs, locale tabs, TipTap)
 *   center — LivePreviewPane (draft-mode iframe of the preview app)
 *   right  — AISidebar (generate / transform / SEO / translate / compliance)
 *
 * Data flow:
 *   typing -> local state -> debounced PATCH /entries/{id}
 *          -> backend broadcasts entry.updated on /ws/entries/{id}
 *          -> preview bridge refreshes (plus an instant postMessage patch)
 *   preview click  -> postMessage -> useInspectorMessages -> select field
 *   preview inline edit -> postMessage -> PATCH (editor owns the JWT)
 */
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import AISidebar from '@/components/AISidebar';
import DynamicEntryForm from '@/components/DynamicEntryForm';
import LivePreviewPane, { LivePreviewHandle } from '@/components/LivePreviewPane';
import VersionHistory from '@/components/VersionHistory';
import Icon from '@/components/ui/Icon';
import { useInspectorMessages } from '@/components/InspectorMode';
import { api } from '@/lib/api';
import { useEntrySocket } from '@/lib/useEntrySocket';
import { useWorkspace } from '@/lib/workspace';
import { withLocalizedValue } from '@/lib/types';
import type { ContentType, Entry, EntryStatus } from '@/lib/types';

const SAVE_DEBOUNCE_MS = 600;

const NEXT_STATUS: Record<EntryStatus, { label: string; to: EntryStatus; primary?: boolean }[]> = {
  draft: [
    { label: 'Submit for review', to: 'in_review' },
    { label: 'Publish', to: 'published', primary: true },
  ],
  in_review: [
    { label: 'Back to draft', to: 'draft' },
    { label: 'Publish', to: 'published', primary: true },
  ],
  published: [
    { label: 'Unpublish', to: 'draft' },
    { label: 'Archive', to: 'archived' },
    { label: 'Publish changes', to: 'published', primary: true },
  ],
  archived: [{ label: 'Restore to draft', to: 'draft' }],
};

type PaneMode = 'split' | 'form' | 'preview';

export default function EntryEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { space, environment, envPath, spacePath, can } = useWorkspace();

  const [entry, setEntry] = useState<Entry | null>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [allTypes, setAllTypes] = useState<ContentType[]>([]);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [error, setError] = useState<string | null>(null);
  const [pane, setPane] = useState<PaneMode>('split');
  const [showHistory, setShowHistory] = useState(false);

  const locales = space?.locales ?? [{ code: 'en-US', name: 'English (US)' }];
  const defaultLocale = space?.default_locale ?? 'en-US';
  const [locale, setLocale] = useState(defaultLocale);
  useEffect(() => setLocale(defaultLocale), [defaultLocale]);

  const previewRef = useRef<LivePreviewHandle>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const hasLocalizedFields = useMemo(
    () => (contentType?.fields ?? []).some((f) => f.localized),
    [contentType],
  );

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

  useEffect(() => {
    if (!envPath) return;
    api<ContentType[]>(`${envPath}/content-types`).then(setAllTypes).catch(() => {});
  }, [envPath]);

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
      setEntry((prev) =>
        prev ? { ...prev, version: updated.version, status: updated.status, fields: updated.fields } : updated,
      );
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
    (entryId: string, fieldId: string, value: string, editLocale?: string) => {
      if (!entry || entryId === entry.id) {
        const fd = contentType?.fields.find((f) => f.id === fieldId);
        const raw = valuesRef.current[fieldId];
        const next = fd?.localized
          ? withLocalizedValue(fd, raw, editLocale || locale, value)
          : value;
        setValues((prev) => ({ ...prev, [fieldId]: next }));
        queueSave(fieldId, next);
        return;
      }
      // Edit on a NESTED assembly block: patch that entry directly.
      void (async () => {
        try {
          const target = await api<Entry>(`/entries/${entryId}`);
          const targetCt =
            allTypes.find((t) => t.id === target.content_type_id) ??
            (await api<ContentType>(`/content-types/${target.content_type_id}`));
          const fd = targetCt.fields.find((f) => f.id === fieldId);
          const next = fd?.localized
            ? withLocalizedValue(fd, target.fields?.[fieldId], editLocale || locale, value)
            : value;
          await api(`/entries/${entryId}`, {
            method: 'PATCH',
            body: JSON.stringify({ fields: { [fieldId]: next } }),
          });
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Failed to save nested block edit');
        }
      })();
    },
    [queueSave, contentType, locale, entry, allTypes],
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
      const action = { published: 'publish', archived: 'archive' }[to as string] ?? (entry.status === 'published' ? 'unpublish' : null);
      const updated =
        action && ['publish', 'unpublish', 'archive'].includes(action)
          ? await api<Entry>(`/entries/${entry.id}/${action}`, { method: 'POST' })
          : await api<Entry>(`/entries/${entry.id}/transition`, {
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

  const hasUnpublishedChanges =
    entry.status === 'published' &&
    JSON.stringify(entry.fields ?? {}) !== JSON.stringify(entry.published_fields ?? {});

  const nextActions = NEXT_STATUS[entry.status].filter(
    (action) => action.to !== entry.status || (action.to === 'published' && hasUnpublishedChanges),
  );

  const showForm = pane !== 'preview';
  const showPreview = pane !== 'form';

  return (
    <div>
      <div className="page-header" style={{ marginBottom: 10 }}>
        <div>
          <h1 style={{ margin: 0 }}>
            {contentType.name} <span className="muted mono">/{entry.slug}</span>
          </h1>
        </div>
        <span className={`badge ${entry.status}`}>{entry.status.replace('_', ' ')}</span>
        <span className="muted small">v{entry.version}</span>
        <span className="save-indicator">
          <span className={`dot ${saveState}`} />
          {saveState === 'saved' && 'Saved'}
          {saveState === 'dirty' && 'Unsaved changes'}
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'error' && <span className="error-text">Save failed</span>}
        </span>
        <span className="spacer" />
        <div className="tabs" style={{ border: 'none', marginBottom: 0 }}>
          {(['form', 'split', 'preview'] as PaneMode[]).map((m) => (
            <button key={m} className={`tab${pane === m ? ' active' : ''}`} onClick={() => setPane(m)}>
              {m === 'form' ? 'Editor' : m === 'split' ? 'Split' : 'Preview'}
            </button>
          ))}
        </div>
        <button className="btn secondary small" onClick={() => setShowHistory(true)}>
          <Icon name="history" size={13} /> History
        </button>
        {can('publish_entries') &&
          nextActions.map(({ label, to, primary }) => (
            <button key={label} className={`btn${primary ? '' : ' secondary'}`} onClick={() => transition(to)}>
              {label}
            </button>
          ))}
      </div>
      {error && (
        <p className="error-text" style={{ whiteSpace: 'pre-wrap' }}>
          {error}
        </p>
      )}

      <div className="editor-layout">
        {showForm && (
          <div className="editor-form">
            {(hasLocalizedFields || locales.length > 1) && (
              <div className="tabs">
                {locales.map((l) => (
                  <button
                    key={l.code}
                    className={`tab${locale === l.code ? ' active' : ''}`}
                    onClick={() => setLocale(l.code)}
                    title={l.name}
                  >
                    {l.code}
                    {l.code === defaultLocale && ' ★'}
                  </button>
                ))}
              </div>
            )}
            <div className="card">
              <DynamicEntryForm
                contentType={contentType}
                allTypes={allTypes}
                values={values}
                onChange={handleFieldChange}
                locale={locale}
                defaultLocale={defaultLocale}
                envPath={envPath ?? ''}
                spacePath={spacePath ?? ''}
                selectedFieldId={selectedFieldId}
                onFieldFocus={setSelectedFieldId}
              />
            </div>
          </div>
        )}

        {showPreview && (
          <div className="editor-preview">
            <LivePreviewPane
              ref={previewRef}
              entry={entry}
              contentType={contentType}
              spaceId={space?.id ?? ''}
              environmentKey={environment?.key ?? 'master'}
              locale={locale}
              onFieldSelected={onFieldSelected}
              onInlineCommit={onInlineEdit}
            />
          </div>
        )}

        {showHistory && entry && (
          <VersionHistory
            entryId={entry.id}
            currentFields={values}
            onClose={() => setShowHistory(false)}
            onRestored={(restored) => {
              setEntry(restored);
              setValues(restored.fields ?? {});
            }}
          />
        )}

        <div className="editor-side">
          <AISidebar
            contentType={contentType}
            entryId={entry.id}
            spaceId={entry.space_id}
            environmentId={entry.environment_id}
            values={values}
            locale={locale}
            defaultLocale={defaultLocale}
            locales={locales.map((l) => l.code)}
            selectedFieldId={selectedFieldId}
            onApplyField={handleFieldChange}
            onApplyFields={applyGeneratedFields}
          />
        </div>
      </div>
    </div>
  );
}
