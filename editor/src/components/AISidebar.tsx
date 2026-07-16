'use client';

/**
 * AI assistant sidebar for the entry editor.
 *  - Generate: fill all fields from an editorial brief (RAG-grounded).
 *  - Rewrite / Shorten / Expand / SEO: transform the currently selected field.
 *  - Check compliance: audit current draft values against ingested guidelines.
 *
 * All calls hit /ai/* endpoints; guideline retrieval happens server-side.
 */
import { useState } from 'react';

import { api } from '@/lib/api';
import type { ComplianceResult, ContentType } from '@/lib/types';

interface Props {
  contentType: ContentType;
  entryId: string;
  spaceId: string;
  values: Record<string, unknown>;
  selectedFieldId: string | null;
  /** Apply a single AI-produced value into the form (and autosave). */
  onApplyField: (fieldId: string, value: unknown) => void;
  /** Apply a whole set of generated fields. */
  onApplyFields: (fields: Record<string, unknown>) => void;
}

type TransformMode = 'rewrite' | 'shorten' | 'expand' | 'seo';

export default function AISidebar({
  contentType,
  entryId,
  spaceId,
  values,
  selectedFieldId,
  onApplyField,
  onApplyFields,
}: Props) {
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [guidelinesUsed, setGuidelinesUsed] = useState<string[]>([]);

  async function run<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI request failed');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function generate() {
    const result = await run('generate', () =>
      api<{ fields: Record<string, unknown>; guidelines_used: string[] }>('/ai/generate-entry', {
        method: 'POST',
        body: JSON.stringify({
          content_type_id: contentType.id,
          space_id: spaceId,
          brief,
        }),
      }),
    );
    if (result) {
      onApplyFields(result.fields);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  async function transform(mode: TransformMode) {
    if (!selectedFieldId) return;
    const current = values[selectedFieldId];
    if (typeof current !== 'string' || !current.trim()) {
      setError('Selected field has no text to transform.');
      return;
    }
    const result = await run(mode, () =>
      api<{ text: string; guidelines_used: string[] }>('/ai/transform-field', {
        method: 'POST',
        body: JSON.stringify({
          text: current,
          mode,
          content_type_id: contentType.id,
          field_id: selectedFieldId,
          entry_id: entryId,
        }),
      }),
    );
    if (result) {
      onApplyField(selectedFieldId, result.text);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  async function checkCompliance() {
    const result = await run('compliance', () =>
      api<ComplianceResult>('/ai/check-compliance', {
        method: 'POST',
        body: JSON.stringify({ content_type_id: contentType.id, fields: values }),
      }),
    );
    if (result) {
      setCompliance(result);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  const selected = contentType.fields.find((f) => f.id === selectedFieldId);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>AI assistant</h2>

      <label className="field-label">Brief</label>
      <textarea
        className="input"
        rows={4}
        placeholder="e.g. Announcement post for our new usage dashboard, friendly tone, aimed at existing customers"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={generate} disabled={!!busy || !brief.trim()}>
          {busy === 'generate' ? 'Generating…' : 'Generate all fields'}
        </button>
      </div>

      <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #eef0f3' }} />

      <p className="muted" style={{ margin: '0 0 6px' }}>
        Selected field: {selected ? <strong>{selected.name}</strong> : <em>click a field (or an element in the preview)</em>}
      </p>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {(['rewrite', 'shorten', 'expand', 'seo'] as TransformMode[]).map((mode) => (
          <button
            key={mode}
            className="btn secondary small"
            disabled={!!busy || !selectedFieldId}
            onClick={() => transform(mode)}
          >
            {busy === mode ? '…' : mode === 'seo' ? 'SEO' : mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <hr style={{ margin: '16px 0', border: 'none', borderTop: '1px solid #eef0f3' }} />

      <button className="btn secondary" onClick={checkCompliance} disabled={!!busy}>
        {busy === 'compliance' ? 'Checking…' : 'Check compliance'}
      </button>

      {compliance && (
        <div style={{ marginTop: 10 }}>
          {compliance.passed && compliance.issues.length === 0 ? (
            <p className="badge published">All checks passed</p>
          ) : (
            compliance.issues.map((issue, i) => (
              <div key={i} className={`ai-issue ${issue.severity}`}>
                <strong>{issue.field_id}</strong> — {issue.message}
                {issue.suggestion && (
                  <div className="muted" style={{ marginTop: 4 }}>
                    Fix: {issue.suggestion}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {error && <p className="error-text">{error}</p>}

      {guidelinesUsed.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="muted">Guidelines used ({guidelinesUsed.length})</summary>
          {guidelinesUsed.map((g, i) => (
            <p key={i} className="muted" style={{ fontSize: 12 }}>
              {g}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
