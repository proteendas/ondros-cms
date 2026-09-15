'use client';

/**
 * Pick several values from a known list.
 *
 * A dropdown of the remaining options plus a removable chip per selection —
 * used where the old UI had a comma-separated text box, which silently
 * accepted typos that then matched nothing at runtime.
 *
 * Selecting from a list makes the valid set discoverable and the invalid set
 * unreachable.
 */
import Icon from '@/components/ui/Icon';
import Select from '@/components/ui/Select';

export default function MultiSelectChips({
  value,
  onChange,
  options,
  label,
  placeholder = 'Add…',
  emptyHint,
  disabled,
  /** Shown when `options` is empty — usually "nothing has been created yet". */
  noOptionsHint = 'Nothing available to choose from.',
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Either plain values, or {value,label} when they differ. */
  options: (string | { value: string; label: string })[];
  label?: string;
  placeholder?: string;
  /** Explains what an empty selection means, e.g. "empty = all". */
  emptyHint?: string;
  disabled?: boolean;
  noOptionsHint?: string;
}) {
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const available = normalized.filter((o) => !value.includes(o.value));
  const labelFor = (v: string) => normalized.find((o) => o.value === v)?.label ?? v;

  return (
    <div className="multiselect">
      {label && <label className="field-label">{label}</label>}

      {value.length > 0 && (
        <div className="multiselect-chips">
          {value.map((v) => (
            <span key={v} className="chip primary">
              <span className="mono">{labelFor(v)}</span>
              <button
                type="button"
                className="chip-remove"
                aria-label={`Remove ${labelFor(v)}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((x) => x !== v))}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      {normalized.length === 0 ? (
        <p className="help-text" style={{ marginTop: 6 }}>{noOptionsHint}</p>
      ) : (
        <Select
          // Always renders as the placeholder: picking an option appends it to
          // the chips rather than becoming the control's own value.
          value=""
          placeholder={available.length ? placeholder : 'All selected'}
          ariaLabel={label ?? 'Add item'}
          disabled={disabled || available.length === 0}
          onChange={(v) => v && onChange([...value, v])}
          options={available}
        />
      )}

      {emptyHint && value.length === 0 && <p className="help-text">{emptyHint}</p>}
    </div>
  );
}
