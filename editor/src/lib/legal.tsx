/**
 * Legal document registry.
 *
 * Twelve policies served by ONE dynamic route (`/legal/[slug]`) rather than
 * twelve near-identical page files: the chrome, metadata and "last updated"
 * handling then live in a single place.
 *
 * ⚠️ These are good-faith TEMPLATES, not legal advice. Every document is marked
 * as a template in the UI. Have counsel review them, and replace the
 * placeholders in `LEGAL_ENTITY` before you rely on any of this.
 */
import { BRAND } from '@/lib/brand';

/**
 * Contact details shown across the legal pages and the support form.
 *
 * Every field is overridable at build time via NEXT_PUBLIC_* env vars, so a
 * deployment can point these at its own mailboxes without editing source.
 * NEXT_PUBLIC_* values are inlined into the client bundle at build time — change
 * one and you must REBUILD (or redeploy) for it to take effect.
 *
 * `process.env.X` is written out in full deliberately: Next.js substitutes these
 * statically, so destructuring or dynamic lookups would not be replaced.
 */
const DEFAULT_CONTACT = 'prot.das15@gmail.com';

export const LEGAL_ENTITY = {
  company: process.env.NEXT_PUBLIC_LEGAL_COMPANY || `${BRAND.name} (operator)`,
  /** General support + abuse reports. */
  contactEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || DEFAULT_CONTACT,
  /** Data-protection enquiries and data subject requests. */
  privacyEmail: process.env.NEXT_PUBLIC_PRIVACY_EMAIL || DEFAULT_CONTACT,
  /** Vulnerability reports — kept separate so it can be routed differently. */
  securityEmail: process.env.NEXT_PUBLIC_SECURITY_EMAIL || DEFAULT_CONTACT,
  address: process.env.NEXT_PUBLIC_LEGAL_ADDRESS || '[Registered address]',
  jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION || '[Jurisdiction]',
  lastUpdated: process.env.NEXT_PUBLIC_LEGAL_UPDATED || '2026-09-16',
};

export interface LegalDoc {
  slug: string;
  title: string;
  summary: string;
  /** Grouping on the /legal index. */
  group: 'Policies' | 'Agreements' | 'Trust & safety';
  body: React.ReactNode;
}

const E = LEGAL_ENTITY;

