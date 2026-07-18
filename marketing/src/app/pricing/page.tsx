/** Pricing page (spec 009): tiers, comparison table, FAQ.
 * Marketing copy mirrors the product's seeded plans (spec 005); the live
 * source of truth stays GET /billing/plans in the app. */
import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckLg } from 'react-bootstrap-icons';

import Reveal from '@/components/Reveal';
import { APP_SIGNUP_URL } from '@/lib/brand';

export const metadata: Metadata = { title: 'Pricing' };

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    blurb: 'For evaluating Ondros or running a small project.',
    cta: { label: 'Start Free', href: APP_SIGNUP_URL },
    featured: false,
    items: ['1 space · master environment', '2 seats', '500 entries', '100 MB media storage', '10k API calls / month', 'AI with your own provider key', 'Community support'],
  },
  {
    name: 'Pro',
    price: '$99',
    blurb: 'For teams shipping production content across sites.',
    cta: { label: 'Start Free, upgrade in-app', href: APP_SIGNUP_URL },
    featured: true,
    items: ['20 spaces · unlimited environments', '50 seats', '100k entries', '50 GB media storage', '5M API calls / month', 'AI credits included', 'SSO (OIDC) + audit log', 'Priority email support'],
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    blurb: 'For organizations with compliance and scale requirements.',
    cta: { label: 'Talk to Sales', href: '/support' },
    featured: false,
    items: ['Unlimited spaces & seats', 'Custom API & storage limits', 'SAML SSO + enforced domains', 'Row-level security deployment', 'SLA + dedicated support', 'Invoice billing'],
  },
];

const COMPARE: [string, string, string, string][] = [
  ['Spaces', '1', '20', 'Unlimited'],
  ['Environments per space', '1', 'Unlimited', 'Unlimited'],
  ['Seats', '2', '50', 'Unlimited'],
  ['Entries', '500', '100,000', 'Custom'],
  ['Media storage', '100 MB', '50 GB', 'Custom'],
  ['API calls / month', '10,000', '5,000,000', 'Custom'],
  ['AI credits', 'Bring your key', 'Included', 'Included + custom models'],
  ['Localization & fallbacks', '✓', '✓', '✓'],
  ['Webhooks', '✓', '✓', '✓'],
  ['Version history & audit log', '✓', '✓', '✓'],
  ['SSO', '—', 'OIDC', 'OIDC + SAML (enforced)'],
  ['Support', 'Community', 'Priority email', 'SLA + dedicated'],
];

const FAQ = [
  {
    q: 'How does billing work?',
    a: 'Plans are billed monthly per account through Stripe. You can upgrade, downgrade, or cancel any time from Settings → Billing; changes apply immediately and proration is handled automatically.',
  },
  {
    q: 'What happens when I hit a plan limit?',
    a: 'Nothing breaks silently. Create operations past a ceiling return a clear "plan limit reached" response naming the metric, and API calls beyond your monthly quota return 429 with a Retry-After header. Existing content keeps serving.',
  },
  {
    q: 'How are seats counted?',
    a: 'A seat is any member of your account, whatever their role. Pending invitations don\'t count until accepted. You can free seats by deactivating users.',
  },
  {
    q: 'Do unused API calls roll over?',
    a: 'No — API quotas reset at the start of each calendar month.',
  },
  {
    q: 'Can I bring my own AI provider?',
    a: 'Yes. Every plan lets you plug in your own key for Groq, Gemini, Ollama (fully local), OpenRouter, OpenAI, or Azure OpenAI. Pro and Enterprise include managed AI credits on top.',
  },
  {
    q: 'Is there an overage charge?',
    a: 'No surprise charges: we enforce soft limits instead of billing overages. If you regularly hit ceilings, upgrading or a custom Enterprise limit is the path.',
  },
];

export default function PricingPage() {
  return (
    <section className="section">
      <div className="container">
        <div className="section-head">
          <h1 style={{ fontSize: 'clamp(28px, 4vw, 40px)' }}>Pricing</h1>
          <p>Start free. Upgrade when your content does.</p>
        </div>

        <div className="plans">
          {PLANS.map((plan, i) => (
            <Reveal key={plan.name} className={`plan${plan.featured ? ' featured' : ''}`} delay={i * 100}>
              {plan.featured && <div className="flag">Most popular</div>}
              <h3 style={{ fontSize: 20 }}>{plan.name}</h3>
              <div className="price">
                {plan.price}
                {plan.price.startsWith('$') && <span> /month</span>}
              </div>
              <p style={{ color: 'var(--text-2)', fontSize: 14.5, margin: 0 }}>{plan.blurb}</p>
              <ul>
                {plan.items.map((item) => (
                  <li key={item}>
                    <CheckLg size={14} /> {item}
                  </li>
                ))}
              </ul>
              {plan.cta.href.startsWith('/') ? (
                <Link href={plan.cta.href} className={`btn${plan.featured ? '' : ' secondary'}`} style={{ justifyContent: 'center' }}>
                  {plan.cta.label}
                </Link>
              ) : (
                <a href={plan.cta.href} className={`btn${plan.featured ? '' : ' secondary'}`} style={{ justifyContent: 'center' }}>
                  {plan.cta.label}
                </a>
              )}
            </Reveal>
          ))}
        </div>

        <h2 style={{ textAlign: 'center', margin: '70px 0 26px' }}>Compare plans</h2>
        <div className="compare-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th style={{ width: '34%' }} />
                <th>Free</th>
                <th>Pro</th>
                <th>Enterprise</th>
              </tr>
            </thead>
            <tbody>
              {COMPARE.map(([label, free, pro, ent]) => (
                <tr key={label}>
                  <td style={{ fontWeight: 500 }}>{label}</td>
                  <td>{free}</td>
                  <td>{pro}</td>
                  <td>{ent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 style={{ textAlign: 'center', margin: '70px 0 26px' }}>Billing FAQ</h2>
        <div className="faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>

        <div className="cta-band" style={{ marginTop: 60 }}>
          <h2>Not sure which plan fits?</h2>
          <p>Start on Free — every feature is there to try. Upgrade from inside the app when you need more room.</p>
          <a href={APP_SIGNUP_URL} className="btn large">Start Free</a>
        </div>
      </div>
    </section>
  );
}
