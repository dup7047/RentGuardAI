import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'Pricing | RentGuard NYC',
  description: 'NYC building lookups are free. Three lookups without an account, then sign up to keep going.',
  alternates: { canonical: '/pricing' },
};

const FREE_TIER = {
  name: 'Free',
  price: '$0',
  cadence: 'forever',
  bullets: [
    '3 building lookups without an account',
    'Create a free account to keep looking',
    'AI risk summary with cited NYC.gov sources',
    'Saved buildings for signed-in users',
  ] as const,
  ctaLabel: 'Run a lookup →',
  ctaHref: '/',
};

function LiveChip() {
  return (
    <span
      className="chip"
      style={{ background: 'var(--good-soft)', color: 'var(--good)' }}
    >
      Live now
    </span>
  );
}

export default function PricingPage() {
  return (
    <div className="screen-fade">
      <div className="landing" style={{ paddingBottom: 30 }}>
        <div className="landing-bg" />
        <div className="container">
          <div className="hero-center">
            <div className="eyebrow">
              <span className="ico" aria-hidden="true">
                ✦
              </span>
              Pricing
            </div>
            <h1 className="hero">
              Free building lookup. <em>No credit card needed.</em>
            </h1>
            <p className="hero-sub">
              Try three lookups without signing up. Create a free account to keep going.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 40 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 420px)',
            justifyContent: 'center',
            gap: 16,
          }}
        >
          <div className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{FREE_TIER.name}</h3>
              <LiveChip />
            </div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>{FREE_TIER.price}</span>
              <span style={{ fontSize: 13, color: 'var(--muted)' }}>{FREE_TIER.cadence}</span>
            </div>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: '16px 0 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {FREE_TIER.bullets.map((b) => (
                <li key={b} style={{ fontSize: 13.5, color: 'var(--ink-2)', display: 'flex', gap: 8, lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--accent)' }} aria-hidden="true">
                    ✓
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'auto' }}>
              <Link className="btn primary full" href={FREE_TIER.ctaHref}>
                {FREE_TIER.ctaLabel}
              </Link>
            </div>
          </div>
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.6 }}>
          See <Link href="/how-we-make-money">how we make money</Link> for the full transparency note.
        </p>
      </div>

      <LegalFooter />
    </div>
  );
}
