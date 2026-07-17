'use client';

/**
 * Webhooks settings: CRUD + recent delivery log (status codes, latency).
 */
import { FormEvent, useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { ConfirmDialog, Modal, formatDate, useToast } from '@/components/ui';
import { useWorkspace } from '@/lib/workspace';
import type { Webhook, WebhookDelivery } from '@/lib/types';

export default function WebhooksPage() {
  const toast = useToast();
  const { spacePath } = useWorkspace();
  const [hooks, setHooks] = useState<Webhook[] | null>(null);
  const [eventTypes, setEventTypes] = useState<string[]>([]);
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Webhook | null>(null);
  const [logFor, setLogFor] = useState<Webhook | null>(null);

  const load = useCallback(() => {
    if (!spacePath) return;
    api<Webhook[]>(`${spacePath}/webhooks`).then(setHooks).catch(() => setHooks([]));
    api<{ events: string[] }>(`${spacePath}/webhooks/event-types`)
      .then((d) => setEventTypes(d.events))
      .catch(() => {});
  }, [spacePath]);

  useEffect(load, [load]);

  if (!spacePath) return <p className="muted">Select a space…</p>;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Webhooks</h1>
          <p className="subtitle">
            Signed HTTP notifications on content events (X-CMS-Signature: HMAC-SHA256).
          </p>
        </div>
        <span className="spacer" />
        <button className="btn" onClick={() => setEditing('new')}>+ Add webhook</button>
      </div>

      <div className="table-wrap">
        <table className="list">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th>Events</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(hooks ?? []).map((hook) => (
              <tr key={hook.id}>
                <td><strong>{hook.name}</strong></td>
                <td className="mono" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hook.url}</td>
                <td className="muted">
                  {hook.events.length ? `${hook.events.length} events` : 'all events'}
                  {hook.filters.content_types.length > 0 && ` · types: ${hook.filters.content_types.join(', ')}`}
                  {hook.filters.environments.length > 0 && ` · envs: ${hook.filters.environments.join(', ')}`}
                </td>
                <td>
                  <span className={`badge plain ${hook.enabled ? 'published' : 'draft'}`}>
                    {hook.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="actions">
                  <button className="btn ghost small" onClick={() => setLogFor(hook)}>Deliveries</button>
                  <button className="btn ghost small" onClick={() => setEditing(hook)}>Edit</button>
                  <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(hook)}>Delete</button>
                </td>
              </tr>
            ))}
            {hooks && hooks.length === 0 && (
              <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 24 }}>No webhooks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <WebhookModal
          spacePath={spacePath}
          hook={editing === 'new' ? null : editing}
          eventTypes={eventTypes}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Webhook saved');
            load();
          }}
        />
      )}
      {logFor && <DeliveryLogModal spacePath={spacePath} hook={logFor} onClose={() => setLogFor(null)} />}
      {deleting && (
        <ConfirmDialog
          title={`Delete webhook "${deleting.name}"?`}
          message="No further events will be delivered to this URL."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api(`${spacePath}/webhooks/${deleting.id}`, { method: 'DELETE' });
            load();
          }}
        />
      )}
    </div>
  );
}

