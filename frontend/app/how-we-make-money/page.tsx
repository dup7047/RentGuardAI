import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';
import { AffiliateLink } from '@/components/AffiliateLink';
import { DISCLAIMERS } from '@/lib/legal/disclaimers';

export const metadata: Metadata = {
  title: 'How we make money | RentGuard NYC',
  description:
    'How RentGuard pays the bills and why our reports stay editorially independent.',
  alternates: { canonical: '/how-we-make-money' },
};

const PARTNERS: ReadonlyArray<{
  partner: 'lemonade' | 'bellhop' | 'moved';
  name: string;
  category: string;
  href: string;
  pay: string;
}> = [
  {
    partner: 'lemonade',
    name: 'Lemonade',
    category: 'Renters insurance',
    href: 'https://www.lemonade.com/renters',
    pay: '~$25.50 per qualified policy',
  },
  {
    partner: 'bellhop',
    name: 'Bellhop',
    category: 'NYC movers',
    href: 'https://www.getbellhops.com/',
    pay: '$20-50 per qualified lead',
  },
  {
    partner: 'moved',
    name: 'Moved',
    category: 'Moving concierge',
    href: 'https://www.moved.com/',
    pay: '$20-50 per qualified lead',
  },
];

const NEVER = [
  'Landlords or property managers (we don’t take payment to suppress, hide, or soften any record).',
  'Brokers, law firms, or listing marketplaces for changing report content.',
  'Advertisers (no banner ads, no sponsored content in the report itself).',
] as const;

export default function HowWeMakeMoneyPage() {
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
              Transparency
            </div>
            <h1 className="hero">
              How RentGuard <em>pays the bills.</em>
            </h1>
            <p className="hero-sub">
              The short version: partner referrals today, planned paid tools later, and no money from landlords to change or hide reports.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 40 }}>
        <div className="card panel">
          <h2>Affiliate disclosure</h2>
          {/* Phase 11.6: this is the long-form transparency language from
              disclaimer.md §4.2. The byte-for-byte source lives in
              docs/legal/disclaimers.md under the affiliateLongForm anchor
              and is regenerated into disclaimers.json by
              scripts/build-disclaimers.ts. The short click-through
              language (§4.1) is rendered in the AffiliateLink modal
              instead. */}
          {DISCLAIMERS.affiliateLongForm.split(/\n\n+/).map((para, i) => (
            <p
              // eslint-disable-next-line react/no-array-index-key
              key={i}
              style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, marginBottom: i === 0 ? 12 : 8 }}
            >
              {para}
            </p>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>Partners we earn from</h2>
          <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: -4, marginBottom: 14 }}>
            Each link below opens a disclosure modal first, logs the click for our own reporting, and then opens the partner site in a new tab.
          </p>
          {PARTNERS.map((p) => (
            <div key={p.partner} className="finding" style={{ alignItems: 'center' }}>
              <div className="icn good" aria-hidden="true">
                $
              </div>
              <div className="body">
                <b>{p.name}</b>
                <span>
                  {p.category} · {p.pay}
                </span>
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <AffiliateLink partner={p.partner} href={p.href} label={`Visit ${p.name} →`} />
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>Planned products</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            Lease Review, Search Pass, saved-building notifications, and law-firm workflows are not live in the current beta. We may test those ideas later, but there is no paid purchase flow, subscription, or client portal today.
          </p>
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>What we don’t take money from</h2>
          {NEVER.map((line) => (
            <div key={line} className="finding">
              <div className="icn good" aria-hidden="true">
                ✓
              </div>
              <div className="body">
                <b>{line}</b>
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>Editorial independence</h2>
          <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
            RentGuard reports are generated from public NYC datasets and a small AI summary model. No partner sees the report before it’s rendered. No partner can pay to change a violation count, soften a finding, or remove a building from the watchlist surface. If you spot a partner-influenced problem, email us.
          </p>
        </div>

        <div className="report-cta" style={{ marginTop: 32 }}>
          <div className="body">
            <div>Have a question we didn’t answer?</div>
            <div>
              See <Link href="/pricing">pricing</Link> or run a free building lookup.
            </div>
          </div>
          <Link href="/" className="btn primary">
            Look up a building →
          </Link>
        </div>
      </div>

      <LegalFooter />
    </div>
  );
}
