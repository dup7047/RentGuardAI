import type { Metadata } from 'next';
import Link from 'next/link';

import { LegalFooter } from '@/components/LegalFooter';

export const metadata: Metadata = {
  title: 'Coverage — what data RentGuard checks',
  description:
    'Every NYC Open Data source RentGuard reads on every building lookup, with refresh cadence and a link to the raw catalog.',
};

const SOURCES: ReadonlyArray<{
  name: string;
  agency: string;
  refresh: string;
  what: string;
  url: string;
}> = [
  {
    name: 'HPD Housing Maintenance Code Violations',
    agency: 'HPD',
    refresh: 'Daily',
    what: 'Every Class A/B/C/I violation issued under the NYC Housing Maintenance Code. Open vs. closed status with compliance deadlines.',
    url: 'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5',
  },
  {
    name: 'HPD Multiple Dwelling Registrations',
    agency: 'HPD',
    refresh: 'Weekly',
    what: 'Every legally registered residential building in NYC. Tells us whether the building is currently in compliance with HPD’s annual filing requirement.',
    url: 'https://data.cityofnewyork.us/Housing-Development/Multiple-Dwelling-Registrations/tesw-yqqr',
  },
  {
    name: 'HPD Registration Contacts',
    agency: 'HPD',
    refresh: 'Weekly',
    what: 'The named owner, head officer, and managing agent on file for the building. We use this to identify the registered owner and roll up multi-building portfolios.',
    url: 'https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2',
  },
  {
    name: 'DOB Complaints',
    agency: 'DOB',
    refresh: 'Daily',
    what: 'Construction and safety complaints filed against the building, including the disposition once DOB has investigated.',
    url: 'https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv',
  },
  {
    name: '311 Housing Service Requests',
    agency: '311 / DOITT',
    refresh: 'Daily',
    what: 'Resident-filed 311 calls about heat, hot water, mold, vermin, and other housing conditions. We surface those in the Housing complaint type.',
    url: 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9',
  },
  {
    name: 'NYC Marshal Evictions',
    agency: 'DOI',
    refresh: 'Daily',
    what: 'Evictions actually executed by NYC marshals. Counts only completed evictions, not filings.',
    url: 'https://data.cityofnewyork.us/City-Government/Evictions/6z8x-wfk4',
  },
  {
    name: 'Bedbug Reports',
    agency: 'HPD',
    refresh: 'Annual',
    what: 'NYC requires annual bedbug-history filings. We surface whether any bedbug infestations have been reported in the building.',
    url: 'https://data.cityofnewyork.us/Housing-Development/Bedbug-Reporting/wz6d-d3jb',
  },
  {
    name: 'Lead Paint History',
    agency: 'HPD',
    refresh: 'On change',
    what: 'Lead-paint violations and inspections in pre-1960 buildings, where children under 6 reside.',
    url: 'https://data.cityofnewyork.us/Housing-Development/HPD-Lead-Based-Paint-Information/v574-pyre',
  },
  {
    name: 'Worst Landlord Watchlist',
    agency: 'NYC Public Advocate',
    refresh: 'Monthly',
    what: 'The Public Advocate’s annual list of landlords with the worst HPD violation profiles. We match by registered-owner name; rank is informational, not a legal determination.',
    url: 'https://landlordwatchlist.com/',
  },
];

const DEFERRED = [
  'ACRIS deeds (true title chain across LLCs)',
  'NYCDB landlord-portfolio joins',
  'Cities outside NYC — drop your email and we’ll let you know when we expand',
] as const;

export default function CoveragePage() {
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
              What we check
            </div>
            <h1 className="hero">
              Nine NYC Open Data sources, <em>every lookup.</em>
            </h1>
            <p className="hero-sub">
              We pull live records from NYC.gov for the building you ask about and link every count back to the original source so you can verify it.
            </p>
          </div>
        </div>
      </div>

      <div className="container" style={{ paddingBottom: 40 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: 14,
          }}
        >
          {SOURCES.map((s) => (
            <a
              key={s.name}
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-card"
              style={{ textAlign: 'left', display: 'block' }}
            >
              <div className="ico" aria-hidden="true">
                {s.agency.charAt(0)}
              </div>
              <div className="nm">{s.name}</div>
              <div className="ds" style={{ marginTop: 8 }}>{s.what}</div>
              <div
                className="mono"
                style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}
              >
                {s.agency} · refresh: {s.refresh}
              </div>
            </a>
          ))}
        </div>

        <div className="trust" style={{ marginTop: 40 }}>
          <div className="item">
            <b>Manhattan</b>
            <span>Borough 1</span>
          </div>
          <div className="sep" />
          <div className="item">
            <b>Bronx</b>
            <span>Borough 2</span>
          </div>
          <div className="sep" />
          <div className="item">
            <b>Brooklyn</b>
            <span>Borough 3</span>
          </div>
          <div className="sep" />
          <div className="item">
            <b>Queens</b>
            <span>Borough 4</span>
          </div>
          <div className="sep" />
          <div className="item">
            <b>Staten Island</b>
            <span>Borough 5</span>
          </div>
        </div>

        <div className="card panel" style={{ marginTop: 40 }}>
          <h3>What we don’t cover yet</h3>
          {DEFERRED.map((d) => (
            <div key={d} className="finding">
              <div className="icn warn" aria-hidden="true">
                !
              </div>
              <div className="body">
                <b>{d}</b>
              </div>
            </div>
          ))}
          <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: 12 }}>
            Outside NYC? Paste an address and we’ll capture your email so you’re first in line when we expand.
          </p>
        </div>

        <div className="lease-cta" style={{ marginTop: 32 }}>
          <div className="body">
            <div>Try a real building</div>
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
