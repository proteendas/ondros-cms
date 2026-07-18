/** Features page (spec 009): detailed capability breakdown. */
import type { Metadata } from 'next';
import {
  Boxes,
  Braces,
  Broadcast,
  ClockHistory,
  CreditCard,
  Diagram3,
  Globe2,
  Images,
  Key,
  People,
  ShieldLock,
  Stars,
} from 'react-bootstrap-icons';

import { APP_SIGNUP_URL } from '@/lib/brand';

export const metadata: Metadata = { title: 'Features' };

const SECTIONS = [
  {
    icon: <Boxes size={20} />,
    title: 'Content modeling',
    text: 'Fourteen field types including rich text, media, JSON, and entry references. Build assemblies — pages composed of ordered, reusable blocks — with per-field validations, localization flags, and AI hints that steer generation.',
  },
  {
    icon: <Images size={20} />,
    title: 'Media library',
    text: 'Drag-and-drop uploads with automatic dimensions, alt text and tags, searchable grid, and on-the-fly image variants (resize + format) served from a cache-friendly URL.',
  },
  {
    icon: <Stars size={20} />,
    title: 'AI tools',
    text: 'Generate whole entries from a brief, rewrite or expand a field, suggest titles, produce SEO metadata, translate between any active locales, and audit drafts against your own ingested brand guidelines (RAG). Works with free providers — Groq, Gemini, Ollama — or OpenAI/Azure.',
  },
  {
    icon: <Diagram3 size={20} />,
    title: 'Spaces & environments',
    text: 'Each space carries its own content model, locales, keys, and webhooks. Branch content into environments (master/staging/dev), clone with reference remapping, and promote changes safely.',
  },
  {
    icon: <Globe2 size={20} />,
    title: 'Localization',
    text: 'Pick any ISO locale per space, localize individual fields, configure fallback chains (hi-IN → en-GB → default), and let the delivery API resolve the right value per request.',
  },
  {
    icon: <People size={20} />,
    title: 'Roles & permissions',
    text: 'Capability-based system roles (admin, editor, author, viewer) plus custom roles, assignable org-wide or per space. Publishing rights are separate from editing rights.',
  },
  {
    icon: <ShieldLock size={20} />,
    title: 'Enterprise SSO',
    text: 'OIDC single sign-on (Google, Microsoft Entra ID, Okta) with just-in-time provisioning, domain restrictions, and optional enforcement that disables password login for your domain.',
  },
  {
    icon: <Broadcast size={20} />,
    title: 'Webhooks',
    text: 'HMAC-signed webhooks on entry, model, and asset events with content-type and environment filters — plus a delivery log with status codes and latency for debugging.',
  },
  {
    icon: <Braces size={20} />,
    title: 'SDK & API',
    text: 'Typed TypeScript SDK with automatic retries, stale-while-revalidate caching, field filters, and Contentful-style link resolution. A CLI generates TypeScript types from your content model; the whole API ships as OpenAPI 3.',
  },
  {
    icon: <ClockHistory size={20} />,
    title: 'Version history & audit',
    text: 'Every save snapshots the entry — diff any version against the current draft and restore in one click. A full audit log records who changed what, when, with field-level diffs.',
  },
  {
    icon: <Key size={20} />,
    title: 'Scoped API keys',
    text: 'Separate delivery, preview, and management tokens, hashed at rest and scopable to specific environments. Rotate or disable instantly.',
  },
  {
    icon: <CreditCard size={20} />,
    title: 'Usage & billing',
    text: 'Transparent per-account usage meters (entries, storage, seats, API calls) with plan limits enforced by clear API responses — never silent failures.',
  },
];

export default function FeaturesPage() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>Features</h1>
          <p>Everything in the Ondros workspace, in detail.</p>
        </div>
        <div className="feature-grid">
          {SECTIONS.map((s) => (
            <div key={s.title} className="feature-card">
              <div className="f-icon">{s.icon}</div>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </div>
          ))}
        </div>
        <div className="cta-band" style={{ marginTop: 60 }}>
          <h2>See it with your own content</h2>
          <p>Spin up a free workspace and model your first content type in minutes.</p>
          <a href={APP_SIGNUP_URL} className="btn large">Get Started</a>
        </div>
      </div>
    </section>
  );
}
