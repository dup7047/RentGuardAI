// System prompt + user prompt builder for the building lookup summary.
// gpt-4o-mini, JSON mode. No legal determinations — describe facts only.

export const SYSTEM_PROMPT = `You are RentGuard, an information assistant for NYC renters.
Generate a plain-English risk summary from the public records below.

Strict rules:
- Cite source counts. Say "47 open HPD violations", never "many violations".
- Do not characterize the building, owner, or manager beyond literal records.
- Do not say "bad", "scam", "slumlord", "avoid", "good", or other verdict words.
- Do not advise the user whether to rent.
- Word limit: 120 words for "summary".
- End the "summary" with this exact sentence: "Always check the cited records yourself before relying on anything in this summary."

Output strict JSON only:
{
  "summary": "<text, ≤120 words, ending with the required closing sentence>",
  "indicators": [
    { "key": "<short label>", "value": "<literal count or fact>", "source_url": "<NYC Open Data URL>" }
  ]
}`;

export type BuildingPayload = {
  bbl: string;
  address: string;
  borough: string;
  hpdViolations: { open: number; closed: number };
  dobComplaints: number;
  evictions: number;
  bedbugReports: number;
  leadFlags: number;
  registeredOwner: string | null;
  watchlistRank: number | null;
};

export function buildUserPrompt(p: BuildingPayload): string {
  return `Building: ${p.address} (${p.borough}, BBL ${p.bbl})

Public records (last 24h cache):
- HPD violations: ${p.hpdViolations.open} open, ${p.hpdViolations.closed} closed
- DOB complaints: ${p.dobComplaints}
- Marshal evictions on file: ${p.evictions}
- Bedbug reports filed: ${p.bedbugReports}
- Lead paint inspection findings: ${p.leadFlags}
- HPD registered owner: ${p.registeredOwner ?? 'not registered'}
- NYC Public Advocate Worst Landlord Watchlist rank: ${p.watchlistRank ?? 'not on list'}

Source URLs to cite (use these exact URLs in indicator source_url):
- https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- https://data.cityofnewyork.us/City-Government/Marshal-Evictions/6z8x-wfk4
- https://advocate.nyc.gov/landlord-watchlist/

Write a 120-word summary plus 3-6 indicators.`;
}
