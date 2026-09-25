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
import Icon from '@/components/ui/Icon';
import Select from '@/components/ui/Select';

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
  // Text a slug field can be generated from: the type's display field, the way
  // Contentful derives a slug from the entry title.
  const titleField =
    contentType.fields.find((f) => f.id === contentType.display_field) ??
    contentType.fields.find((f) => f.type === 'text');
  const titleRaw = titleField ? values[titleField.id] : undefined;
  const slugSource =
    titleField && titleField.localized
      ? localizedValue(titleField, titleRaw, locale)
      : titleRaw;

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
              slugSource={f.type === 'slug' ? slugSource : undefined}
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
  slugSource,
}: {
  field: FieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
  allTypes: ContentType[];
  envPath: string;
  spacePath: string;
  defaultLocale: string;
  /** For slug fields: text to offer as a generated slug (usually the title). */
  slugSource?: unknown;
}) {
  switch (field.type) {
    case 'group':
      return (
        <GroupField
          field={field}
          value={value}
          onChange={onChange}
          allTypes={allTypes}
          envPath={envPath}
          spacePath={spacePath}
          defaultLocale={defaultLocale}
        />
      );
    case 'richtext':
      return (
        <RichTextField
          value={value as never}
          onChange={onChange}
          config={field.rich_text}
          envPath={envPath}
          spacePath={spacePath}
          allTypes={allTypes}
          defaultLocale={defaultLocale}
        />
      );
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
        <Select
          style={{ maxWidth: 280 }}
          ariaLabel={field.name}
          value={(value as string) ?? ''}
          onChange={(v) => onChange(v || null)}
          options={[
            { value: '', label: '—' },
            ...(field.validations.allowed_values ?? []).map((v) => ({ value: v, label: v })),
          ]}
        />
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
      return <SlugInput value={value} onChange={onChange} source={slugSource} />;
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

/** Lowercase, hyphen-separated, safe to drop into a URL path segment. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Slug field input. Typing is normalized to slug characters so an entry can
 * never autosave a value the delivery API would refuse to route, and the
 * title can be turned into a slug in one click.
 */
function SlugInput({
  value,
  onChange,
  source,
}: {
  value: unknown;
  onChange: (v: unknown) => void;
  source?: unknown;
}) {
  const current = (value as string) ?? '';
  const suggestion = typeof source === 'string' ? slugify(source) : '';
  return (
    <div className="row" style={{ gap: 6, alignItems: 'stretch' }}>
      <input
        className="input mono"
        style={{ flex: 1 }}
        value={current}
        placeholder={suggestion || 'my-page'}
        // Keep the hyphen the user is mid-typing, but drop everything the
        // slug pattern rejects.
        onChange={(e) => onChange(slugify(e.target.value.replace(/\s+/g, '-')))}
      />
      {suggestion && suggestion !== current && (
        <button
          type="button"
          className="btn secondary small"
          title={`Use "${suggestion}"`}
          onClick={() => onChange(suggestion)}
        >
          <Icon name="generate-slug" size={12} /> Generate
        </button>
      )}
    </div>
  );
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

/* ---- Repeatable group (multifield) --------------------------------------- */

/**
 * AEM-style multifield: a repeatable container of sub-fields.
 *
 * The stored value is an array of objects keyed by sub-field id. Rows can be
 * added, removed and reordered; row order IS the render order, so reordering
 * is a content decision, not a cosmetic one.
 *
 * Sub-fields are not individually localizable — localize the group as a whole
 * instead, which keeps the stored shape a flat {locale: rows[]} rather than a
 * locale map inside every row.
 */
function GroupField({
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
  const subFields = field.fields ?? [];
  const rows: Record<string, unknown>[] = Array.isArray(value)
    ? (value as Record<string, unknown>[])
    : [];

  const max = field.validations.max_items;
  const min = field.validations.min_items;
  const atMax = typeof max === 'number' && rows.length >= max;

  function update(next: Record<string, unknown>[]) {
    onChange(next);
  }

  function addRow() {
    if (atMax) return;
    update([...rows, {}]);
  }

  function removeRow(index: number) {
    update(rows.filter((_, i) => i !== index));
  }

  function moveRow(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    update(next);
  }

  function setCell(index: number, subId: string, v: unknown) {
    update(rows.map((row, i) => (i === index ? { ...row, [subId]: v } : row)));
  }

  if (subFields.length === 0) {
    return (
      <p className="help-text">
        <Icon name="warning" size={12} /> This group has no sub-fields yet — add
        some in the content model.
      </p>
    );
  }

  return (
    <div className="group-field">
      {rows.length === 0 && (
        <p className="muted small" style={{ margin: '4px 0 10px' }}>
          No items yet.
          {typeof min === 'number' && min > 0 && ` At least ${min} required.`}
        </p>
      )}

      {rows.map((row, index) => (
        <div className="group-item" key={index}>
          <div className="group-item-head">
            <span className="group-item-index">{index + 1}</span>
            <span className="spacer" />
            <button
              type="button" className="btn ghost tiny" title="Move up"
              disabled={index === 0} onClick={() => moveRow(index, -1)}
            >
              <Icon name="move-up" size={12} />
            </button>
            <button
              type="button" className="btn ghost tiny" title="Move down"
              disabled={index === rows.length - 1} onClick={() => moveRow(index, 1)}
            >
              <Icon name="move-down" size={12} />
            </button>
            <button
              type="button" className="btn ghost tiny" title="Remove item"
              style={{ color: 'var(--danger)' }} onClick={() => removeRow(index)}
            >
              <Icon name="delete" size={12} />
            </button>
          </div>

          <div className="group-item-body">
            {subFields.map((sf) => (
              <div key={sf.id}>
                <label className="field-label">
                  {sf.name}
                  {sf.validations?.required && <span className="error-text">*</span>}
                  <span className="field-type-tag">{sf.type}</span>
                </label>
                <FieldInput
                  field={sf}
                  value={row[sf.id]}
                  onChange={(v) => setCell(index, sf.id, v)}
                  allTypes={allTypes}
                  envPath={envPath}
                  spacePath={spacePath}
                  defaultLocale={defaultLocale}
                />
                {sf.help_text && <p className="help-text">{sf.help_text}</p>}
              </div>
            ))}
          </div>
        </div>
      ))}

      <button type="button" className="btn secondary small" disabled={atMax} onClick={addRow}>
        <Icon name="add" size={13} /> Add item
      </button>
      {atMax && <span className="muted small" style={{ marginLeft: 8 }}>Maximum {max} reached.</span>}
    </div>
  );
}
