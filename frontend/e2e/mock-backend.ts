import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env.E2E_MOCK_BACKEND_PORT ?? '18080');
const appOrigin = `http://127.0.0.1:${Number(process.env.E2E_APP_PORT ?? '3100')}`;

type LookupSuccess = {
  kind: 'success';
  bbl: string;
  address: string;
  borough: string;
  listing_summary: string | null;
  summary: string;
  score_explanation: string | null;
  score: number | null;
  score_band: 'minimal' | 'moderate' | 'elevated' | 'high' | null;
  score_factors: Array<{ key: string; label: string; impact: number; reason: string }>;
  indicators: Array<{ key: string; value: string; source_url: string }>;
  questions_to_ask: string[];
  listing_notes: Array<{ snippet: string; note: string }>;
  scraped_listing: {
    url: string;
    source: 'streeteasy' | 'zillow' | 'generic';
    source_kind: 'rental' | 'building' | 'sale' | 'unknown';
    fetchedAt: string;
    address: string | null;
    unit: string | null;
    monthlyRentCents: number | null;
    bedrooms: number | null;
    bathrooms: number | null;
    squareFeet: number | null;
    brokerFeeStated: 'no_fee' | 'fee' | 'unknown';
    brokerFeeText: string | null;
    securityDepositText: string | null;
    leaseTermMonths: number | null;
    petsPolicy: string | null;
    utilitiesIncluded: string[];
    amenities: string[];
    availabilityDate: string | null;
    description: string | null;
    title: string | null;
    daysOnMarket: number | null;
    agentName: string | null;
    brokerage: string | null;
    confidence: 'high' | 'medium' | 'low';
  } | null;
  value_score: number | null;
  value_band: 'great_deal' | 'fair' | 'above_market' | 'overpriced' | null;
  value_confidence: 'high' | 'medium' | 'low' | null;
  value_factors: Array<{ key: string; label: string; impact: number; reason: string }>;
  value_explanation: string | null;
  listing_unavailable?: boolean;
  landlord: Record<string, unknown>;
  fare_check: Record<string, unknown> | null;
  stats: Record<string, number>;
  lookup_id: string | null;
  building_url: string;
  bin?: string | null;
  hpd_building_id?: string | null;
  violations_rows?: Array<Record<string, string | undefined>>;
  complaints_rows?: {
    dob: Array<Record<string, string | undefined>>;
    threeoneone: Array<Record<string, string | undefined>>;
  };
  evictions_rows?: Array<Record<string, string | undefined>>;
  total_counts?: Record<string, number>;
  has_more?: Record<string, boolean>;
  partial?: string[];
};

function headers(contentType = 'application/json') {
  return {
    'access-control-allow-origin': appOrigin,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers':
      'Content-Type,Authorization,apikey,x-client-info,x-supabase-api-version',
    vary: 'Origin',
    'content-type': contentType,
  };
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, headers());
  res.end(JSON.stringify(body));
}