function WebhookModal({
  spacePath,
  hook,
  eventTypes,
  onClose,
  onSaved,
}: {
  spacePath: string;
  hook: Webhook | null;
  eventTypes: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(hook?.name ?? '');
  const [url, setUrl] = useState(hook?.url ?? '');
  const [secret, setSecret] = useState('');
  const [enabled, setEnabled] = useState(hook?.enabled ?? true);
  const [events, setEvents] = useState<string[]>(hook?.events ?? []);
  const [ctFilter, setCtFilter] = useState((hook?.filters.content_types ?? []).join(', '));
  const [envFilter, setEnvFilter] = useState((hook?.filters.environments ?? []).join(', '));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name,
      url,
      enabled,
      events,
      filters: {
        content_types: ctFilter.split(',').map((s) => s.trim()).filter(Boolean),
        environments: envFilter.split(',').map((s) => s.trim()).filter(Boolean),
      },
    };
    if (secret) payload.secret = secret;
    try {
      if (hook) {
        await api(`${spacePath}/webhooks/${hook.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api(`${spacePath}/webhooks`, { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save webhook');
      setBusy(false);
    }
  }

  return (
    <Modal title={hook ? `Edit "${hook.name}"` : 'New webhook'} onClose={onClose} wide>
      <form onSubmit={submit}>
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 280px' }}>
            <label className="field-label" style={{ marginTop: 0 }}>Name</label>
            <input className="input" value={name} required autoFocus onChange={(e) => setName(e.target.value)} />
            <label className="field-label">URL</label>
            <input className="input mono" type="url" value={url} required placeholder="https://example.com/hooks/cms" onChange={(e) => setUrl(e.target.value)} />
            <label className="field-label">Secret {hook && <span className="muted small">(leave blank to keep current)</span>}</label>
            <input className="input" value={secret} placeholder="used to sign payloads" onChange={(e) => setSecret(e.target.value)} />
            <label className="checkbox-row">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Enabled
            </label>
            <label className="field-label">Content type filter (api_ids, comma-separated; empty = all)</label>
            <input className="input mono" value={ctFilter} placeholder="article, landing_page" onChange={(e) => setCtFilter(e.target.value)} />
            <label className="field-label">Environment filter (keys; empty = all)</label>
            <input className="input mono" value={envFilter} placeholder="master" onChange={(e) => setEnvFilter(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <label className="field-label" style={{ marginTop: 0 }}>
              Events <span className="muted small">(none checked = all)</span>
            </label>
            {eventTypes.map((ev) => (
              <label key={ev} className="checkbox-row" style={{ margin: '4px 0' }}>
                <input
                  type="checkbox"
                  checked={events.includes(ev)}
                  onChange={(e) =>
                    setEvents(e.target.checked ? [...events, ev] : events.filter((x) => x !== ev))
                  }
                />
                <code>{ev}</code>
              </label>
            ))}
          </div>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-footer">
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : 'Save webhook'}</button>
        </div>
      </form>
    </Modal>
  );
}

function DeliveryLogModal({
  spacePath,
  hook,
  onClose,
}: {
  spacePath: string;
  hook: Webhook;
  onClose: () => void;
}) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    api<WebhookDelivery[]>(`${spacePath}/webhooks/${hook.id}/deliveries`)
      .then(setDeliveries)
      .catch(() => setDeliveries([]));
  }, [spacePath, hook.id]);

  return (
    <Modal title={`Deliveries — ${hook.name}`} onClose={onClose} wide>
      {deliveries === null && <p className="muted">Loading…</p>}
      {deliveries?.length === 0 && <p className="muted">No deliveries yet — trigger a content event.</p>}
      {(deliveries ?? []).map((d) => (
        <div key={d.id} className="ref-item" style={{ cursor: 'pointer' }} onClick={() => setExpanded(expanded === d.id ? null : d.id)}>
          <span className={`badge plain ${d.success ? 'published' : 'archived'}`} style={!d.success ? { background: 'var(--danger-soft)', color: 'var(--danger)' } : undefined}>
            {d.response_status ?? 'ERR'}
          </span>
          <code>{d.event}</code>
          <span className="muted small">{d.duration_ms}ms</span>
          <span className="spacer" />
          <span className="muted small">{formatDate(d.created_at)}</span>
          {expanded === d.id && (
            <pre className="code-block" style={{ width: '100%', marginTop: 8 }} onClick={(e) => e.stopPropagation()}>
              {JSON.stringify(d.payload, null, 2)}
              {d.response_body ? `\n\n--- response ---\n${d.response_body.slice(0, 500)}` : ''}
            </pre>
          )}
        </div>
      ))}
      <div className="modal-footer">
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
