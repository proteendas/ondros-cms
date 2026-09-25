'use client';

/**
 * Code Sync settings: connect this space to the GitHub repository that renders
 * its site.
 *
 * Preview works the way Adobe's Universal Editor does — the editor loads the
 * project's own deployed site in an iframe rather than rendering content
 * generically. This page is where that link is made: install the GitHub App,
 * pick a repository and branch, and check that the repo's component manifest
 * covers the content model.
 */
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { api } from '@/lib/api';
import { ConfirmDialog, EmptyState, formatDate, useToast } from '@/components/ui';
import Icon from '@/components/ui/Icon';
import Select from '@/components/ui/Select';
import { useWorkspace } from '@/lib/workspace';
import type {
  CodeSyncRepository,
  CodeSyncState,
  CodeSyncSyncResult,
} from '@/lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function CodeSyncPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <CodeSyncPageInner />
    </Suspense>
  );
}

function CodeSyncPageInner() {
  const toast = useToast();
  const params = useSearchParams();
  const { space, environment, can } = useWorkspace();

  const [state, setState] = useState<CodeSyncState | null>(null);
  const [repos, setRepos] = useState<CodeSyncRepository[] | null>(null);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');
  const [sync, setSync] = useState<CodeSyncSyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const editable = can('manage_settings');
  // GitHub sends people back here after an install with these in the query.
  const justInstalled = params.get('setup_action');

  const load = useCallback(() => {
    if (!space) return;
    api<CodeSyncState>(`/spaces/${space.id}/code-sync`)
      .then((s) => {
        setState(s);
        setBranch(s.connection?.branch ?? '');
        setPreviewUrl(s.connection?.preview_base_url ?? '');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load Code Sync'));
  }, [space]);

  useEffect(load, [load, justInstalled]);

  async function loadRepos() {
    if (!space) return;
    setBusy(true);
    setError(null);
    try {
      const list = await api<CodeSyncRepository[]>(`/spaces/${space.id}/code-sync/repositories`);
      setRepos(list);
      if (list.length && !repo) {
        setRepo(list[0].fullName);
        setBranch(list[0].defaultBranch);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list repositories');
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    if (!space || !repo) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api<CodeSyncState>(`/spaces/${space.id}/code-sync/connect`, {
        method: 'POST',
        body: JSON.stringify({
          repo_full_name: repo,
          branch: branch || 'main',
          preview_base_url: previewUrl,
          installation_id: state?.connection?.installation_id ?? '',
        }),
      });
      setState(next);
      toast(`Connected to ${repo}`);
      await runSync();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    if (!space) return;
    setBusy(true);
    try {
      const qs = environment ? `?environment=${encodeURIComponent(environment.key)}` : '';
      const result = await api<CodeSyncSyncResult>(
        `/spaces/${space.id}/code-sync/sync${qs}`,
        { method: 'POST' },
      );
      setSync(result);
      if (result.status === 'error') toast(result.error, 'error');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    if (!space) return;
    setBusy(true);
    try {
      const next = await api<CodeSyncState>(`/spaces/${space.id}/code-sync`, {
        method: 'PATCH',
        body: JSON.stringify({ branch, preview_base_url: previewUrl }),
      });
      setState(next);
      toast('Saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!space) return <p className="muted">Select a space…</p>;
  if (!state) return <p className="muted">Loading…</p>;

  const conn = state.connection;
  const installHref = state.install_url
    ? `${state.install_url}${state.install_url.includes('?') ? '&' : '?'}state=${space.id}`
    : '';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Code Sync</h1>
          <p className="subtitle">
            Connect this space to the GitHub repository that renders its site, so previews
            show your own pages and components — not a generic rendering.
          </p>
        </div>
        <span className="spacer" />
        {conn && editable && (
          <>
            <button className="btn secondary" onClick={runSync} disabled={busy}>
              <Icon name="reload" size={13} /> Sync now
            </button>
            <button
              className="btn danger secondary"
              onClick={() => setDisconnecting(true)}
              disabled={busy}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {!state.configured && <ServerNotConfigured />}

      {state.configured && !conn && (
        <EmptyState
          icon={<Icon name="code-sync" size={32} />}
          title="Not connected to GitHub"
          hint="Install the Ondros Code Sync app on the repository that builds this site. Until then, entry previews have nothing to render."
          action={
            editable ? (
              state.mode === 'app' ? (
                <a className="btn" href={installHref}>
                  <Icon name="github" size={14} /> Connect with GitHub
                </a>
              ) : (
                <button className="btn" onClick={loadRepos} disabled={busy}>
                  <Icon name="github" size={14} /> Choose a repository
                </button>
              )
            ) : undefined
          }
        />
      )}

      {state.configured && editable && (!conn || !conn.repo_full_name) && (
        <RepositoryPicker
          repos={repos}
          repo={repo}
          branch={branch}
          previewUrl={previewUrl}
          busy={busy}
          onLoad={loadRepos}
          onRepo={(value) => {
            setRepo(value);
            const found = repos?.find((r) => r.fullName === value);
            if (found) setBranch(found.defaultBranch);
          }}
          onBranch={setBranch}
          onPreviewUrl={setPreviewUrl}
          onConnect={connect}
        />
      )}

      {conn && conn.repo_full_name && (
        <>
          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <Icon name="github" size={18} />
              <div style={{ minWidth: 0 }}>
                <div className="type-title">{conn.repo_full_name}</div>
                <code style={{ fontSize: 11 }}>
                  {conn.branch}
                  {conn.manifest_path
                    ? ` · ${conn.manifest_path}`
                    : conn.manifest_source === 'derived'
                      ? ' · mapped by convention'
                      : ''}
                </code>
              </div>
              <span className="spacer" />
              <span className={`badge ${conn.status === 'connected' ? 'published' : conn.status === 'error' ? 'archived' : 'draft'}`}>
                {conn.status}
              </span>
            </div>

            {conn.last_error && <p className="error-text">{conn.last_error}</p>}

            <div className="row wrap" style={{ alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label className="field-label" style={{ marginTop: 0 }}>Branch</label>
                <input
                  className="input mono"
                  value={branch}
                  disabled={!editable}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </div>
              <div style={{ flex: '2 1 320px' }}>
                <label className="field-label" style={{ marginTop: 0 }}>Deployment URL</label>
                <input
                  className="input mono"
                  value={previewUrl}
                  placeholder="https://your-site.example.com"
                  disabled={!editable}
                  onChange={(e) => setPreviewUrl(e.target.value)}
                />
                <p className="help-text">
                  Where this branch is deployed. The preview iframe loads pages from here.
                  Set <code>previewUrl</code> in the repo&apos;s manifest to fill it automatically.
                </p>
              </div>
            </div>
            {editable && (
              <button className="btn secondary small" onClick={saveSettings} disabled={busy}>
                Save
              </button>
            )}
            {conn.last_synced_at && (
              <p className="help-text" style={{ marginBottom: 0 }}>
                Last synced {formatDate(conn.last_synced_at)}
                {conn.manifest_source ? ` · ${conn.manifest_source} manifest` : ''}
                {conn.account_login ? ` · installed by ${conn.account_login}` : ''}
              </p>
            )}
          </div>

          {sync && <SyncReport result={sync} />}
          <ComponentTable
            components={conn.manifest?.components ?? []}
            routes={conn.manifest?.routes ?? {}}
          />
          <SiteSetup />
        </>
      )}

      {disconnecting && (
        <ConfirmDialog
          title="Disconnect this repository?"
          message="Entry previews will stop rendering until another repository is connected. Your content is untouched."
          onClose={() => setDisconnecting(false)}
          onConfirm={async () => {
            await api(`/spaces/${space.id}/code-sync`, { method: 'DELETE' });
            toast('Disconnected');
            setSync(null);
            setRepos(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function ServerNotConfigured() {
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Code Sync isn&apos;t set up on this server</h2>
      <p className="muted">
        An operator needs to register a GitHub App called <strong>Ondros Code Sync</strong> and
        set these environment variables on the backend:
      </p>
      <pre className="code-block">
{`GITHUB_APP_ID=...
GITHUB_APP_SLUG=ondros-code-sync
GITHUB_APP_PRIVATE_KEY=...        # the PEM, or base64 of it
GITHUB_APP_WEBHOOK_SECRET=...

# Local development without an App:
GITHUB_TOKEN=ghp_...              # a personal access token with repo:read`}
      </pre>
      <p className="help-text" style={{ marginBottom: 0 }}>
        Full walkthrough: <code>docs/20-code-sync.md</code>.
      </p>
    </div>
  );
}

function RepositoryPicker({
  repos,
  repo,
  branch,
  previewUrl,
  busy,
  onLoad,
  onRepo,
  onBranch,
  onPreviewUrl,
  onConnect,
}: {
  repos: CodeSyncRepository[] | null;
  repo: string;
  branch: string;
  previewUrl: string;
  busy: boolean;
  onLoad: () => void;
  onRepo: (v: string) => void;
  onBranch: (v: string) => void;
  onPreviewUrl: (v: string) => void;
  onConnect: () => void;
}) {
  if (repos === null) {
    return (
      <div className="card">
        <div className="row">
          <span className="muted">Already installed the app?</span>
          <button className="btn secondary small" onClick={onLoad} disabled={busy}>
            {busy ? 'Loading…' : 'Load my repositories'}
          </button>
        </div>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          The installation can&apos;t see any repositories. Grant it access to the one that
          builds this site on GitHub, then load the list again.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Choose a repository</h2>
      <label className="field-label">Repository</label>
      <Select
        ariaLabel="Repository"
        value={repo}
        onChange={onRepo}
        options={repos.map((r) => ({
          value: r.fullName,
          label: r.fullName,
          icon: r.private ? 'security' : undefined,
          iconTitle: r.private ? 'Private repository' : undefined,
        }))}
      />
      <label className="field-label">Branch</label>
      <input className="input mono" value={branch} onChange={(e) => onBranch(e.target.value)} />
      <label className="field-label">Deployment URL</label>
      <input
        className="input mono"
        value={previewUrl}
        placeholder="https://your-site.example.com"
        onChange={(e) => onPreviewUrl(e.target.value)}
      />
      <p className="help-text">
        Optional if the repo&apos;s manifest declares <code>previewUrl</code>.
      </p>
      <button className="btn" onClick={onConnect} disabled={busy || !repo}>
        {busy ? 'Connecting…' : 'Connect repository'}
      </button>
    </div>
  );
}

function SyncReport({ result }: { result: CodeSyncSyncResult }) {
  if (result.status === 'error') {
    return (
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Sync failed</h2>
        <p className="error-text" style={{ marginBottom: 0 }}>{result.error}</p>
      </div>
    );
  }
  const clean = !result.unmapped_content_types.length && !result.unknown_content_types.length;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>
        {result.components} component{result.components === 1 ? '' : 's'}{' '}
        {result.manifest_path ? (
          <>from <code>{result.manifest_path}</code></>
        ) : (
          'mapped by convention'
        )}
      </h2>
      {!result.manifest_path && (
        <p className="help-text">
          This repository ships no manifest, so components were matched to content types by
          name and routed at <code>/&lt;type&gt;/&lt;slug&gt;</code>. Commit{' '}
          <code>ondros/component-definition.json</code> to override routes or block names.
        </p>
      )}
      {clean ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          <Icon name="check" size={13} /> Every content type in this environment has a component
          to render it.
        </p>
      ) : (
        <>
          {result.unmapped_content_types.length > 0 && (
            <p className="help-text">
              <Icon name="warning" size={12} /> No component renders{' '}
              {result.unmapped_content_types.map((t) => <code key={t}>{t}</code>).reduce(
                (acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]),
                [] as React.ReactNode[],
              )}
              . Entries of those types will preview as an empty page.
            </p>
          )}
          {result.unknown_content_types.length > 0 && (
            <p className="help-text">
              <Icon name="warning" size={12} /> The manifest declares components for{' '}
              {result.unknown_content_types.map((t) => <code key={t}>{t}</code>).reduce(
                (acc, el, i) => (i === 0 ? [el] : [...acc, ', ', el]),
                [] as React.ReactNode[],
              )}
              , which don&apos;t exist in this environment&apos;s content model.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ComponentTable({
  components,
  routes,
}: {
  components: { id: string; title: string; contentType: string; block: string; fields: unknown[] }[];
  routes: Record<string, string>;
}) {
  if (!components.length) return null;
  return (
    <>
      <h2 style={{ margin: '18px 0 8px' }}>Components</h2>
      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Component</th>
              <th>Content type</th>
              <th>Block</th>
              <th>Route</th>
              <th>Fields</th>
            </tr>
          </thead>
          <tbody>
            {components.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 500 }}>{c.title}</td>
                <td><code>{c.contentType}</code></td>
                <td className="muted mono">{c.block}</td>
                <td className="muted mono">{routes[c.contentType] ?? '—'}</td>
                <td className="muted">{c.fields.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SiteSetup() {
  return (
    <div className="card" style={{ marginTop: 18 }}>
      <h2 style={{ marginTop: 0 }}>Make your site editable</h2>
      <p className="muted">
        Include the bridge script on your pages and mark up what each element renders. The
        editor uses those attributes to outline components, select fields and edit text in
        place — exactly like the Universal Editor.
      </p>
      <pre className="code-block">
{`<script src="${API_URL}/code-sync/ondros-editor.js" defer></script>

<section data-ondros-resource="entry:{hero.id}" data-ondros-component="hero">
  <h1 data-ondros-prop="heading" data-ondros-type="text">{hero.heading}</h1>
  <p  data-ondros-prop="subheading" data-ondros-type="text">{hero.subheading}</p>
</section>`}
      </pre>
      <p className="help-text" style={{ marginBottom: 0 }}>
        The script no-ops unless the page is open inside the editor, so it is safe to ship in
        production. Full contract: <code>docs/20-code-sync.md</code>.
      </p>
    </div>
  );
}
