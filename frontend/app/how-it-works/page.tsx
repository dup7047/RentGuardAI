import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'How it works — RentGuard NYC',
  description:
    'Paste any NYC address or listing URL, and RentGuard pulls live HPD violations, DOB complaints, eviction filings, and landlord records into a plain-English risk report.',
};

const STEPS = [
  {
    n: '1',
    t: 'Paste a NYC address or listing URL',
    d: 'Drop in a StreetEasy or Zillow URL and we extract the address; or paste the address directly. We resolve it to a Borough-Block-Lot ID via the NYC GeoSearch API.',
  },
  {
    n: '2',
    t: 'Pull live records from NYC.gov',
    d: 'We query nine NYC Open Data sources for that BBL: HPD violations, multiple-dwelling registrations, DOB complaints, 311 housing complaints, marshal evictions, the bedbug registry, lead-paint history, and the Public Advocate Worst Landlord Watchlist.',
  },
  {
    n: '3',
    t: 'Run a structured AI summary',
    d: 'A small, audited model (gpt-4o-mini) writes a ~100-word plain-English summary of what we found. It must cite raw counts ("47 open HPD violations") and never characterizes the building, owner, or manager beyond what the records literally say.',
  },
  {
    n: '4',
    t: 'See your report',
    d: 'A 0-100 risk score with a color-coded band, "Notable findings", "Recommended next steps", and a per-source link for every indicator so you can verify every count on the original NYC.gov page.',
  },
  {
    n: '5',
    t: 'Optional: review your lease',
    d: 'Coming soon: upload your lease PDF for a $29 clause-by-clause review against NYC tenant law (HSTPA security deposit caps, FARE Act broker-fee rules, illegal late fees, and more). Preview is free; full report unlocks after payment.',
  },
] as const;

const NOT_PANEL = [
  {
    t: 'We never tell you whether to rent.',
    d: "Every report says 'always check the cited records yourself before relying on anything in this summary.' The decision is yours.",
  },
  {
    t: 'We never label landlords or buildings.',
    d: 'No first-party words like "slumlord", "scam", or "avoid". Only what the public record literally says, with a link to verify.',
  },
  {
    t: 'We are not a law firm.',
    d: 'RentGuard is informational. For legal advice on a specific lease or dispute, talk to a licensed NY attorney.',
  },
] as const;

export default function HowItWorksPage() {
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
              How RentGuard works
            </div>
            <h1 className="hero">
              From a paste to a <em>plain-English risk read</em>.
            </h1>
            <p className="hero-sub">
              Five steps, zero login required, all sources cited.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 56 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: 16,
            marginTop: 8,
          }}
        >
          {STEPS.map((s) => (
            <div key={s.n} className="card" style={{ padding: 22 }}>
              <div
                className="finding"
                style={{ borderBottom: 'none', paddingBottom: 0, alignItems: 'flex-start' }}
              >
                <div className="icn num" aria-hidden="true">
                  {s.n}
                </div>
                <div className="body">
                  <b style={{ fontSize: 15 }}>{s.t}</b>
                  <span style={{ fontSize: 13.5, marginTop: 4, display: 'block' }}>{s.d}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card panel" style={{ marginTop: 32 }}>
          <h3>What RentGuard does not do</h3>
          {NOT_PANEL.map((p) => (
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

        <div className="lease-cta" style={{ marginTop: 32 }}>
          <div className="body">
            <div>Ready to look up a building?</div>
            <div>Free, no signup for the first lookup.</div>
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
