'use client';

/**
 * Themed dropdown replacing the native <select> (whose popup list is drawn by
 * the OS and ignores our design tokens entirely).
 *
 * Renders a button + a listbox popover styled from globals.css, so the open
 * menu matches the rest of the product in every browser. The popover is
 * portalled to <body> and positioned with fixed coordinates, so it is never
 * clipped by a modal, toolbar or scroll container.
 *
 * Keyboard/ARIA parity with a native select: Up/Down/Home/End move the active
 * option, Enter/Space commit, Escape/Tab close, and typing jumps to a match.
 *
 * Usage:
 *   <Select value={kind} onChange={setKind} options={[{ value: '', label: 'All kinds' }]} />
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import Icon, { type IconName } from '@/components/ui/Icon';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
  /** Optional trailing marker (e.g. `star` for "you own this account"). */
  icon?: IconName;
  /** Accessible description for `icon`, also used as its tooltip. */
  iconTitle?: string;
}

/** Visual contexts that exist in the app — see globals.css `.select-trigger`. */
export type SelectVariant = 'input' | 'chrome' | 'toolbar';

const MENU_MAX_HEIGHT = 280;
const MENU_MARGIN = 6;

export default function Select({
  value,
  onChange,
  options,
  variant = 'input',
  placeholder = '— select —',
  disabled,
  className,
  style,
  title,
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  variant?: SelectVariant;
  /** Shown when `value` matches no option (mirrors an unset native select). */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; drop: 'down' | 'up' } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef<{ query: string; at: number }>({ query: '', at: 0 });

  const reactId = useId();
  const listboxId = `${id ?? reactId}-listbox`;

  const selectedIndex = useMemo(() => options.findIndex((o) => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  /* ---- Positioning ------------------------------------------------------- */

  const position = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    // Flip above only when there genuinely isn't room below but there is above.
    const drop = below < Math.min(MENU_MAX_HEIGHT, 160) && r.top > below ? 'up' : 'down';
    setRect({
      top: drop === 'down' ? r.bottom + MENU_MARGIN : r.top - MENU_MARGIN,
      left: r.left,
      width: r.width,
      drop,
    });
  }, []);

  // useEffect (not useLayoutEffect) keeps this SSR-safe: the menu isn't rendered
  // until `rect` is set, so there is no unpositioned frame to flash.
  useEffect(() => {
    if (!open) return;
    position();
    // `true` captures scrolls in any ancestor container, not just the window.
    window.addEventListener('scroll', position, true);
    window.addEventListener('resize', position);
    return () => {
      window.removeEventListener('scroll', position, true);
      window.removeEventListener('resize', position);
    };
  }, [open, position]);

  /* ---- Open/close -------------------------------------------------------- */

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }, [disabled, options, selectedIndex]);

  const closeMenu = useCallback((refocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    typeahead.current = { query: '', at: 0 };
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const opt = options[index];
      if (!opt || opt.disabled) return;
      if (opt.value !== value) onChange(opt.value);
      closeMenu();
    },
    [closeMenu, onChange, options, value],
  );

  // Close on outside pointer events (trigger clicks are handled by the trigger).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open, closeMenu]);

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = menuRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  /* ---- Keyboard ---------------------------------------------------------- */

  const step = useCallback(
    (from: number, delta: number) => {
      if (!options.length) return -1;
      let i = from;
      // Skip disabled options; stop at the ends rather than wrapping (native behaviour).
      for (let guard = 0; guard < options.length; guard += 1) {
        const next = i + delta;
        if (next < 0 || next >= options.length) return i >= 0 && !options[i]?.disabled ? i : -1;
        i = next;
        if (!options[i].disabled) return i;
      }
      return i;
    },
    [options],
  );

  const edge = useCallback(
    (dir: 'first' | 'last') => {
      const list = dir === 'first' ? options : [...options].reverse();
      const found = list.findIndex((o) => !o.disabled);
      if (found < 0) return -1;
      return dir === 'first' ? found : options.length - 1 - found;
    },
    [options],
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        closeMenu();
        break;
      case 'Tab':
        closeMenu(false);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => step(i, 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i < 0 ? edge('last') : step(i, -1)));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(edge('first'));
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(edge('last'));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(activeIndex);
        break;
      default:
        // Typeahead: consecutive keystrokes within 700ms build a search string.
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          const t = typeahead.current;
          t.query = now - t.at > 700 ? e.key : t.query + e.key;
          t.at = now;
          const q = t.query.toLowerCase();
          const hit = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(q));
          if (hit >= 0) setActiveIndex(hit);
        }
    }
  }

  /* ---- Render ------------------------------------------------------------ */

  const label = selected ? selected.label : placeholder;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        className={`select-trigger ${variant}${open ? ' open' : ''}${className ? ` ${className}` : ''}`}
        style={style}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span className={`select-value${selected ? '' : ' placeholder'}`}>{label}</span>
        {selected?.icon && <Icon name={selected.icon} size={10} title={selected.iconTitle} />}
        <Icon name="chevron-down" size={variant === 'toolbar' ? 11 : 13} className="select-caret" />
      </button>

      {open && rect &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel ?? title}
            className="select-menu"
            style={{
              position: 'fixed',
              top: rect.drop === 'down' ? rect.top : undefined,
              bottom: rect.drop === 'up' ? window.innerHeight - rect.top : undefined,
              left: rect.left,
              minWidth: rect.width,
              maxHeight: MENU_MAX_HEIGHT,
            }}
          >
            {options.length === 0 && <li className="select-empty">No options</li>}
            {options.map((o, i) => (
              <li
                key={`${o.value}-${i}`}
                id={`${listboxId}-${i}`}
                role="option"
                data-index={i}
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={`select-option${i === activeIndex ? ' active' : ''}${
                  o.value === value ? ' selected' : ''
                }${o.disabled ? ' disabled' : ''}`}
                // onMouseDown would fire before the outside-click handler settles.
                onMouseEnter={() => !o.disabled && setActiveIndex(i)}
                onClick={() => commit(i)}
              >
                <span className="select-option-label">{o.label}</span>
                {o.icon && <Icon name={o.icon} size={10} title={o.iconTitle} />}
                {o.value === value && <Icon name="check" size={13} className="select-tick" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
