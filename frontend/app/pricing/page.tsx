import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'Pricing — RentGuard NYC',
  description:
    'Free building lookups today. Lease review and Search Pass tiers are launching soon — join the waitlist.',
};

type Tier = {
  name: string;
  price: string;
  cadence: string;
  status: 'live' | 'waitlist';
  bullets: ReadonlyArray<string>;
  ctaLabel: string;
  ctaHref: string;
};

const TIERS: ReadonlyArray<Tier> = [
  {
    name: 'Free',
    price: '$0',
    cadence: 'forever',
    status: 'live',
    bullets: [
      '1 building lookup before email capture',
      '3 lookups/mo after email capture',
      'AI risk summary with cited NYC.gov sources',
      'FARE Act compliance check on listings',
    ],
    ctaLabel: 'Run a lookup →',
    ctaHref: '/',
  },
  {
    name: 'Lease Review',
    price: '$29',
    cadence: 'one-time',
    status: 'waitlist',
    bullets: [
      'Upload your lease PDF',
      'Clause-by-clause review against NYC tenant law',
      'Free preview of top findings',
      'Full report unlocks after payment',
    ],
    ctaLabel: 'Join waitlist',
    ctaHref:
      'mailto:lease-review-waitlist@rentguard.cc?subject=Lease%20review%20waitlist',
  },
  {
    name: 'Search Pass',
    price: '$14.99',
    cadence: 'per month',
    status: 'waitlist',
    bullets: [
      'Unlimited building lookups',
      '1 lease review/mo included',
      'Saved-building violation alerts (weekly)',
      'Cancel anytime',
    ],
    ctaLabel: 'Join waitlist',
    ctaHref: '/login?redirectTo=/dashboard',
  },
];

const FIRM_TIER = {
  name: 'For Law Firms',
  range: '$199 – $499/mo',
  bullets: [
    'Unlimited lease reviews for clients',
    'Branded report PDFs (your firm logo)',
    'Multi-attorney seats and audit log on the Firm plan',
    'CSV bulk client onboarding',
  ] as const,
  ctaHref: 'mailto:firms@rentguard.cc?subject=RentGuard%20for%20firms',
};

function ComingSoonChip() {
  return (
    <span
      className="chip"
      style={{
        background: 'var(--warn-soft)',
        color: 'oklch(0.45 0.13 70)',
        borderColor: 'color-mix(in oklch, var(--warn) 30%, white)',
      }}
    >
      Coming soon — join waitlist
    </span>
  );
}

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
              Free for renters. <em>Pay only when you need more.</em>
            </h1>
            <p className="hero-sub">
              Building lookups are free today. Lease review and Search Pass open up shortly — join the waitlist below to get notified at launch.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 40 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
          }}
        >
          {TIERS.map((tier) => (
            <div key={tier.name} className="card" style={{ padding: 22, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{tier.name}</h3>
                {tier.status === 'live' ? <LiveChip /> : <ComingSoonChip />}
              </div>
              <div style={{ marginTop: 14, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em' }}>{tier.price}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{tier.cadence}</span>
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
                {tier.bullets.map((b) => (
                  <li key={b} style={{ fontSize: 13.5, color: 'var(--ink-2)', display: 'flex', gap: 8, lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--accent)' }} aria-hidden="true">
                      ✓
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
              <div style={{ marginTop: 'auto' }}>
                {tier.ctaHref.startsWith('mailto:') ? (
                  <a className="btn primary full" href={tier.ctaHref}>
                    {tier.ctaLabel}
                  </a>
                ) : (
                  <Link className="btn primary full" href={tier.ctaHref}>
                    {tier.ctaLabel}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ margin: 0 }}>{FIRM_TIER.name}</h3>
              <p style={{ marginTop: 4, fontSize: 14, color: 'var(--ink-2)' }}>
                White-label lease review for NYC tenant attorneys. Branded PDFs, unlimited client reviews.
              </p>
            </div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>{FIRM_TIER.range}</div>
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '16px 0',
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 10,
            }}
          >
            {FIRM_TIER.bullets.map((b) => (
              <li key={b} style={{ fontSize: 13.5, color: 'var(--ink-2)', display: 'flex', gap: 8, lineHeight: 1.5 }}>
                <span style={{ color: 'var(--accent)' }} aria-hidden="true">
                  ✓
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <a className="btn ghost" href={FIRM_TIER.ctaHref}>
            Book a demo →
          </a>
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.6 }}>
          Lease Review and Search Pass are not yet available for purchase; pricing shown is target pricing at launch. See{' '}
          <Link href="/how-we-make-money">how we make money</Link> for the full transparency note.
        </p>
      </div>

      <LegalFooter />
    </div>
  );
}