function sendText(res: ServerResponse, status: number, body: string, contentType = 'text/plain') {
  res.writeHead(status, headers(contentType));
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function valueOrDefault<T>(overrides: Partial<LookupSuccess>, key: keyof LookupSuccess, fallback: T): T {
  return Object.prototype.hasOwnProperty.call(overrides, key)
    ? ((overrides as Record<string, unknown>)[key] as T)
    : fallback;
}

function baseReport(overrides: Partial<LookupSuccess> = {}): LookupSuccess {
  const bbl = overrides.bbl ?? '1008420015';
  return {
    kind: 'success',
    bbl,
    address: overrides.address ?? '350 5th Ave',
    borough: overrides.borough ?? 'MANHATTAN',
    listing_summary: valueOrDefault(
      overrides,
      'listing_summary',
      'This listing describes a two-bedroom rental with elevator access, laundry, and a stated no-fee broker arrangement.',
    ),
    summary:
      overrides.summary ??
      'At-risk apartments: APT 4B appears more than once across recent HPD records. The building has a moderate public-record risk profile because open HPD violations and resident complaints are present, but there is no current watchlist rank.',
    score_explanation: valueOrDefault(
      overrides,
      'score_explanation',
      'The score weighs open HPD violations, DOB complaints, evictions, and owner-watchlist status.',
    ),
    score: valueOrDefault(overrides, 'score', 62),
    score_band: valueOrDefault(overrides, 'score_band', 'elevated'),
    score_factors:
      overrides.score_factors ??
      [
        {
          key: 'open_hpd',
          label: 'Open HPD violations',
          impact: -18,
          reason: 'There are open housing-code violations that should be verified before signing.',
        },
        {
          key: 'dob_complaints',
          label: 'DOB complaints',
          impact: -8,
          reason: 'Recent DOB complaints suggest building-condition questions are worth asking.',
        },
      ],
    indicators: overrides.indicators ?? [],
    questions_to_ask:
      overrides.questions_to_ask ??
      [
        'Which open HPD violations have been corrected but not closed?',
        'Has apartment 4B had recurring heat or leak complaints?',
        'Can the owner provide the latest HPD registration filing?',
      ],
    listing_notes:
      overrides.listing_notes ??
      [
        {
          snippet: 'no broker fee',
          note: 'Confirm who listed the unit and whether any fee is charged at signing.',
        },
      ],
    scraped_listing: valueOrDefault(
      overrides,
      'scraped_listing',
      {
        url: 'https://streeteasy.com/building/e2e/1',
        source: 'streeteasy',
        source_kind: 'rental',
        fetchedAt: '2026-05-20T12:00:00.000Z',
        address: '350 5th Ave, New York, NY',
        unit: '4B',
        monthlyRentCents: 420000,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 850,
        brokerFeeStated: 'no_fee',
        brokerFeeText: 'No fee',
        securityDepositText: 'One month',
        leaseTermMonths: 12,
        petsPolicy: 'Cats allowed',
        utilitiesIncluded: ['heat', 'hot water'],
        amenities: ['elevator', 'laundry'],
        availabilityDate: '2026-06-01',
        description: 'No broker fee two-bedroom near transit.',
        title: 'Sunny two-bedroom',
        daysOnMarket: 12,
        agentName: 'Alex Agent',
        brokerage: 'Example Realty',
        confidence: 'high',
      },
    ),
    value_score: valueOrDefault(overrides, 'value_score', 74),
    value_band: valueOrDefault(overrides, 'value_band', 'fair'),
    value_confidence: valueOrDefault(overrides, 'value_confidence', 'high'),
    value_factors:
      overrides.value_factors ??
      [
        {
          key: 'rent_vs_comp',
          label: 'Rent vs comps',
          impact: 6,
          reason: 'The rent is close to nearby two-bedroom medians.',
        },
      ],
    value_explanation: valueOrDefault(
      overrides,
      'value_explanation',
      'The asking rent is near the neighborhood median for comparable two-bedroom listings.',
    ),
    landlord:
      overrides.landlord ??
      {
        registered_owner_name: 'TEST OWNER LLC',
        hpd_corporation_name: 'TEST OWNER CORP',
        registration_id: '123456',
        head_officer_name: 'Riley Owner',
        head_officer_business_address: '1 Test Plaza, New York, NY',
        watchlist_rank: null,
        last_fetched_at: '2026-05-20T12:00:00.000Z',
      },
    fare_check: overrides.fare_check ?? { flag: 'no_indicators', reasons: [] },
    stats:
      overrides.stats ??
      {
        hpd_violations_open: 3,
        hpd_violations_closed: 12,
        dob_complaints: 2,
        evictions: 1,
        bedbug_reports: 0,
        lead_flags: 1,
      },
    lookup_id: overrides.lookup_id ?? 'lookup_e2e_1',
    building_url: overrides.building_url ?? `/building/${bbl}`,
    bin: valueOrDefault(overrides, 'bin', '1015862'),
    hpd_building_id: valueOrDefault(overrides, 'hpd_building_id', '12345'),
    violations_rows:
      overrides.violations_rows ??
      [
        {
          violationid: 'VIO-1',
          class: 'C',
          novissueddate: '2026-04-15T00:00:00.000Z',
          inspectiondate: '2026-04-14T00:00:00.000Z',
          currentstatus: 'OPEN',
          currentstatusdate: '2026-04-18T00:00:00.000Z',
          novdescription: 'Immediately hazardous heat condition.',
          apartment: '4B',
        },
        {
          violationid: 'VIO-2',
          class: 'B',
          novissueddate: '2026-03-01T00:00:00.000Z',
          currentstatus: 'CLOSE',
          novdescription: 'Leak at ceiling.',
          apartment: '2A',
        },
      ],
    complaints_rows:
      overrides.complaints_rows ??
      {
        dob: [
          {
            complaint_number: 'DOB-1',
            complaint_category: 'Structural',
            date_entered: '2026-02-10T00:00:00.000Z',
            status: 'ACTIVE',
            disposition_code: 'A1',
            disposition_date: '2026-02-12T00:00:00.000Z',
          },
        ],
        threeoneone: [
          {
            unique_key: '311-1',
            created_date: '2026-01-22T00:00:00.000Z',
            agency: 'HPD',
            complaint_type: 'HEAT/HOT WATER',
            descriptor: 'ENTIRE BUILDING',
            status: 'Closed',
          },
        ],
      },
    evictions_rows:
      overrides.evictions_rows ??
      [
        {
          court_index_number: 'LT-123',
          executed_date: '2025-12-02T00:00:00.000Z',
          eviction_address: '350 5th Ave',
          eviction_apt_num: '3C',
          residential_commercial_ind: 'Residential',
        },
      ],
    total_counts: overrides.total_counts ?? { violations: 2, dob: 1, threeoneone: 1, evictions: 1 },
    has_more:
      overrides.has_more ??
      { violations: false, dob: false, threeoneone: false, hpd_complaints: false, evictions: false },
    partial: overrides.partial,
    listing_unavailable: overrides.listing_unavailable,
  };
}

function reportForBbl(bbl: string): LookupSuccess | null {
  if (bbl === '1000000000') {
    return baseReport({
      bbl,
      address: '1 Empty Row Way',
      listing_summary: null,
      score: null,
      score_band: null,
      score_factors: [],
      scraped_listing: null,
      value_score: null,
      value_band: null,
      value_confidence: null,
      value_factors: [],
      value_explanation: null,
      landlord: {
        registered_owner_name: null,
        hpd_corporation_name: null,
        registration_id: null,
        head_officer_name: null,
        head_officer_business_address: null,
        watchlist_rank: null,
        last_fetched_at: '2026-05-20T12:00:00.000Z',
      },
      stats: {
        hpd_violations_open: 0,
        hpd_violations_closed: 0,
        dob_complaints: 0,
        evictions: 0,
        bedbug_reports: 0,
        lead_flags: 0,
      },
      violations_rows: [],
      complaints_rows: { dob: [], threeoneone: [] },
      evictions_rows: [],
      total_counts: { violations: 0, dob: 0, threeoneone: 0, evictions: 0 },
      has_more: { violations: false, dob: false, threeoneone: false, hpd_complaints: false, evictions: false },
    });
  }
  if (bbl === '1009999999') {
    const manyViolations = Array.from({ length: 18 }, (_, i) => ({
      violationid: `VIO-LARGE-${i}`,
      class: i % 3 === 0 ? 'C' : 'B',
      novissueddate: '2026-04-15T00:00:00.000Z',
      currentstatus: i % 2 === 0 ? 'OPEN' : 'CLOSE',
      novdescription: `Large fixture violation row ${i + 1}`,
      apartment: `${i + 1}A`,
    }));
    return baseReport({
      bbl,
      address: '999 Dense Data Ave',
      stats: {
        hpd_violations_open: 18,
        hpd_violations_closed: 122,
        dob_complaints: 51,
        evictions: 101,
        bedbug_reports: 4,
        lead_flags: 2,
      },
      violations_rows: manyViolations,
      total_counts: { violations: 140, dob: 51, threeoneone: 80, evictions: 101 },
      has_more: { violations: true, dob: true, threeoneone: true, hpd_complaints: true, evictions: true },
      partial: ['bedbug'],
    });
  }
  if (bbl === '1008420999') {
    return baseReport({
      bbl,
      listing_summary: null,
      scraped_listing: null,
      listing_unavailable: true,
    });
  }
  if (bbl === '4040000000') return null;
  return baseReport({ bbl });
}

function lookupResponse(input: Record<string, unknown>) {
  const address = typeof input.address === 'string' ? input.address.toLowerCase() : '';
  const listingUrl = typeof input.listingUrl === 'string' ? input.listingUrl.toLowerCase() : '';
  if (listingUrl.includes('blocked')) {
    if (input.address) {
      return reportForBbl('1008420999');
    }
    return { kind: 'listing_blocked', message: 'The listing is behind bot protection.' };
  }
  if (listingUrl.includes('expired')) return { kind: 'listing_expired', message: 'Expired listing.' };
  if (listingUrl.includes('missing')) return { kind: 'listing_not_found', message: 'Listing not found.' };
  if (listingUrl.includes('unsupported')) return { kind: 'unsupported_url', message: 'Unsupported listing URL.' };
  if (address.includes('ambiguous')) {
    return {
      kind: 'ambiguous',
      matches: [
        { bbl: '1008420015', address: '350 5th Ave, Manhattan', borough: 'MANHATTAN' },
        { bbl: '3001110001', address: '350 5th Ave, Brooklyn', borough: 'BROOKLYN' },
      ],
    };
  }
  if (address.includes('philadelphia') || address.includes('outside')) {
    return { kind: 'outside_nyc', detected_city: 'Philadelphia', detected_state: 'PA' };
  }
  if (address.includes('email gate') && !input.email) {
    return { kind: 'email_gate', message: 'Drop your email to keep looking.' };
  }
  if (address.includes('rate limit')) {
    return { kind: 'rate_limited', message: 'Too many lookups in the last hour. Try again later.' };
  }
  if (address.includes('cost cap')) {
    return { kind: 'cost_cap', message: "We've hit today's free cap — try again tomorrow." };
  }
  if (address.includes('server error')) {
    return { kind: 'server_error', message: 'Lookup failed. Please try again.' };
  }
  if (address.includes('partial')) {
    return baseReport({ partial: ['hpd', 'dob'], listing_summary: null, scraped_listing: null });
  }
  if (input.bbl === '1000000000') return reportForBbl('1000000000');
  return baseReport();
}

async function writeLookupStream(res: ServerResponse, input: Record<string, unknown>) {
  const address = typeof input.address === 'string' ? input.address.toLowerCase() : '';
  res.writeHead(200, headers('application/x-ndjson'));

  if (address.includes('malformed stream')) {
    res.write('{"event":"phase","name":"parse"}\n');
    res.write('{not-json}\n');
    res.end();
    return;
  }
  if (address.includes('incomplete stream')) {
    res.write('{"event":"phase","name":"parse"}\n');
    res.write('{"event":"phase","name":"geo"}\n');
    res.end();
    return;
  }

  const phases = ['parse', 'geo', 'hpd', 'dob', 'owner', 'ai'];
  const slow = address.includes('slow');
  for (const phase of phases) {
    res.write(JSON.stringify({ event: 'phase', name: phase }) + '\n');
    if (phase === 'owner') {
      res.write(JSON.stringify({ event: 'data_ready', data: { score: 62, score_band: 'elevated' } }) + '\n');
    }
    if (slow) await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const response = lookupResponse(input);
  res.write(JSON.stringify({ event: 'complete', status: response?.kind === 'cost_cap' ? 402 : 200, response }) + '\n');
  res.end();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, headers());
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', commit: 'e2e' });
    return;
  }

  if (url.pathname === '/auth/v1/user') {
    sendJson(res, 401, { message: 'No current user in E2E mock auth.' });
    return;
  }
  if (url.pathname === '/auth/v1/otp') {
    await readBody(req);
    sendJson(res, 200, {});
    return;
  }
  if (url.pathname === '/auth/v1/signup') {
    const body = await readBody(req);
    sendJson(res, 200, {
      user: { id: 'e2e-user', email: body.email ?? 'renter@example.com' },
      session: null,
    });
    return;
  }
  if (url.pathname === '/auth/v1/token') {
    sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    return;
  }

  if (url.pathname.startsWith('/geosearch')) {
    sendJson(res, 200, {
      features: [
        {
          properties: {
            label: '350 5 AVENUE, BROOKLYN, NY',
            housenumber: '350',
            street: '5 AVENUE',
            borough: 'Brooklyn',
            neighbourhood: 'Park Slope',
            addendum: { pad: { bbl: '1008420015' } },
          },
        },
      ],
    });
    return;
  }

  if (url.pathname === '/v1/lookup/stream' && req.method === 'POST') {
    await writeLookupStream(res, await readBody(req));
    return;
  }

  const buildingMatch = /^\/v1\/building\/(\d{10})$/.exec(url.pathname);
  if (buildingMatch) {
    const report = reportForBbl(buildingMatch[1]);
    if (!report) {
      sendJson(res, 404, { kind: 'not_found' });
      return;
    }
    sendJson(res, 200, report);
    return;
  }

  if (url.pathname === '/v1/waitlist/email' && req.method === 'POST') {
    await readBody(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname === '/v1/affiliate/click' && req.method === 'POST') {
    await readBody(req);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (url.pathname.startsWith('/v1/saved-buildings')) {
    sendJson(res, 401, { kind: 'unauthorized' });
    return;
  }

  sendText(res, 404, 'not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`RentGuard E2E mock backend listening on http://127.0.0.1:${port}`);
});
