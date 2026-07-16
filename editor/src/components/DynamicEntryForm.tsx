'use client';

/**
 * Renders a form dynamically from a content type's FieldDef[] schema.
 * Add new field types here (and in preview EntryRenderer) — switch on f.type.
 */
import type { ContentType, FieldDef } from '@/lib/types';

import RichTextField from './RichTextField';

interface Props {
  contentType: ContentType;
  values: Record<string, unknown>;
  onChange: (fieldId: string, value: unknown) => void;
  /** Field highlighted because it was selected in the preview inspector. */
  selectedFieldId?: string | null;
  onFieldFocus?: (fieldId: string) => void;
}

export default function DynamicEntryForm({
  contentType,
  values,
  onChange,
  selectedFieldId,
  onFieldFocus,
}: Props) {
  return (
    <div>
      {contentType.fields.map((f) => (
        <div
          key={f.id}
          id={`field-${f.id}`}
          className={selectedFieldId === f.id ? 'field-selected' : undefined}
          onFocusCapture={() => onFieldFocus?.(f.id)}
        >
          <label className="field-label">
            {f.name} {f.validations.required && <span className="error-text">*</span>}{' '}
            <span className="muted" style={{ fontWeight: 400 }}>
              ({f.type}
              {f.validations.max_length ? `, max ${f.validations.max_length}` : ''})
            </span>
          </label>
          <FieldInput field={f} value={values[f.id]} onChange={(v) => onChange(f.id, v)} />
          {f.help_text && <p className="help-text">{f.help_text}</p>}
        </div>
      ))}
    </div>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  switch (field.type) {
    case 'richtext':
      return <RichTextField value={(value as string) ?? ''} onChange={onChange} />;
    case 'number':
      return (
        <input
          className="input"
          type="number"
          value={(value as number) ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : +e.target.value)}
        />
      );
    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    case 'date':
      return (
        <input
          className="input"
          type="date"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'select':
      return (
        <select
          className="input"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {(field.validations.allowed_values ?? []).map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      );
    case 'media':
    case 'reference':
      // Placeholder: stores a plain id/URL string. Replace with a media picker /
      // reference search modal backed by /media and /entries endpoints.
      return (
        <input
          className="input"
          placeholder={field.type === 'media' ? 'Media URL or asset id' : 'Referenced entry id'}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'slug':
    case 'text':
    default: {
      const long = (field.validations.max_length ?? 0) > 160 || !field.validations.max_length;
      return long && field.type === 'text' ? (
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
