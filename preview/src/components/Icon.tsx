/**
 * Central icon wrapper for the preview site — the same contract as
 * `editor/src/components/ui/Icon.tsx`: a semantic-name → Bootstrap Icons map
 * rendering the **webfont** (`<i class="bi bi-…">`). The stylesheet is
 * imported once in `app/layout.tsx`.
 *
 * Glyphs inherit `currentColor` and `font-size`.
 *
 * Never write `<i className="bi bi-…">` at a call site and never inline an
 * SVG — add a semantic name here instead (see CLAUDE.md).
 */
import type { CSSProperties } from 'react';

/** Semantic name → Bootstrap Icons class suffix (`bi-<value>`). */
export const ICONS = {
  warning: 'exclamation-triangle-fill',
  forward: 'arrow-right-short',
  'edit-inline': 'pencil-fill',
} as const;

export type IconName = keyof typeof ICONS;

export default function Icon({
  name,
  size = 14,
  className,
  style,
  title,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  return (
    <i
      className={`bi bi-${ICONS[name]}${className ? ` ${className}` : ''}`}
      style={{ fontSize: size, lineHeight: 1, flexShrink: 0, ...style }}
      title={title}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
