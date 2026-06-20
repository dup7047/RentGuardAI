import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'For owners and managers | RentGuard NYC',
  description:
    'How RentGuard reports on NYC buildings, and how to correct outdated information sourced from NYC.gov.',
  alternates: { canonical: '/for-landlords' },
};

const PUBLISHED = [
  {
    t: 'Counts of HPD violations, by class.',
    d: 'Open and closed counts directly from the HPD Housing Maintenance Code Violations dataset, with links to the originals on HPD Online.',
  },
  {
    t: 'DOB, 311, and eviction filings on file.',
    d: 'Aggregated from the public DOB Complaints, 311 Service Requests, and Marshal Evictions datasets. Each indicator links back to NYC.gov.',
  },
  {
    t: 'Registered owner and managing agent.',
    d: 'The names you filed with HPD on the most recent Multiple Dwelling Registration. We surface these because the building is required by law to identify them.',
  },
  {
    t: 'Watchlist rank if matched.',
    d: 'When the registered-owner name matches an entry on the NYC Public Advocate’s Worst Landlord Watchlist, we display the rank with a link to the source.',
  },
] as const;

const NEVER = [
  'We never use first-party labels like “slumlord”, “scam”, or “avoid”. The AI summary is constrained to cite raw counts and link to source.',
  'We never characterize the owner’s or manager’s intent or motivation.',
  'We never publish information that is not already public on NYC.gov.',
] as const;

const CORRECT_STEPS = [
  {
    n: '1',
    t: 'Update your HPD Multiple Dwelling Registration.',
    d: 'Annual filings keep the contacts current. Once HPD’s data refreshes, our cache rolls over and the report follows.',
    href: 'https://www.nyc.gov/site/hpd/services-and-information/register-your-property.page',
    label: 'HPD registration portal →',
  },
  {
    n: '2',
    t: 'Close out HPD violations through HPD Online.',
    d: 'Once a violation is dismissed or closed at the source, it stops counting against the building on RentGuard.',
    href: 'https://hpdonline.nyc.gov/hpdonline/',
    label: 'HPD Online →',
  },
  {
    n: '3',
    t: 'Email us with the BBL and the source link.',
    d: 'If you believe a specific count is wrong relative to the NYC.gov source we cite, send us the BBL, the indicator, and the link to the underlying record. We mirror the source. We don’t adjudicate it.',
    href: 'mailto:corrections@rentguard.cc?subject=Building%20data%20correction',
    label: 'Email corrections@rentguard.cc',
  },
] as const;

export default function ForLandlordsPage() {
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
              For owners and managers
            </div>
            <h1 className="hero">
              We mirror NYC.gov. <em>Fix the source. Fix the report.</em>
            </h1>
            <p className="hero-sub">
              RentGuard surfaces public NYC records about your buildings. Every count cites a primary source. If an indicator looks wrong, the correction belongs at the source, and once it lands there, it lands here too.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 40 }}>
        <div className="card panel">
          <h2>What we publish</h2>
          {PUBLISHED.map((p) => (
            <div key={p.t} className="finding">
              <div className="icn good" aria-hidden="true">
                ✓
              </div>
              <div className="body">
                <b>{p.t}</b>
                <span>{p.d}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>How to correct outdated information</h2>
          {CORRECT_STEPS.map((s) => (
            <div key={s.n} className="finding" style={{ alignItems: 'flex-start' }}>
              <div className="icn num" aria-hidden="true">
                {s.n}
              </div>
              <div className="body">
                <b>{s.t}</b>
                <span style={{ display: 'block' }}>{s.d}</span>
                <a
                  href={s.href}
                  target={s.href.startsWith('mailto:') ? undefined : '_blank'}
                  rel={s.href.startsWith('mailto:') ? undefined : 'noopener noreferrer'}
                  style={{ display: 'inline-block', marginTop: 6, fontSize: 13 }}
                >
                  {s.label}
                </a>
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 24 }}>
          <h2>What this isn’t</h2>
          {NEVER.map((line) => (
            <div key={line} className="finding">
              <div className="icn warn" aria-hidden="true">
                !
              </div>
              <div className="body">
                <b>{line}</b>
              </div>
            </div>
          ))}
          <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12, lineHeight: 1.6 }}>
            RentGuard is not a law firm and does not provide legal advice. Building reports are generated from public NYC datasets. Records may be incomplete or out of date, which is exactly why we link back to every source.
          </p>
        </div>

        <div className="report-cta" style={{ marginTop: 32 }}>
          <div className="body">
            <div>Questions about a report?</div>
            <div>
              Send the BBL and source link so we can compare RentGuard against the cited public record. Email{' '}
              <a href="mailto:owners@rentguard.cc">owners@rentguard.cc</a>.
            </div>
          </div>
          <Link href="/coverage" className="btn ghost">
            See data sources →
          </Link>
        </div>
      </div>

      <LegalFooter />
    </div>
  );
}
