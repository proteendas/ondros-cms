'use client';

/**
 * AI assistant sidebar for the entry editor.
 *  - Generate: fill all fields from an editorial brief (RAG-grounded).
 *  - Rewrite / Shorten / Expand / SEO: transform the selected field.
 *  - Titles: suggest headlines from the body; click to apply.
 *  - SEO meta: generate title/description/keywords from the content.
 *  - Translate: fill the active locale from the default locale.
 *  - Compliance: audit current draft values against ingested guidelines.
 *
 * All calls hit /ai/* endpoints; guideline retrieval happens server-side.
 * Works with any configured provider (Groq/Gemini/Ollama/OpenRouter/OpenAI/Azure).
 */
import { useEffect, useMemo, useState } from 'react';

import Icon from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { localizedValue, withLocalizedValue } from '@/lib/types';
import type { AiStatus, ComplianceResult, ContentType, FieldDef } from '@/lib/types';

import { aiOutputToRichText, richTextToText } from './richtext/convert';

interface Props {
  contentType: ContentType;
  entryId: string;
  spaceId: string;
  environmentId: string;
  values: Record<string, unknown>;
  locale: string;
  defaultLocale: string;
  locales: string[];
  selectedFieldId: string | null;
  /** Apply a single AI-produced value into the form (and autosave). */
  onApplyField: (fieldId: string, value: unknown) => void;
  /** Apply a whole set of generated fields. */
  onApplyFields: (fields: Record<string, unknown>) => void;
}

type TransformMode = 'rewrite' | 'shorten' | 'expand' | 'seo';

/** Current display value of a field in the active locale, as plain text.
 * Richtext fields store JSON docs (or legacy HTML) — extract their text. */
function fieldText(fd: FieldDef | undefined, values: Record<string, unknown>, locale: string): string {
  if (!fd) return '';
  const v = fd.localized ? localizedValue(fd, values[fd.id], locale) : values[fd.id];
  if (fd.type === 'richtext') return richTextToText(v as never);
  return typeof v === 'string' ? v : '';
}

/** Coerce an AI string result into the right shape for the target field:
 * richtext fields become a TipTap JSON doc; everything else stays a string. */
function shapeForField(fd: FieldDef, value: unknown): unknown {
  if (fd.type === 'richtext' && typeof value === 'string') return aiOutputToRichText(value);
  return value;
}

