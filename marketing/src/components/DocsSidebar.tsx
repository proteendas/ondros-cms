'use client';

/** Docs left nav (spec 011): grouped tree with active highlight; collapses
 * behind a toggle button on <=900px. */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { List } from 'react-bootstrap-icons';

import { DOCS_NAV, docHref } from '@/lib/docs-nav';

export default function DocsSidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <div>
      <button className="docs-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <List size={16} /> Docs menu
      </button>
      <nav className={`docs-sidebar${open ? ' open' : ''}`} aria-label="Documentation">
        {DOCS_NAV.map((section) => (
          <div key={section.label}>
            <h5>{section.label}</h5>
            {section.pages.map((page) => {
              const href = docHref(page.slug);
              const active = pathname === href;
              return (
                <Link key={href} href={href} className={active ? 'active' : ''}>
                  {page.title}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
