'use client';

/**
 * Support & bug reporting.
 *
 * There is no ticketing backend in this project, so rather than fake a
 * "submitted!" state that goes nowhere, this composes a well-structured email
 * (or a copyable report) pre-filled with the diagnostics a maintainer actually
 * needs: app version, route, browser, account/space/environment ids.
 *
 * Swap `SUPPORT_EMAIL` — or replace `send()` with a POST to your helpdesk — if
 * you wire up a real ticketing system.
 */
import { useEffect, useState } from 'react';

import { useToast } from '@/components/ui';
import Icon from '@/components/ui/Icon';
import Select from '@/components/ui/Select';
import { API_URL } from '@/lib/api';
import { BRAND } from '@/lib/brand';
import { LEGAL_ENTITY } from '@/lib/legal';
import { useWorkspace } from '@/lib/workspace';

const SUPPORT_EMAIL = LEGAL_ENTITY.contactEmail;

const KINDS = [
  { value: 'bug', label: 'Bug — something is broken' },
  { value: 'question', label: 'Question — how do I…?' },
  { value: 'billing', label: 'Billing or subscription' },
  { value: 'access', label: 'Access or permissions' },
  { value: 'accessibility', label: 'Accessibility barrier' },
  { value: 'feature', label: 'Feature request' },
];

const SEVERITIES = [
  { value: 'blocking', label: 'Blocking — I cannot work' },
  { value: 'major', label: 'Major — a key feature is broken' },
  { value: 'minor', label: 'Minor — annoying but I can continue' },
  { value: 'cosmetic', label: 'Cosmetic' },
];

export default function SupportPage() {
  const toast = useToast();
  const { user, space, environment } = useWorkspace();

  const [kind, setKind] = useState('bug');
  const [severity, setSeverity] = useState('major');
  const [subject, setSubject] = useState('');
  const [steps, setSteps] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [diagnostics, setDiagnostics] = useState('');

  // Collected on the client only — window/navigator don't exist during SSR.
  useEffect(() => {
    const lines = [
      `App:         ${BRAND.name} editor`,
      `API:         ${API_URL}`,
      `Page:        ${window.location.pathname}`,
      `User:        ${user?.email ?? '(not signed in)'}`,
      `Account:     ${user?.tenant_id ?? '—'}`,
      `Space:       ${space ? `${space.name} (${space.id})` : '—'}`,
      `Environment: ${environment?.key ?? '—'}`,
      `Browser:     ${navigator.userAgent}`,
      `Viewport:    ${window.innerWidth}×${window.innerHeight}`,
      `Time:        ${new Date().toISOString()}`,
    ];
    setDiagnostics(lines.join('\n'));
  }, [user, space, environment]);

  const isBug = kind === 'bug';

  function buildBody(): string {
    const parts = [
      `Type: ${KINDS.find((k) => k.value === kind)?.label ?? kind}`,
      isBug ? `Severity: ${SEVERITIES.find((s) => s.value === severity)?.label ?? severity}` : '',
      '',
      isBug ? '## Steps to reproduce' : '## Details',
      steps || '(not provided)',
      '',
      ...(isBug
        ? ['## Expected', expected || '(not provided)', '', '## Actual', actual || '(not provided)', '']
        : []),
      '## Diagnostics',
      '```',
      diagnostics,
      '```',
    ];
    return parts.filter((p) => p !== '').join('\n');
  }

  function send() {
    if (!subject.trim()) {
      toast('Add a short subject first', 'error');
      return;
    }
    const url =
      `mailto:${SUPPORT_EMAIL}` +
      `?subject=${encodeURIComponent(`[${kind}] ${subject.trim()}`)}` +
      `&body=${encodeURIComponent(buildBody())}`;
    window.location.href = url;
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(`# ${subject || '(no subject)'}\n\n${buildBody()}`);
      toast('Report copied to clipboard');
    } catch {
      toast('Could not access the clipboard', 'error');
    }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1>Support</h1>
          <p className="subtitle">
            Report a bug or ask a question. Diagnostics are attached automatically.
          </p>
        </div>
      </div>

      <section className="card profile-card">
        <h2>Before you write</h2>
        <div className="link-grid">
          <a className="link-card" href="/help">
            <span className="t">Help centre</span>
            <span className="d">Task guides for modelling, publishing, keys and locales.</span>
          </a>
          <a className="link-card" href={`${API_URL}/docs`} target="_blank" rel="noreferrer">
            <span className="t">API reference</span>
            <span className="d">Interactive Swagger UI for every endpoint.</span>
          </a>
          <a className="link-card" href="/legal/responsible-disclosure">
            <span className="t">Security issue?</span>
            <span className="d">Report vulnerabilities privately, not through this form.</span>
          </a>
        </div>
      </section>

      <section className="card profile-card">
        <h2>Tell us what happened</h2>

        <label className="field-label" htmlFor="support-kind">What kind of issue?</label>
        <Select id="support-kind" ariaLabel="Issue type" value={kind} onChange={setKind} options={KINDS} />

        {isBug && (
          <>
            <label className="field-label" htmlFor="support-severity">How badly does it affect you?</label>
            <Select
              id="support-severity"
              ariaLabel="Severity"
              value={severity}
              onChange={setSeverity}
              options={SEVERITIES}
            />
          </>
        )}

        <label className="field-label" htmlFor="support-subject">Subject</label>
        <input
          id="support-subject"
          className="input"
          value={subject}
          maxLength={150}
          placeholder={isBug ? 'Publishing a landing page returns 500' : 'How do I clone an environment?'}
          onChange={(e) => setSubject(e.target.value)}
        />

        <label className="field-label" htmlFor="support-steps">
          {isBug ? 'Steps to reproduce' : 'Details'}
        </label>
        <textarea
          id="support-steps"
          className="input"
          rows={5}
          value={steps}
          placeholder={
            isBug
              ? '1. Open Content → welcome\n2. Click Publish\n3. …'
              : 'What are you trying to do?'
          }
          onChange={(e) => setSteps(e.target.value)}
        />

        {isBug && (
          <>
            <label className="field-label" htmlFor="support-expected">Expected result</label>
            <textarea
              id="support-expected" className="input" rows={2} value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />

            <label className="field-label" htmlFor="support-actual">Actual result</label>
            <textarea
              id="support-actual" className="input" rows={2} value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </>
        )}

        <label className="field-label">Diagnostics that will be attached</label>
        <pre className="code-block" style={{ fontSize: 11.5, whiteSpace: 'pre-wrap' }}>
          {diagnostics || 'Collecting…'}
        </pre>
        <p className="help-text">
          Review this before sending — remove anything you would rather not share.
        </p>

        <div className="modal-footer">
          <button className="btn secondary" onClick={() => void copyReport()}>
            <Icon name="content" size={13} /> Copy report
          </button>
          <button className="btn" onClick={send}>
            <Icon name="email" size={13} /> Open email to {SUPPORT_EMAIL}
          </button>
        </div>
      </section>

      <section className="card profile-card">
        <h2>Other ways to reach us</h2>
        <dl className="profile-meta">
          <dt>Support email</dt>
          <dd><a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></dd>
          <dt>Security reports</dt>
          <dd><a href="/legal/responsible-disclosure">Responsible disclosure</a></dd>
          <dt>Accessibility</dt>
          <dd><a href="/legal/accessibility-statement">Accessibility statement</a></dd>
        </dl>
      </section>
    </div>
  );
}
