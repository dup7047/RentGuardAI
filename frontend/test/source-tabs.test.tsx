// Smoke test: the four building-report tabs render real data instead of
// "Coming soon", and the OverviewTab indicator-card src links are
// BBL/BIN/buildingId-specific (not generic dataset homepages).

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

import { BuildingReport } from '@/components/BuildingReport';
import type { LookupResponse } from '@/lib/api/backend';

afterEach(() => {
  cleanup();
});

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

const FIXTURE: SuccessData = {
  kind: 'success',
  bbl: '1008420015',
  address: '350 5th Ave',
  borough: 'MANHATTAN',
  listing_summary: null,
  summary: 'Test summary.',
  score_explanation: null,
  score: 80,
  score_band: 'minimal',
  score_factors: [],
  indicators: [],
  questions_to_ask: [],
  listing_notes: [],
  scraped_listing: null,
  landlord: {
    registered_owner_name: 'TEST OWNER LLC',
    head_officer_name: 'Jane Doe',
    head_officer_business_address: '1 Test Way, NY, NY 10001',
    watchlist_rank: 5,
    last_fetched_at: '2026-04-01T00:00:00Z',
  },
  fare_check: null,
  stats: {
    hpd_violations_open: 12,
    hpd_violations_closed: 30,
    dob_complaints: 4,
    evictions: 1,
    bedbug_reports: 0,
    lead_flags: 0,
  },
  lookup_id: 'test',
  building_url: '/building/1008420015',
  bin: '1086410',
  hpd_building_id: '99999',
  violations_rows: [
    {
      violationid: 'V1',
      class: 'C',
      currentstatus: 'OPEN',
      novissueddate: '2024-01-15',
      novdescription: 'Test violation about heat.',
      apartment: '5A',
    },
  ],
  complaints_rows: {
    dob: [
      {
        complaint_number: 'D1',
        complaint_category: 'Illegal conversion',
        date_entered: '2024-02-01',
        status: 'CLOSED',
      },
    ],
    threeoneone: [
      {
        unique_key: '3-1',
        agency: 'HPD',
        complaint_type: 'HEAT/HOT WATER',
        descriptor: 'No heat',
        created_date: '2024-03-01',
        status: 'CLOSED',
      },
    ],
  },
  evictions_rows: [
    {
      court_index_number: 'E1',
      executed_date: '2023-09-01',
      eviction_apt_num: '3B',
      residential_commercial_ind: 'Residential',
    },
  ],
  total_counts: { violations: 42, dob: 4, threeoneone: 1, evictions: 1 },
  has_more: { violations: false, dob: false, threeoneone: false, evictions: false },
  value_score: null,
  value_band: null,
  value_confidence: null,
  value_factors: [],
  value_explanation: null,
};

function clickTab(container: HTMLElement, label: string) {
  const tab = Array.from(container.querySelectorAll('button.tab')).find((b) =>
    b.textContent?.toLowerCase().includes(label.toLowerCase()),
  );
  if (!tab) throw new Error(`Tab "${label}" not found`);
  fireEvent.click(tab);
}

describe('BuildingReport tabs', () => {
  it('overview links indicator src to BBL/BIN/building-id specific URLs', () => {
    const { container } = render(<BuildingReport data={FIXTURE} />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    // HPD Online uses hpd_building_id; DOB BIS uses bin; eviction filter uses bbl
    expect(hrefs.some((h) => h.includes('hpdonline.nyc.gov/hpdonline/building/99999'))).toBe(true);
    expect(hrefs.some((h) => h.includes('PropertyProfileOverviewServlet?bin=1086410'))).toBe(true);
    expect(hrefs.some((h) => h.includes('6z8x-wfk4') && h.includes('1008420015'))).toBe(true);
  });

  it('violations tab renders rows, not "Coming soon"', () => {
    const { container } = render(<BuildingReport data={FIXTURE} />);
    clickTab(container, 'HPD violations');
    expect(container.textContent).not.toContain('Coming soon');
    expect(container.textContent).toContain('Test violation about heat');
    expect(container.textContent).toContain('Showing 1 of 42');
  });

  it('complaints tab renders DOB + 311 sections', () => {
    const { container } = render(<BuildingReport data={FIXTURE} />);
    clickTab(container, 'DOB & 311');
    expect(container.textContent).not.toContain('Coming soon');
    expect(container.textContent).toContain('DOB complaints');
    expect(container.textContent).toContain('311 housing complaints');
    expect(container.textContent).toContain('HEAT/HOT WATER');
  });

  it('owner tab renders registered owner and watchlist rank', () => {
    const { container } = render(<BuildingReport data={FIXTURE} />);
    clickTab(container, 'Owner & watchlist');
    expect(container.textContent).not.toContain('Coming soon');
    expect(container.textContent).toContain('TEST OWNER LLC');
    expect(container.textContent).toContain('Jane Doe');
    expect(container.textContent).toContain('#5');
  });

  it('sources tab lists the primary datasets with deep links', () => {
    const { container } = render(<BuildingReport data={FIXTURE} />);
    clickTab(container, 'Sources');
    expect(container.textContent).not.toContain('Coming soon');
    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('hpdonline.nyc.gov/hpdonline/building/99999'))).toBe(true);
    expect(hrefs.some((h) => h.includes('PropertyProfileOverviewServlet?bin=1086410'))).toBe(true);
  });
});
