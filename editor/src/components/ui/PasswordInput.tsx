'use client';

/**
 * Password / secret input with a show-hide toggle.
 *
 * Drop-in replacement for `<input className="input" type="password" …>`. Use it
 * for anything sensitive — passwords, client secrets, API tokens — so the
 * reveal affordance behaves identically everywhere.
 *
 * Accessibility notes:
 *  - the toggle is a real button with an aria-label that reflects STATE, so a
 *    screen reader announces "Show password" / "Hide password" rather than a
 *    generic "eye";
 *  - it carries `tabIndex={-1}` so Tab moves from the field to the submit
 *    button, the order people actually expect when typing a password;
 *  - `aria-pressed` exposes the toggle state.
 *
 * Security note: revealed text is visible to anyone near the screen, so the
 * field always starts masked and never persists the revealed state.
 */
import { useId, useState } from 'react';

import Icon from '@/components/ui/Icon';

export default function PasswordInput({
  value,
  onChange,
  id,
  className = 'input',
  autoComplete = 'current-password',
  placeholder,
  required,
  minLength,
  maxLength,
  autoFocus,
  disabled,
  style,
  onKeyDown,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  /** Extra classes are appended, e.g. `input mono` for secrets. */
  className?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  autoFocus?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  ariaLabel?: string;
}) {
  const [shown, setShown] = useState(false);
  const reactId = useId();
  const inputId = id ?? reactId;

  return (
    <div className="password-field" style={style}>
      <input
        id={inputId}
        className={className}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
        // Reserve room for the toggle so long values never slide underneath it.
        style={{ paddingRight: 38 }}
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setShown((s) => !s)}
        // Keep Tab going field -> submit, not field -> eye -> submit.
        tabIndex={-1}
        disabled={disabled}
        aria-pressed={shown}
        aria-controls={inputId}
        aria-label={shown ? 'Hide password' : 'Show password'}
        title={shown ? 'Hide' : 'Show'}
      >
        <Icon name={shown ? 'inspector-off' : 'inspector-on'} size={15} />
      </button>
    </div>
  );
}