export default function AISidebar({
  contentType,
  entryId,
  spaceId,
  environmentId,
  values,
  locale,
  defaultLocale,
  locales,
  selectedFieldId,
  onApplyField,
  onApplyFields,
}: Props) {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compliance, setCompliance] = useState<ComplianceResult | null>(null);
  const [titles, setTitles] = useState<string[]>([]);
  const [guidelinesUsed, setGuidelinesUsed] = useState<string[]>([]);
  const [translateTarget, setTranslateTarget] = useState('');

  useEffect(() => {
    // Default the translate target to the first other active locale.
    const other = locales.find((code) => code !== locale);
    setTranslateTarget((prev) => (prev && prev !== locale ? prev : other ?? ''));
  }, [locales, locale]);

  useEffect(() => {
    api<AiStatus>('/ai/status').then(setStatus).catch(() => {});
  }, []);

  const fields = contentType.fields;
  const bodyField = useMemo(
    () => fields.find((f) => f.type === 'richtext') ?? fields.find((f) => f.type === 'longtext'),
    [fields],
  );
  const titleField = useMemo(
    () =>
      fields.find((f) => f.id === contentType.display_field) ??
      fields.find((f) => f.type === 'text'),
    [fields, contentType.display_field],
  );
  const seoField = useMemo(() => fields.find((f) => f.id.includes('seo')), [fields]);

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

  /** Write a value into a (possibly localized) field at the active locale,
   * shaping AI text into a JSON doc for richtext fields. */
  function applyLocalized(fd: FieldDef, value: unknown) {
    const shaped = shapeForField(fd, value);
    onApplyField(fd.id, fd.localized ? withLocalizedValue(fd, values[fd.id], locale, shaped) : shaped);
  }

  async function generate() {
    const result = await run('generate', () =>
      api<{ fields: Record<string, unknown>; guidelines_used: string[] }>('/ai/generate-entry', {
        method: 'POST',
        body: JSON.stringify({
          content_type_id: contentType.id,
          space_id: spaceId,
          environment_id: environmentId,
          locale,
          brief,
        }),
      }),
    );
    if (result) {
      // Wrap localized fields so generation lands in the active locale.
      const wrapped: Record<string, unknown> = {};
      for (const [fid, v] of Object.entries(result.fields)) {
        const fd = fields.find((f) => f.id === fid);
        if (!fd) continue;
        const shaped = shapeForField(fd, v);
        wrapped[fid] = fd.localized ? withLocalizedValue(fd, values[fid], locale, shaped) : shaped;
      }
      onApplyFields(wrapped);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  async function transform(mode: TransformMode) {
    if (!selectedFieldId) return;
    const fd = fields.find((f) => f.id === selectedFieldId);
    const current = fieldText(fd, values, locale);
    if (!current.trim()) {
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
          locale,
        }),
      }),
    );
    if (result && fd) {
      applyLocalized(fd, result.text);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  async function suggestTitles() {
    const body = fieldText(bodyField, values, locale);
    if (!body.trim()) {
      setError('Write some body content first.');
      return;
    }
    const result = await run('titles', () =>
      api<{ titles: string[] }>('/ai/suggest-titles', {
        method: 'POST',
        body: JSON.stringify({ body, content_type_id: contentType.id, count: 5, locale }),
      }),
    );
    if (result) setTitles(result.titles);
  }

  async function seoMeta() {
    const body = fieldText(bodyField, values, locale);
    const title = fieldText(titleField, values, locale);
    if (!body.trim() && !title.trim()) {
      setError('Write a title or body first.');
      return;
    }
    const result = await run('seo-meta', () =>
      api<{ seo_title: string; seo_description: string; keywords: string[]; guidelines_used: string[] }>(
        '/ai/seo-meta',
        {
          method: 'POST',
          body: JSON.stringify({ title, body, content_type_id: contentType.id, locale }),
        },
      ),
    );
    if (result) {
      if (seoField) applyLocalized(seoField, result.seo_description);
      setGuidelinesUsed(result.guidelines_used);
      setTitles(result.seo_title ? [result.seo_title] : []);
    }
  }

  async function translate(targetLocale: string) {
    // Source = the locale currently being edited; target = any other active locale.
    const sourceLocale = locale;
    const source: Record<string, unknown> = {};
    for (const fd of fields) {
      if (!fd.localized) continue;
      const v = localizedValue(fd, values[fd.id], sourceLocale);
      if (fd.type === 'richtext') {
        const text = richTextToText(v as never);
        if (text.trim()) source[fd.id] = text;
      } else if (typeof v === 'string' && v.trim()) {
        source[fd.id] = v;
      }
    }
    if (!Object.keys(source).length) {
      setError(`Nothing to translate from ${sourceLocale}.`);
      return;
    }
    const result = await run('translate', () =>
      api<{ fields: Record<string, unknown>; guidelines_used: string[] }>('/ai/translate-fields', {
        method: 'POST',
        body: JSON.stringify({
          content_type_id: contentType.id,
          fields: source,
          source_locale: sourceLocale,
          target_locale: targetLocale,
        }),
      }),
    );
    if (result) {
      const wrapped: Record<string, unknown> = {};
      for (const [fid, v] of Object.entries(result.fields)) {
        const fd = fields.find((f) => f.id === fid);
        if (!fd) continue;
        wrapped[fid] = withLocalizedValue(fd, values[fid], targetLocale, shapeForField(fd, v));
      }
      onApplyFields(wrapped);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  async function checkCompliance() {
    // Audit the active locale's resolved values.
    const resolved: Record<string, unknown> = {};
    for (const fd of fields) {
      const v = fd.localized ? localizedValue(fd, values[fd.id], locale) : values[fd.id];
      resolved[fd.id] = fd.type === 'richtext' ? richTextToText(v as never) : v;
    }
    const result = await run('compliance', () =>
      api<ComplianceResult>('/ai/check-compliance', {
        method: 'POST',
        body: JSON.stringify({ content_type_id: contentType.id, fields: resolved, locale }),
      }),
    );
    if (result) {
      setCompliance(result);
      setGuidelinesUsed(result.guidelines_used);
    }
  }

  const selected = fields.find((f) => f.id === selectedFieldId);
  const aiOff = status !== null && !status.configured;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>AI assistant</h2>
        <span className="spacer" />
        {status && (
          <span className="provider-pill" title={`retrieval: ${status.retrieval_mode}`}>
            <span className={`dot ${status.configured ? 'on' : 'off'}`} />
            {status.configured ? `${status.provider} · ${status.chat_model}` : 'not configured'}
          </span>
        )}
      </div>

      {aiOff && (
        <p className="muted small">
          Set <code>AI_PROVIDER</code> in <code>.env</code> — free options: <code>groq</code>,{' '}
          <code>gemini</code>, or local <code>ollama</code>. See .env.example.
        </p>
      )}

      <label className="field-label" style={{ marginTop: 4 }}>Brief</label>
      <textarea
        className="input"
        rows={3}
        placeholder="e.g. Announcement post for our new usage dashboard, friendly tone"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
      />
      <div style={{ marginTop: 8 }}>
        <button className="btn" onClick={generate} disabled={!!busy || !brief.trim() || aiOff}>
          {busy === 'generate' ? 'Generating…' : <><Icon name="generate" size={13} /> Generate fields ({locale})</>}
        </button>
      </div>

      <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

      <p className="muted" style={{ margin: '0 0 6px' }}>
        Selected: {selected ? <strong>{selected.name}</strong> : <em>click a field or a preview element</em>}
      </p>
      <div className="row wrap">
        {(['rewrite', 'shorten', 'expand', 'seo'] as TransformMode[]).map((mode) => (
          <button
            key={mode}
            className="btn secondary small"
            disabled={!!busy || !selectedFieldId || aiOff}
            onClick={() => transform(mode)}
          >
            {busy === mode ? '…' : mode === 'seo' ? 'SEO tone' : mode[0].toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      <hr style={{ margin: '14px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

      <div className="row wrap">
        <button className="btn secondary small" onClick={suggestTitles} disabled={!!busy || aiOff}>
          {busy === 'titles' ? '…' : <><Icon name="suggest-titles" size={13} /> Suggest titles</>}
        </button>
        <button className="btn secondary small" onClick={seoMeta} disabled={!!busy || aiOff}>
          {busy === 'seo-meta' ? '…' : <><Icon name="seo" size={13} /> SEO meta</>}
        </button>
        <button className="btn secondary small" onClick={checkCompliance} disabled={!!busy || aiOff}>
          {busy === 'compliance' ? '…' : <><Icon name="compliance" size={13} /> Compliance</>}
        </button>
      </div>

      {locales.length > 1 && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
            <Icon name="translate" size={13} /> AI translate {locale} to
          </span>
          <select
            className="input"
            style={{ maxWidth: 130 }}
            value={translateTarget}
            onChange={(e) => setTranslateTarget(e.target.value)}
          >
            {locales
              .filter((code) => code !== locale)
              .map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
          </select>
          <button
            className="btn secondary small"
            disabled={!!busy || aiOff || !translateTarget || translateTarget === locale}
            onClick={() => translate(translateTarget)}
          >
            {busy === 'translate' ? '…' : 'Go'}
          </button>
        </div>
      )}

      {titles.length > 0 && titleField && (
        <div style={{ marginTop: 10 }}>
          <p className="muted small" style={{ margin: '0 0 4px' }}>
            Click to apply to <strong>{titleField.name}</strong>:
          </p>
          {titles.map((t, i) => (
            <div
              key={i}
              className="ai-suggestion"
              onClick={() => {
                applyLocalized(titleField, t);
                setTitles([]);
              }}
            >
              {t}
            </div>
          ))}
        </div>
      )}

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
