'use client';

/**
 * Renders a form dynamically from a content type's FieldDef[] schema.
 *
 * Locale-aware: fields with `localized: true` store {locale: value} maps; the
 * form shows the value for the active locale and writes back into the map.
 * Add new field types here (and in the preview EntryRenderer).
 */
import { useState } from 'react';

import { localizedValue, withLocalizedValue } from '@/lib/types';
import type { ContentType, FieldDef } from '@/lib/types';

import MediaPicker from './MediaPicker';
import ReferencePicker from './ReferencePicker';
import RichTextField from './RichTextField';

interface Props {
  contentType: ContentType;
  /** All content types in the environment (for reference pickers). */
  allTypes: ContentType[];
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  locale: string;
  defaultLocale: string;
  envPath: string;
  spacePath: string;
  /** Field highlighted because it was selected in the preview inspector. */
  selectedFieldId?: string | null;
  onFieldFocus?: (fieldId: string) => void;
}

export default function DynamicEntryForm({
  contentType,
  allTypes,
  values,
  onChange,
  locale,
  defaultLocale,
  envPath,
  spacePath,
  selectedFieldId,
  onFieldFocus,
}: Props) {
  return (
    <div>
      {contentType.fields.map((f) => {
        const raw = values[f.id];
        const display = f.localized ? localizedValue(f, raw, locale) : raw;
        const setValue = (v: unknown) =>
          onChange(f.id, f.localized ? withLocalizedValue(f, raw, locale, v) : v);
        return (
          <div
            key={f.id}
            id={`field-${f.id}`}
            className={selectedFieldId === f.id ? 'field-selected' : undefined}
            onFocusCapture={() => onFieldFocus?.(f.id)}
          >
            <label className="field-label">
              {f.name}
              {f.validations.required && <span className="error-text">*</span>}
              <span className="field-type-tag">{f.type}</span>
              {f.localized && <span className="field-type-tag">{locale}</span>}
              {f.validations.max_length ? (
                <span className="muted small" style={{ fontWeight: 400 }}>
                  {typeof display === 'string' ? `${display.length}/` : ''}
                  {f.validations.max_length}
                </span>
              ) : null}
            </label>
            <FieldInput
              field={f}
              value={display}
              onChange={setValue}
              allTypes={allTypes}
              envPath={envPath}
              spacePath={spacePath}
              defaultLocale={defaultLocale}
            />
            {f.help_text && <p className="help-text">{f.help_text}</p>}
          </div>
        );
      })}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
  allTypes,
  envPath,
  spacePath,
  defaultLocale,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  allTypes: ContentType[];
  envPath: string;
  spacePath: string;
  defaultLocale: string;
}) {
  switch (field.type) {
    case 'richtext':
      return <RichTextField value={(value as string) ?? ''} onChange={onChange} />;
    case 'longtext':
      return (
        <textarea
          className="input"
          rows={5}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'number':
      return (
        <input
          className="input"
          type="number"
          style={{ maxWidth: 200 }}
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)}
        />
      );
    case 'boolean':
      return (
        <label className="checkbox-row" style={{ margin: 0 }}>
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          <span className="muted">{value ? 'Yes' : 'No'}</span>
        </label>
      );
    case 'datetime':
      return (
        <input
          className="input"
          type="datetime-local"
          style={{ maxWidth: 240 }}
          value={typeof value === 'string' ? value.slice(0, 16) : ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case 'date':
      return (
        <input
          className="input"
          type="date"
          style={{ maxWidth: 200 }}
          value={(value as string)?.slice(0, 10) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <select
          className="input"
          style={{ maxWidth: 280 }}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {(field.validations.allowed_values ?? []).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    case 'media':
    case 'media_many':
      return (
        <MediaPicker
          spacePath={spacePath}
          envPath={envPath}
          multiple={field.type === 'media_many'}
          value={value}
          onChange={onChange}
        />
      );
    case 'reference':
    case 'reference_many':
      return (
        <ReferencePicker
          envPath={envPath}
          types={allTypes}
          allowedContentTypes={field.allowed_content_types ?? []}
          multiple={field.type === 'reference_many'}
          value={value}
          onChange={onChange}
          defaultLocale={defaultLocale}
        />
      );
    case 'json':
      return <JsonInput value={value} onChange={onChange} />;
    case 'slug':
      return (
        <input
          className="input mono"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'text':
    default: {
      const long = (field.validations.max_length ?? 0) > 160;
      return long ? (
        <textarea
          className="input"
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          className="input"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

function JsonInput({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (value == null ? '' : JSON.stringify(value, null, 2)));
  const [invalid, setInvalid] = useState(false);

  return (
    <div>
      <textarea
        className="input mono"
        rows={6}
        value={text}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (!t.trim()) {
            setInvalid(false);
            onChange(null);
            return;
          }
          try {
            onChange(JSON.parse(t));
            setInvalid(false);
          } catch {
            setInvalid(true); // keep typing; only valid JSON is saved
          }
        }}
      />
      {invalid && <p className="error-text small">Invalid JSON — changes not saved yet.</p>}
    </div>
  );
}
