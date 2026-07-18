'use client';

/** Space dashboard: quick stats + shortcuts. */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import Icon, { IconName } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { useWorkspace } from '@/lib/workspace';
import type { ContentType, EntryList, MediaList } from '@/lib/types';

export default function HomePage() {
  const { space, environment, envPath, spacePath, user, loading, spaces, can } = useWorkspace();
  const [types, setTypes] = useState<ContentType[] | null>(null);
  const [entries, setEntries] = useState<EntryList | null>(null);
  const [media, setMedia] = useState<MediaList | null>(null);

  useEffect(() => {
    if (!envPath || !spacePath) return;
    api<ContentType[]>(`${envPath}/content-types`).then(setTypes).catch(() => setTypes([]));
    api<EntryList>(`${envPath}/entries?limit=1`).then(setEntries).catch(() => null);
    api<MediaList>(`${spacePath}/media?limit=1`).then(setMedia).catch(() => null);
  }, [envPath, spacePath]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!user)
    return (
      <div className="empty-state">
        <div className="big" style={{ color: 'var(--text-3)' }}><Icon name="lock" size={32} /></div>
        <h3>Welcome to {BRAND.name}</h3>
        <p className="muted">
          <Link href="/login">Sign in</Link> to manage your spaces and content, or{' '}
          <Link href="/signup">create an account</Link>.
        </p>
      </div>
    );
  if (spaces.length === 0)
    return (
      <div className="empty-state">
        <div className="big" style={{ color: 'var(--primary)' }}><Icon name="generate" size={32} /></div>
        <h3>Your account is ready</h3>
        <p className="muted">Create your first space to start modeling content.</p>
        {can('manage_spaces') && (
          <div style={{ marginTop: 14 }}>
            <Link href="/onboarding" className="btn">Start setup →</Link>
          </div>
        )}
      </div>
    );

  const cards: { href: string; icon: IconName; label: string; value: number | string }[] = [
    { href: '/content-types', icon: 'content-model', label: 'Content types', value: types?.length ?? '…' },
    { href: '/entries', icon: 'content', label: 'Entries', value: entries?.total ?? '…' },
    { href: '/media', icon: 'media', label: 'Media assets', value: media?.total ?? '…' },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>{space?.name ?? 'Dashboard'}</h1>
          <p className="subtitle">
            Environment <code>{environment?.key}</code> ·{' '}
            {space?.locales.map((l) => l.code).join(', ')}
          </p>
        </div>
      </div>

      <div className="card-grid">
        {cards.map((c) => (
          <Link key={c.href} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card type-card">
              <div className="type-icon"><Icon name={c.icon} size={17} /></div>
              <div style={{ fontSize: 26, fontWeight: 700 }}>{c.value}</div>
              <div className="type-meta">{c.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <h2>Getting started</h2>
        <ul style={{ lineHeight: 2, margin: 0 }}>
          <li><Link href="/content-types">Model content</Link> — types, references, localized fields</li>
          <li><Link href="/entries">Write content</Link> — with live preview and inline editing</li>
          <li><Link href="/settings/api-keys">Create API keys</Link> — fetch content from your apps</li>
          <li><Link href="/settings/webhooks">Add webhooks</Link> — notify your build pipeline on publish</li>
        </ul>
      </div>
    </div>
  );
}