export const LEGAL_DOCS: LegalDoc[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    summary: 'What personal data we collect, why, and the rights you have over it.',
    group: 'Policies',
    body: (
      <>
        <p className="lede">
          This policy explains what personal data {E.company} processes when you use
          the {BRAND.name} service, why we process it, and how you can exercise your rights.
        </p>

        <h2>1. Data we collect</h2>
        <table>
          <thead>
            <tr><th>Category</th><th>Examples</th><th>Why</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>Account data</td>
              <td>Name, email address, hashed password, organization membership</td>
              <td>To create and secure your account</td>
            </tr>
            <tr>
              <td>Content you create</td>
              <td>Entries, media, content models, guidelines</td>
              <td>To provide the service — we process it on your instruction</td>
            </tr>
            <tr>
              <td>Operational logs</td>
              <td>Request metadata, audit trail, webhook delivery records</td>
              <td>Security, debugging, and the audit features you use</td>
            </tr>
            <tr>
              <td>Billing data</td>
              <td>Plan, subscription status, usage counters</td>
              <td>To operate paid plans. Card details are handled by our payment processor, never by us</td>
            </tr>
          </tbody>
        </table>

        <h2>2. How we use it</h2>
        <ul>
          <li>To provide, maintain and secure the service.</li>
          <li>To enforce plan limits and bill correctly.</li>
          <li>To respond to support requests you send us.</li>
          <li>To meet legal obligations.</li>
        </ul>
        <p>
          We do not sell personal data, and we do not use your content to train
          machine-learning models.
        </p>

        <h2>3. AI features</h2>
        <p>
          If your organization enables AI assistance, the text you submit to those
          features — plus any guidelines you have ingested — is sent to the AI
          provider configured for your deployment. That provider processes it under
          its own terms. AI features are off unless an administrator configures a
          provider.
        </p>

        <h2>4. Retention</h2>
        <p>
          Account and content data is retained while your account is active. After
          deletion, backups may retain copies for a limited rolling window before
          being overwritten. Audit logs are retained for the period shown in your
          plan.
        </p>

        <h2>5. Your rights</h2>
        <p>
          Depending on where you live you may have rights to access, correct,
          export, delete or restrict processing of your personal data, and to object
          to it. Email <a href={`mailto:${E.privacyEmail}`}>{E.privacyEmail}</a> and we
          will respond within the period required by applicable law.
        </p>

        <h2>6. Sub-processors</h2>
        <p>
          We use infrastructure, email and payment providers to run the service.
          See the <a href="/legal/data-processing-agreement">Data Processing Agreement</a> for
          the categories involved.
        </p>

        <h2>7. Contact</h2>
        <p>
          {E.company}, {E.address}. Privacy enquiries:{' '}
          <a href={`mailto:${E.privacyEmail}`}>{E.privacyEmail}</a>.
        </p>
      </>
    ),
  },

  {
    slug: 'terms-of-service',
    title: 'Terms of Service',
    summary: 'The agreement between you and us for using the service.',
    group: 'Agreements',
    body: (
      <>
        <p className="lede">
          These terms govern your use of {BRAND.name}. By creating an account you
          agree to them on behalf of yourself and any organization you represent.
        </p>

        <h2>1. The service</h2>
        <p>
          {BRAND.name} is a headless content management system. We grant you a
          non-exclusive, non-transferable right to use it for as long as your
          account is in good standing.
        </p>

        <h2>2. Your account</h2>
        <ul>
          <li>You are responsible for everything that happens under your credentials.</li>
          <li>Keep your password and API keys secret. Rotate them if exposed.</li>
          <li>You must be old enough to form a binding contract where you live.</li>
        </ul>

        <h2>3. Your content</h2>
        <p>
          You keep all rights to the content you upload. You grant us only the
          licence needed to host, process and serve it back to you and the audiences
          you publish to. You are responsible for having the rights to everything
          you upload.
        </p>

        <h2>4. Acceptable use</h2>
        <p>
          Use of the service is subject to the{' '}
          <a href="/legal/acceptable-use-policy">Acceptable Use Policy</a>. We may
          suspend accounts that breach it.
        </p>

        <h2>5. Plans, billing and changes</h2>
        <p>
          Paid plans renew automatically until cancelled. Usage beyond your plan
          limits may be rate-limited or refused. See the{' '}
          <a href="/legal/cancellation-policy">Cancellation Policy</a> for how to stop
          a subscription.
        </p>

        <h2>6. Availability</h2>
        <p>
          We work to keep the service available but do not guarantee uninterrupted
          operation unless a separate written agreement says otherwise. Planned
          maintenance is announced where practical.
        </p>

        <h2>7. Termination</h2>
        <p>
          You may stop using the service at any time. We may suspend or terminate
          accounts that breach these terms, that create risk for other customers, or
          where required by law.
        </p>

        <h2>8. Liability</h2>
        <p>
          To the fullest extent permitted by law, the service is provided &ldquo;as
          is&rdquo; and our aggregate liability is limited to the fees you paid in the
          twelve months before the claim. See also the{' '}
          <a href="/legal/disclaimer">Disclaimer</a>.
        </p>

        <h2>9. Governing law</h2>
        <p>These terms are governed by the laws of {E.jurisdiction}.</p>
      </>
    ),
  },

  {
    slug: 'cookie-policy',
    title: 'Cookie Policy',
    summary: 'The cookies and local storage this application uses, and why.',
    group: 'Policies',
    body: (
      <>
        <p className="lede">
          {BRAND.name} keeps its browser storage deliberately minimal: there is no
          advertising or cross-site tracking technology in the application.
        </p>

        <h2>What we store</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Purpose</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code>cms_token</code> / <code>cms_refresh_token</code></td>
              <td>Local storage — strictly necessary</td>
              <td>Keeps you signed in between page loads</td>
            </tr>
            <tr>
              <td><code>cms_space_id</code> / <code>cms_env_key</code></td>
              <td>Local storage — functional</td>
              <td>Remembers the space and environment you last worked in</td>
            </tr>
            <tr>
              <td>Draft mode cookie</td>
              <td>Cookie — strictly necessary</td>
              <td>Set by the preview site when you view unpublished content</td>
            </tr>
          </tbody>
        </table>

        <h2>Analytics and advertising</h2>
        <p>
          The application sets no analytics or advertising cookies. If your
          organization self-hosts and adds its own, that is outside this policy.
        </p>

        <h2>Managing storage</h2>
        <p>
          You can clear this storage from your browser settings at any time —
          signing out does the same for the authentication tokens. Because the items
          above are strictly necessary or functional, clearing them signs you out
          and resets your workspace selection. See{' '}
          <a href="/legal/cookie-preferences">Cookie Preferences</a>.
        </p>
      </>
    ),
  },

  {
    slug: 'cancellation-policy',
    title: 'Cancellation Policy',
    summary: 'How to cancel a subscription and what happens to your data.',
    group: 'Policies',
    body: (
      <>
        <p className="lede">
          You can cancel a paid plan at any time. Nothing is deleted the moment you
          cancel.
        </p>

        <h2>How to cancel</h2>
        <p>
          Go to <a href="/settings/billing">Billing &amp; usage</a> and switch to the
          free plan, or use <a href="/billing/cancel">Cancel subscription</a>. An
          organization owner or admin must perform this.
        </p>

        <h2>When it takes effect</h2>
        <ul>
          <li>Your paid features remain available until the end of the current billing period.</li>
          <li>At the end of that period the account moves to the free plan.</li>
          <li>We do not pro-rate partial months unless required by law.</li>
        </ul>

        <h2>What happens to your content</h2>
        <p>
          Your content stays in place. If it exceeds free-plan limits, the service
          becomes read-only for the resources over the limit rather than deleting
          anything — export or reduce usage to restore full access.
        </p>

        <h2>Refunds</h2>
        <p>
          Where a refund is required by applicable consumer law, we honour it.
          Otherwise fees already paid are non-refundable. Email{' '}
          <a href={`mailto:${E.contactEmail}`}>{E.contactEmail}</a> to discuss.
        </p>

        <h2>Account deletion</h2>
        <p>
          Cancelling a plan is not the same as deleting an account. To delete an
          account and its content, contact us — the action is irreversible.
        </p>
      </>
    ),
  },

  {
    slug: 'disclaimer',
    title: 'Disclaimer',
    summary: 'Limits on the warranties and advice provided through the service.',
    group: 'Policies',
    body: (
      <>
        <p className="lede">
          The service, its documentation and any AI-generated output are provided for
          general use and without warranty.
        </p>

        <h2>No warranty</h2>
        <p>
          To the fullest extent permitted by law, {E.company} disclaims all implied
          warranties including merchantability, fitness for a particular purpose and
          non-infringement.
        </p>

        <h2>AI-generated content</h2>
        <p>
          AI features produce suggestions, not facts. Output can be inaccurate,
          biased or entirely fabricated, and it may not reflect your brand
          guidelines even when those guidelines were supplied. <strong>Review
          everything before publishing.</strong> You remain responsible for what you
          publish.
        </p>

        <h2>Third-party content and links</h2>
        <p>
          Links to third-party sites and services are provided for convenience. We do
          not endorse them and are not responsible for their content or practices.
        </p>

        <h2>Not professional advice</h2>
        <p>
          The legal templates published in this section are examples, not legal
          advice. Have a qualified professional review them for your situation.
        </p>
      </>
    ),
  },

  {
    slug: 'accessibility-statement',
    title: 'Accessibility Statement',
    summary: 'Our accessibility target, what works today, and known gaps.',
    group: 'Trust & safety',
    body: (
      <>
        <p className="lede">
          We aim to meet <strong>WCAG 2.1 Level AA</strong> across the editing
          interface, and we would rather state known gaps plainly than claim full
          conformance.
        </p>

        <h2>What we do</h2>
        <ul>
          <li>Semantic HTML with labelled form controls throughout.</li>
          <li>
            Custom controls expose correct ARIA roles — the dropdown, for example,
            is a real <code>combobox</code>/<code>listbox</code> with full keyboard
            support and <code>aria-activedescendant</code>.
          </li>
          <li>Visible focus indicators, and colour is never the only signal.</li>
          <li>Layouts reflow to small screens without horizontal scrolling.</li>
          <li><code>prefers-reduced-motion</code> is respected.</li>
        </ul>

        <h2>Known limitations</h2>
        <ul>
          <li>
            The rich-text editor and drag-to-reorder content modelling are only
            partially usable with a keyboard alone; keyboard alternatives exist for
            reordering but the drag affordance is mouse-oriented.
          </li>
          <li>
            The split-view live preview renders your own content — its accessibility
            depends on the templates you write.
          </li>
          <li>Some data tables scroll horizontally on small screens.</li>
        </ul>

        <h2>Feedback</h2>
        <p>
          If something blocks you, tell us at{' '}
          <a href={`mailto:${E.contactEmail}`}>{E.contactEmail}</a> or via{' '}
          <a href="/support">Support</a>. Accessibility reports are prioritised, and
          we aim to acknowledge them within five working days.
        </p>
      </>
    ),
  },

  {
    slug: 'data-processing-agreement',
    title: 'Data Processing Agreement',
    summary: 'Controller/processor terms for customers handling personal data.',
    group: 'Agreements',
    body: (
      <>
        <p className="lede">
          This DPA applies where you use {BRAND.name} to process personal data and
          applicable data-protection law (such as the GDPR) requires one.
        </p>

        <h2>1. Roles</h2>
        <p>
          You are the <strong>controller</strong> of personal data contained in your
          content. {E.company} acts as <strong>processor</strong>, processing it only
          on your documented instructions — using the service is such an instruction.
        </p>

        <h2>2. Subject matter and duration</h2>
        <p>
          Processing lasts for the term of your account and covers the content and
          account data described in the{' '}
          <a href="/legal/privacy-policy">Privacy Policy</a>.
        </p>

        <h2>3. Confidentiality</h2>
        <p>
          Personnel with access to personal data are bound by confidentiality
          obligations and access is limited to those who need it.
        </p>

        <h2>4. Security</h2>
        <p>
          We maintain appropriate technical and organisational measures — see the{' '}
          <a href="/legal/security-policy">Security Policy</a>. Passwords are hashed,
          API keys are stored hashed, and webhook payloads are HMAC-signed.
        </p>

        <h2>5. Sub-processors</h2>
        <p>
          You authorise the use of sub-processors for hosting, database, email and
          payment services. We remain responsible for their performance and will give
          notice of material changes.
        </p>

        <h2>6. Assistance</h2>
        <p>
          We will assist you, taking account of the nature of processing, with data
          subject requests, breach notification, and impact assessments.
        </p>

        <h2>7. Deletion and return</h2>
        <p>
          On termination we delete or return personal data, except where storage is
          required by law. Backups age out on a rolling schedule.
        </p>

        <h2>8. Audit</h2>
        <p>
          We will make available the information needed to demonstrate compliance and
          allow for audits on reasonable notice, subject to confidentiality.
        </p>

        <h2>9. International transfers</h2>
        <p>
          Where personal data is transferred outside its region of origin, an
          appropriate transfer mechanism will be used.
        </p>

        <p>
          To execute a counter-signed copy, contact{' '}
          <a href={`mailto:${E.privacyEmail}`}>{E.privacyEmail}</a>.
        </p>
      </>
    ),
  },

  {
    slug: 'acceptable-use-policy',
    title: 'Acceptable Use Policy',
    summary: 'What you may not do with the service.',
    group: 'Trust & safety',
    body: (
      <>
        <p className="lede">
          This policy keeps the service safe and available for everyone. It applies
          to all users and all content.
        </p>

        <h2>You must not</h2>
        <ul>
          <li>Break the law, or help anyone else to.</li>
          <li>
            Publish content that infringes intellectual property, is defamatory, or
            sexualises minors.
          </li>
          <li>Upload malware, or use the service to distribute it.</li>
          <li>
            Attempt to access accounts, data or infrastructure you are not authorised
            to reach.
          </li>
          <li>
            Probe, scan or load-test the service without written permission — see{' '}
            <a href="/legal/responsible-disclosure">Responsible Disclosure</a>.
          </li>
          <li>Send spam or unsolicited bulk messages via webhooks or invitations.</li>
          <li>
            Circumvent plan limits, rate limits or metering, including by creating
            multiple accounts to do so.
          </li>
          <li>Resell the service without an agreement permitting it.</li>
        </ul>

        <h2>Automated access</h2>
        <p>
          API access is expected and encouraged. Use your own API keys, respect rate
          limits, and back off when you receive a <code>429</code>.
        </p>

        <h2>Enforcement</h2>
        <p>
          We may remove content, suspend an account, or terminate access for
          breaches. Where the risk allows, we contact you first. Serious cases —
          especially those endangering people — may be reported to authorities.
        </p>

        <h2>Reporting</h2>
        <p>
          Report abuse to <a href={`mailto:${E.contactEmail}`}>{E.contactEmail}</a>.
        </p>
      </>
    ),
  },

  {
    slug: 'security-policy',
    title: 'Security Policy',
    summary: 'How the service protects data, and what you are responsible for.',
    group: 'Trust & safety',
    body: (
      <>
        <p className="lede">
          Security is shared: we secure the platform, you secure how you use it.
        </p>

        <h2>What we do</h2>
        <ul>
          <li>Passwords hashed with bcrypt; never stored or logged in plaintext.</li>
          <li>
            API tokens shown once and stored only as hashes — a database leak does not
            expose usable keys.
          </li>
          <li>
            Every request is authorised against a capability model, re-checked
            server-side per request. Tenant scope comes from the signed token, never
            from request parameters.
          </li>
          <li>Webhook payloads are signed with HMAC-SHA256 so receivers can verify origin.</li>
          <li>Refresh tokens rotate on use, and changing a password revokes other sessions.</li>
          <li>An audit log records who changed what.</li>
        </ul>

        <h2>What you should do</h2>
        <ul>
          <li>Use a unique, strong password and enable SSO if your organization supports it.</li>
          <li>
            Give API keys the narrowest scope that works — a delivery key for public
            reads, never a management key in client-side code.
          </li>
          <li>Rotate keys when someone leaves or a key may have been exposed.</li>
          <li>Verify the webhook signature before trusting a payload.</li>
          <li>Review the audit log periodically.</li>
        </ul>

        <h2>Self-hosting</h2>
        <p>
          If you run your own deployment, you are responsible for its configuration:
          rotate <code>JWT_SECRET</code>, disable development modes, restrict CORS to
          your real origins, and serve everything over TLS.
        </p>

        <h2>Reporting a vulnerability</h2>
        <p>
          Please use <a href="/legal/responsible-disclosure">Responsible Disclosure</a>.
        </p>
      </>
    ),
  },

  {
    slug: 'responsible-disclosure',
    title: 'Responsible Disclosure',
    summary: 'How to report a security vulnerability safely.',
    group: 'Trust & safety',
    body: (
      <>
        <p className="lede">
          We welcome reports from security researchers and will not pursue legal
          action against good-faith research that follows this policy.
        </p>

        <h2>How to report</h2>
        <p>
          Email <a href={`mailto:${E.securityEmail}`}>{E.securityEmail}</a> with enough
          detail to reproduce: affected endpoint or page, steps, impact, and any
          proof-of-concept. Please report privately and give us a chance to fix the
          issue before disclosing publicly.
        </p>

        <h2>What we commit to</h2>
        <ul>
          <li>Acknowledge your report within five working days.</li>
          <li>Keep you updated on progress toward a fix.</li>
          <li>Credit you when the fix ships, if you would like that.</li>
        </ul>

        <h2>Please do</h2>
        <ul>
          <li>Test only against accounts and data you own.</li>
          <li>Stop as soon as you have confirmed a vulnerability exists.</li>
          <li>Give us reasonable time to remediate before publishing.</li>
        </ul>

        <h2>Please do not</h2>
        <ul>
          <li>Access, modify or delete other people&apos;s data.</li>
          <li>Run denial-of-service or large-scale automated scans.</li>
          <li>Use social engineering or physical attacks against staff or offices.</li>
          <li>Demand payment in exchange for withholding a report.</li>
        </ul>

        <h2>Out of scope</h2>
        <p>
          Reports with no demonstrated security impact — missing hardening headers,
          version-disclosure banners, self-XSS, or output from an automated scanner
          with no proof of exploitability.
        </p>
      </>
    ),
  },

  {
    slug: 'community-guidelines',
    title: 'Community Guidelines',
    summary: 'How we expect people to behave in shared spaces.',
    group: 'Trust & safety',
    body: (
      <>
        <p className="lede">
          These guidelines cover shared workspaces, support channels and any
          community forum we operate.
        </p>

        <h2>Be respectful</h2>
        <p>
          Treat collaborators and staff with courtesy. Harassment, hate speech,
          threats, and discrimination based on protected characteristics are not
          tolerated.
        </p>

        <h2>Be honest</h2>
        <ul>
          <li>Do not impersonate other people or organizations.</li>
          <li>Do not post content you know to be misleading in shared spaces.</li>
          <li>Disclose conflicts of interest when recommending tools or services.</li>
        </ul>

        <h2>Respect privacy</h2>
        <p>
          Do not share other people&apos;s personal data, private messages, or
          credentials — including screenshots containing API keys or customer data.
          Redact before you post.
        </p>

        <h2>Keep shared workspaces usable</h2>
        <ul>
          <li>Don&apos;t delete or unpublish colleagues&apos; work without agreement.</li>
          <li>Use environments for experiments rather than editing production content.</li>
          <li>Leave content in a state the next person can understand.</li>
        </ul>

        <h2>Enforcement</h2>
        <p>
          Reports go to <a href={`mailto:${E.contactEmail}`}>{E.contactEmail}</a>.
          Depending on severity we may warn, remove content, or suspend access. See
          the <a href="/legal/acceptable-use-policy">Acceptable Use Policy</a> for
          service-level rules.
        </p>
      </>
    ),
  },
];

export function getLegalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}

/** The subset surfaced in compact footers (auth pages, sidebar). */
export const PRIMARY_LEGAL = ['privacy-policy', 'terms-of-service', 'cookie-policy'] as const;
