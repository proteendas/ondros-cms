'use client';

/**
 * Post-signup onboarding wizard (spec 001):
 *   1. create the first Space
 *   2. pick locales (full ISO catalog) + default
 *   3. optionally create a first content type (skippable)
 */
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { LOCALE_CATALOG } from '@/lib/localeCatalog';
import type { ContentType, Space } from '@/lib/types';

function slugify(name: string, sep: '-' | '_' = '-'): string {
  const out = name.toLowerCase().replace(/[^a-z0-9]+/g, sep);
  return out.replace(new RegExp(`^\\${sep}+|\\${sep}+$`, 'g'), '');
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Step 1: space
  const [spaceName, setSpaceName] = useState('');
  // Step 2: locales
  const [localeQuery, setLocaleQuery] = useState('');
  const [selected, setSelected] = useState<string[]>(['en-US']);
  const [defaultLocale, setDefaultLocale] = useState('en-US');
  // Step 3: content type
  const [typeName, setTypeName] = useState('Blog Post');
  const [createdSpace, setCreatedSpace] = useState<Space | null>(null);

  const filtered = useMemo(
    () =>
      LOCALE_CATALOG.filter(
        (l) =>
          l.code.toLowerCase().includes(localeQuery.toLowerCase()) ||
          l.name.toLowerCase().includes(localeQuery.toLowerCase()),
      ),
    [localeQuery],
  );

  function toggleLocale(code: string) {
    setSelected((prev) => {
      const next = prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code];
      if (!next.includes(defaultLocale) && next.length) setDefaultLocale(next[0]);
      return next.length ? next : prev; // keep at least one
    });
  }

  async function createSpace() {
    setBusy(true);
    setError(null);
    try {
      const space = await api<Space>('/spaces', {
        method: 'POST',
        body: JSON.stringify({
          name: spaceName,
          slug: slugify(spaceName),
          locales: selected.map((code) => ({
            code,
            name: LOCALE_CATALOG.find((l) => l.code === code)?.name ?? code,
          })),
          default_locale: defaultLocale,
        }),
      });
      setCreatedSpace(space);
      window.localStorage.setItem('cms_space_id', space.id);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the space');
    } finally {
      setBusy(false);
    }
  }

  async function createFirstType(skip: boolean) {
    if (skip || !createdSpace) {
      window.location.href = '/';
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api<ContentType>(
        `/spaces/${createdSpace.id}/environments/master/content-types`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: typeName,
            api_id: slugify(typeName, '_'),
            display_field: 'title',
            fields: [
              { id: 'title', name: 'Title', type: 'text', localized: selected.length > 1,
                validations: { required: true, max_length: 120 } },
              { id: 'body', name: 'Body', type: 'richtext', localized: selected.length > 1,
                validations: {} },
            ],
          }),
        },
      );
      window.location.href = '/content-types';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the content type');
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card" style={{ width: 480 }}>
        <div className="row" style={{ marginBottom: 14 }}>
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className="badge plain"
              style={{
                background: step >= n ? 'var(--primary-soft)' : 'var(--surface-2)',
                color: step >= n ? 'var(--primary)' : 'var(--text-3)',
              }}
            >
              {n}. {n === 1 ? 'Space' : n === 2 ? 'Locales' : 'Content type'}
            </span>
          ))}
        </div>

        {step === 1 && (
          <>
            <h1 style={{ fontSize: 18, marginTop: 0 }}>Create your first space</h1>
            <p className="muted">A space holds one project's content — e.g. your website.</p>
            <label className="field-label">Space name</label>
            <input className="input" value={spaceName} autoFocus placeholder="e.g. Marketing Website"
                   onChange={(e) => setSpaceName(e.target.value)} />
            <button className="btn" disabled={!spaceName.trim()}
                    style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}
                    onClick={() => setStep(2)}>
              Continue →
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h1 style={{ fontSize: 18, marginTop: 0 }}>Pick your locales</h1>
            <p className="muted">Choose the languages you'll author content in — add more anytime.</p>
            <input className="input" placeholder="Search locales (e.g. hindi, fr, pt-BR)…"
                   value={localeQuery} onChange={(e) => setLocaleQuery(e.target.value)} />
            <div style={{ maxHeight: 220, overflowY: 'auto', margin: '10px 0', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
              {filtered.map((l) => (
                <label key={l.code} className="checkbox-row" style={{ margin: '2px 0' }}>
                  <input type="checkbox" checked={selected.includes(l.code)}
                         onChange={() => toggleLocale(l.code)} />
                  <code>{l.code}</code> {l.name}
                  {selected.includes(l.code) && (
                    <span style={{ marginLeft: 'auto' }}>
                      <input type="radio" name="default" checked={defaultLocale === l.code}
                             onChange={() => setDefaultLocale(l.code)} title="Default locale" />{' '}
                      <span className="muted small">default</span>
                    </span>
                  )}
                </label>
              ))}
            </div>
            <p className="muted small">
              Selected: {selected.join(', ')} · default <code>{defaultLocale}</code>
            </p>
            {error && <p className="error-text">{error}</p>}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn secondary" onClick={() => setStep(1)}>← Back</button>
              <span className="spacer" />
              <button className="btn" disabled={busy || !selected.length} onClick={createSpace}>
                {busy ? 'Creating…' : 'Create space →'}
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h1 style={{ fontSize: 18, marginTop: 0 }}>First content type</h1>
            <p className="muted">
              Start with a simple type (title + rich-text body). You can model everything else later.
            </p>
            <label className="field-label">Content type name</label>
            <input className="input" value={typeName} onChange={(e) => setTypeName(e.target.value)} />
            {error && <p className="error-text">{error}</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn ghost" disabled={busy} onClick={() => createFirstType(true)}>
                Skip for now
              </button>
              <span className="spacer" />
              <button className="btn" disabled={busy || !typeName.trim()} onClick={() => createFirstType(false)}>
                {busy ? 'Creating…' : 'Create & finish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
