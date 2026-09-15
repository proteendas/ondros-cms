'use client';

/**
 * Full-page status screen — the shared shell behind every UX-state route
 * (404, 403, 500, maintenance, offline, session expired) and the payment
 * result pages.
 *
 * One component rather than a dozen near-identical pages, so the states stay
 * visually consistent and a change to the layout lands everywhere at once.
 */
import Link from 'next/link';

import Icon, { type IconName } from '@/components/ui/Icon';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface StatusAction {
  label: string;
  href?: string;
  onClick?: () => void;
  /** The visually dominant action. Exactly one per page, ideally. */
  primary?: boolean;
}

export default function StatusPage({
  code,
  icon,
  tone = 'neutral',
  title,
  message,
  actions = [],
  children,
}: {
  /** Big HTTP-ish code shown above the title, e.g. "404". Optional. */
  code?: string;
  icon: IconName;
  tone?: StatusTone;
  title: string;
  message: React.ReactNode;
  actions?: StatusAction[];
  children?: React.ReactNode;
}) {
  return (
    <div className="status-page">
      <div className={`status-icon ${tone}`}>
        <Icon name={icon} size={30} />
      </div>
      {code && <div className="status-code">{code}</div>}
      <h1 className="status-title">{title}</h1>
      <div className="status-message">{message}</div>

      {children && <div className="status-extra">{children}</div>}

      {actions.length > 0 && (
        <div className="status-actions">
          {actions.map((a) =>
            a.href ? (
              <Link key={a.label} href={a.href} className={`btn${a.primary ? '' : ' secondary'}`}>
                {a.label}
              </Link>
            ) : (
              <button
                key={a.label}
                className={`btn${a.primary ? '' : ' secondary'}`}
                onClick={a.onClick}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
