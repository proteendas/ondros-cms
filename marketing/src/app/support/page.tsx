/** Support page (spec 009). Docs/community/status destinations are placeholders. */
import type { Metadata } from 'next';
import {
  Activity,
  BookHalf,
  ChatDots,
  EnvelopeAt,
} from 'react-bootstrap-icons';

import { BRAND } from '@/lib/brand';

export const metadata: Metadata = { title: 'Support' };

const CHANNELS = [
  {
    icon: <BookHalf size={20} />,
    title: 'Documentation',
    text: 'Guides for content modeling, the delivery API, SDK, webhooks, and SSO setup.',
    link: { label: 'Read the docs →', href: '/docs' },
  },
  {
    icon: <EnvelopeAt size={20} />,
    title: 'Email support',
    text: 'Write to us for account, billing, or technical questions. Pro plans get priority responses.',
    link: { label: 'support@ondros.io', href: 'mailto:support@ondros.io' },
  },
  {
    icon: <ChatDots size={20} />,
    title: 'Community',
    text: 'Join other Ondros builders — share patterns, ask questions, see what teams are shipping.',
    // TODO: real Discord/Slack invite (spec 009)
    link: { label: 'Join the community →', href: '#community' },
  },
  {
    icon: <Activity size={20} />,
    title: 'Status',
    text: 'Live availability of the delivery API, management API, and dashboard, with incident history.',
    // TODO: real status page (spec 009)
    link: { label: 'status.ondros.io →', href: '#status' },
  },
];

export default function SupportPage() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>Support</h1>
          <p>We're here to help — pick the channel that fits.</p>
        </div>

        <div className="support-grid">
          {CHANNELS.map((c) => (
            <div key={c.title} className="feature-card">
              <div className="f-icon">{c.icon}</div>
              <h3>{c.title}</h3>
              <p>{c.text}</p>
              <p style={{ marginTop: 12 }}>
                <a href={c.link.href}>{c.link.label}</a>
              </p>
            </div>
          ))}
        </div>

        <div className="feature-card" style={{ marginTop: 40, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
          <h3>Contact us</h3>
          <p style={{ marginBottom: 16 }}>
            Tell us what you're building or where you're stuck — a human from the {BRAND.short} team replies
            to every message.
          </p>
          {/* MVP: mailto form (no backend on the marketing site by design — spec 009). */}
          <form action="mailto:support@ondros.io" method="post" encType="text/plain" style={{ display: 'grid', gap: 12 }}>
            <input
              name="email"
              type="email"
              required
              placeholder="Your email"
              style={{ padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit' }}
            />
            <textarea
              name="message"
              required
              rows={5}
              placeholder="How can we help?"
              style={{ padding: '11px 14px', border: '1px solid var(--border)', borderRadius: 8, font: 'inherit', resize: 'vertical' }}
            />
            <button className="btn" type="submit" style={{ justifySelf: 'start' }}>Send message</button>
          </form>
        </div>
      </div>
    </section>
  );
}
