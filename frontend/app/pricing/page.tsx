import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'Pricing — RentGuard NYC',
  description:
    'Free NYC building lookups today. Planned renter tools are waitlist-only and not available for purchase yet.',
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
      'Saved buildings for signed-in users',
    ],
    ctaLabel: 'Run a lookup →',
    ctaHref: '/',
  },
  {
    name: 'Lease Review',
    price: 'Planned',
    cadence: 'waitlist',
    status: 'waitlist',
    bullets: [
      'Not part of the current beta',
      'Researching lease-language summaries for NYC renters',
      'No lease uploads or paid reports are available today',
      'Join the research list for product updates',
    ],
    ctaLabel: 'Join research list',
    ctaHref:
      'mailto:lease-review-waitlist@rentguard.cc?subject=Lease%20review%20waitlist',
  },
  {
    name: 'Search Pass',
    price: 'Planned',
    cadence: 'waitlist',
    status: 'waitlist',
    bullets: [
      'Not part of the current beta',
      'Researching higher lookup limits for frequent searchers',
      'Saved-building notifications are planned, not live',
      'No subscription purchase is available today',
    ],
    ctaLabel: 'Join research list',
    ctaHref:
      'mailto:search-pass-waitlist@rentguard.cc?subject=Search%20Pass%20waitlist',
  },
];

const FIRM_TIER = {
  name: 'For Law Firms',
  range: 'Planned research',
  bullets: [
    'Not part of the current beta',
    'Exploring public-record report workflows for tenant advocates',
    'No client portal, branded PDFs, or bulk tools are available today',
    'Research conversations only',
  ] as const,
  ctaHref: 'mailto:firms@rentguard.cc?subject=RentGuard%20firm%20research',
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
              Free building lookup. <em>Future tools are research-only.</em>
            </h1>
            <p className="hero-sub">
              Building lookups are free today. Lease Review, Search Pass, and law-firm products are planned ideas, not active products or purchase flows.
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
                We are talking with tenant advocates and attorneys about where public-record reports could help. No firm product is live today.
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
            Join research list →
          </a>
        </div>

        <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 24, textAlign: 'center', lineHeight: 1.6 }}>
          Planned tools are shown for transparency only. They are not available to use or purchase in the current beta. See{' '}
          <Link href="/how-we-make-money">how we make money</Link> for the full transparency note.
        </p>
      </div>

      <LegalFooter />
    </div>
  );
}
