/** Landing page (spec 009): hero, feature highlights, how-it-works, CTA band. */
import Link from 'next/link';
import {
  Boxes,
  Braces,
  Broadcast,
  Diagram3,
  EyeFill,
  Globe2,
  Stars,
} from 'react-bootstrap-icons';

import { APP_LOGIN_URL, APP_SIGNUP_URL, BRAND } from '@/lib/brand';

const FEATURES = [
  {
    icon: <Boxes size={20} />,
    title: 'Visual content modeling',
    text: 'Design content types with references, assemblies, validations, and localized fields — no deployments required.',
  },
  {
    icon: <EyeFill size={20} />,
    title: 'Live preview & inline editing',
    text: 'Edit in a split view against your real site. Click any element to jump to its field, or edit text right in the page.',
  },
  {
    icon: <Stars size={20} />,
    title: 'AI/RAG-powered generation',
    text: 'Generate, rewrite, translate, and audit copy — grounded in your own brand guidelines via retrieval-augmented AI.',
  },
  {
    icon: <Diagram3 size={20} />,
    title: 'Spaces & environments',
    text: 'Multi-space, multi-environment architecture with one-click cloning, so model changes ship safely.',
  },
  {
    icon: <Globe2 size={20} />,
    title: 'Localization built in',
    text: 'Any ISO locale, per-field localization, configurable fallback chains, and AI translation between locales.',
  },
  {
    icon: <Broadcast size={20} />,
    title: 'Webhooks & events',
    text: 'Signed webhooks on every content event keep your builds, caches, and integrations in sync.',
  },
  {
    icon: <Braces size={20} />,
    title: 'API-first SDK',
    text: 'A typed TypeScript SDK with retries, caching, filters, and link resolution — plus a CLI for types codegen.',
  },
];

const STEPS = [
  { title: 'Model your content', text: 'Define types, fields, references, and locales in the visual builder.' },
  { title: 'Edit with confidence', text: 'Authors write with live preview, inline editing, and AI assistance.' },
  { title: 'Preview every draft', text: 'Share draft states through preview tokens before anything goes live.' },
  { title: 'Deliver via SDK', text: 'Fetch published content anywhere with the Ondros SDK or plain REST.' },
];

export default function LandingPage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <div className="hero-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND.logoIcon} alt={`${BRAND.name} logo`} width={72} height={72} style={{ borderRadius: 18 }} />
          </div>
          <div className="eyebrow">
            <Stars size={13} /> AI-native headless CMS
          </div>
          <h1>
            {BRAND.tagline.replace('.', '')}
            <br />
            with <span style={{ color: '#a5b4fc' }}>{BRAND.short}</span>.
          </h1>
          <p className="lede">
            Model content visually, edit against a live preview, generate on-brand copy with AI,
            and deliver to any frontend through a typed SDK — all from one workspace.
          </p>
          <div className="cta-row">
            <a href={APP_SIGNUP_URL} className="btn large">Get Started</a>
            <a href={APP_LOGIN_URL} className="btn large secondary on-dark">Login</a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Everything a content team needs</h2>
            <p>From modeling to delivery — without stitching five tools together.</p>
          </div>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <div className="f-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.text}</p>
              </div>
            ))}
          </div>
          <p style={{ textAlign: 'center', marginTop: 34 }}>
            <Link href="/features">Explore all features →</Link>
          </p>
        </div>
      </section>

      <section className="section alt">
        <div className="container">
          <div className="section-head">
            <h2>How it works</h2>
            <p>Four steps from idea to production content.</p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="step">
                <div className="n">{i + 1}</div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="cta-band">
            <h2>Ship on-brand content faster</h2>
            <p>Start free with a full workspace — spaces, environments, AI tools, and the SDK included.</p>
            <a href={APP_SIGNUP_URL} className="btn large">Start Free</a>
          </div>
        </div>
      </section>
    </>
  );
}
