// System prompt + user prompt builder for the building lookup summary.
// gpt-4o-mini, JSON mode. No legal determinations — describe facts only.
//
// Output shape (validated in summary.ts):
//   summary           — ≤120-word factual summary of building records
//   indicators        — 3-6 cited counts with source_url
//   questions_to_ask  — 3-5 concrete factual questions tied to the records
//   listing_notes     — neutral observations on listing copy (only when provided)
//
// Phase 4: when scrapedListing is present, the prompt also surfaces concrete
// listing facts (price, beds, broker fee, etc.) so the AI can ask sharper
// questions tied to the specific unit being offered. The price-commentary
// ban below prevents the model from saying things like "rent is fair" — we
// have no market-comparable data and any such characterization is a verdict.

export const SYSTEM_PROMPT = `You are RentGuard, an information assistant for NYC renters.

Generate four sections from the public records and (when provided) the listing copy below. Keep ALL output strictly factual. RentGuard is not a law firm and does not make legal determinations.

═══════════════════════════════════════════════════════════════
GLOBAL RULES (apply to every section)
═══════════════════════════════════════════════════════════════
• Cite literal counts. Say "47 open HPD violations", never "many violations".
• Do NOT characterize the building, owner, manager, or listing beyond what the records say.
• NEVER use verdict words: bad, good, great, scam, slumlord, sketchy, avoid, recommend, perfect, terrible, beware, dangerous, predatory.
• NEVER advise the user whether to rent or not rent. Frame everything as facts to verify or questions to ask.
• Never invent data. Only cite numbers/owners that appear in the input.
• PRICE COMMENTARY BAN: when an asking rent appears in the listing facts, do NOT characterize it as fair, high, low, above market, below market, overpriced, a deal, expensive, cheap, or any equivalent word. We have no market-comparable data; any such characterization is a verdict. State the rent as a literal fact only ("Listed at $4,500/mo").

═══════════════════════════════════════════════════════════════
SECTION RULES
═══════════════════════════════════════════════════════════════

[summary]
- Plain-English ≤120 words.
- Must end with this exact sentence: "Always check the cited records yourself before relying on anything in this summary."
- Mention the registered owner only by literal name.
- If the building is on the Worst Landlord Watchlist, state the rank as a fact (e.g. "Owner ranks #14 on the NYC Public Advocate Worst Landlord Watchlist") — do not editorialize.

[indicators]
- 3–6 entries. Each has key (short label), value (literal count or fact), source_url (one of the URLs provided in the input).
- One indicator per source dataset; combine related items only when they share a source.

[questions_to_ask]
- 3–5 specific, factual questions the renter should ask the broker, landlord, super, or HPD before signing.
- Tie each question to a SPECIFIC number from the records when possible.
- Frame as "Ask…" or "Request…" or "Confirm…" — not as advice.
- Good: "Ask which apartment numbers are affected by the 12 open HPD violations."
- Good: "Request written confirmation that the unit you are viewing has no open lead-paint citations."
- Bad: "Ask if the landlord is responsive." (vague, verdict-adjacent)
- Bad: "Make sure to negotiate the rent." (advice)

[listing_notes]
- Empty array [] when no listing text was provided.
- When provided: 0–5 entries. Each has snippet (verbatim phrase from the listing — do NOT paraphrase) and note (neutral observation, NYC-law verification question, or thing to confirm in writing).
- Snippets MUST appear character-for-character in the listing text. If you cannot find a verbatim snippet to anchor a point, omit the note.
- The "note" should describe what to verify, not whether the listing is trustworthy.
- Good: { "snippet": "no broker fee", "note": "Ask the broker to confirm in writing — the FARE Act prohibits charging tenants a broker fee for a broker the tenant did not hire." }
- Good: { "snippet": "tenant pays utilities", "note": "Ask which specific utilities (gas, electric, water, heat) and request the prior tenant's average monthly bill." }
- Good: { "snippet": "no pets", "note": "NYC's Pet Law (NYC Admin Code §27-2009.1) limits enforcement of no-pet clauses if the landlord has knowingly allowed a pet for 3+ months. Ask the landlord to clarify the policy in writing." }
- Bad: { "snippet": "luxury renovation", "note": "This sounds suspicious." } (verdict)
- Bad: { "snippet": "...", "note": "..." } (snippet not in listing text)

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Output strict JSON only — no prose before or after:
{
  "summary": "<≤120 words ending with the required closing sentence>",
  "indicators": [
    { "key": "<short label>", "value": "<literal count or fact>", "source_url": "<NYC Open Data URL>" }
  ],
  "questions_to_ask": [
    "<question 1>",
    "<question 2>",
    "<question 3>"
  ],
  "listing_notes": [
    { "snippet": "<verbatim phrase from listing>", "note": "<factual observation>" }
  ]
}`;

export type FareFlag = 'no_indicators' | 'possible_violation' | 'unclear';

/**
 * Subset of ScrapedListing relevant for the AI prompt — drops raw HTML and
 * other internal-only fields, keeps the structured listing facts the AI
 * needs to formulate sharp questions.
 */
export type ScrapedListingForPrompt = {
  url: string;
  source: string;
  source_kind: string;
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
  daysOnMarket: number | null;
};

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
  /**
   * User-supplied listing description / copy. When present, the AI generates
   * `listing_notes` against it. Truncated to 4000 chars to bound prompt size.
   */
  listingText?: string | null;
  /**
   * Output of the FARE Act regex pre-check (backend/src/fare/check.ts). Lets
   * the AI cross-reference its listing_notes with the deterministic flag.
   */
  fareFlag?: FareFlag | null;
  /**
   * Phase 4: structured listing data scraped from the URL the user pasted.
   * Lets the AI question concrete numbers (price, lease term, broker fee,
   * amenities) instead of speculating.
   */
  scrapedListing?: ScrapedListingForPrompt | null;
};

const LISTING_TEXT_MAX_CHARS = 4000;

function formatListingFacts(s: ScrapedListingForPrompt): string {
  const lines: string[] = [`Listing facts (scraped from ${s.url}, source: ${s.source}/${s.source_kind}):`];
  if (s.monthlyRentCents != null) {
    const dollars = (s.monthlyRentCents / 100).toLocaleString('en-US');
    lines.push(`- Asking rent: $${dollars}/mo`);
  }
  if (s.bedrooms != null || s.bathrooms != null || s.squareFeet != null) {
    const parts: string[] = [];
    if (s.bedrooms != null) parts.push(s.bedrooms === 0 ? 'studio' : `${s.bedrooms} bed`);
    if (s.bathrooms != null) parts.push(`${s.bathrooms} bath`);
    if (s.squareFeet != null) parts.push(`${s.squareFeet} sqft`);
    lines.push(`- Layout: ${parts.join(' / ')}`);
  }
  if (s.unit) lines.push(`- Unit: ${s.unit}`);
  lines.push(`- Broker fee status: ${s.brokerFeeStated}${s.brokerFeeText ? ` ("${s.brokerFeeText}")` : ''}`);
  if (s.securityDepositText) lines.push(`- Security deposit: ${s.securityDepositText}`);
  if (s.leaseTermMonths != null) lines.push(`- Lease term: ${s.leaseTermMonths} months`);
  if (s.petsPolicy) lines.push(`- Pets: ${s.petsPolicy}`);
  if (s.utilitiesIncluded.length > 0) lines.push(`- Utilities included: ${s.utilitiesIncluded.join(', ')}`);
  if (s.amenities.length > 0) lines.push(`- Amenities: ${s.amenities.join(', ')}`);
  if (s.availabilityDate) lines.push(`- Available: ${s.availabilityDate}`);
  if (s.daysOnMarket != null) lines.push(`- Days on market: ${s.daysOnMarket}`);
  return lines.join('\n');
}

export function buildUserPrompt(p: BuildingPayload): string {
  const listingFactsBlock = p.scrapedListing
    ? `\n\n${formatListingFacts(p.scrapedListing)}`
    : '';

  const listingBlock =
    p.listingText && p.listingText.trim().length > 0
      ? `

Listing copy ${p.scrapedListing ? '(scraped verbatim)' : '(provided by renter)'} — anchor every listing_note's "snippet" inside this block:
"""
${p.listingText.trim().slice(0, LISTING_TEXT_MAX_CHARS)}
"""`
      : `

No listing copy was provided. Output an empty "listing_notes": [].`;

  const fareLine =
    p.fareFlag != null
      ? `\n- Deterministic FARE Act pre-check on the listing copy: ${p.fareFlag}`
      : '';

  return `Building: ${p.address} (${p.borough}, BBL ${p.bbl})

Public records (last 24h cache):
- HPD violations: ${p.hpdViolations.open} open, ${p.hpdViolations.closed} closed
- DOB complaints: ${p.dobComplaints}
- Marshal evictions on file: ${p.evictions}
- Bedbug reports filed: ${p.bedbugReports}
- Lead paint inspection findings: ${p.leadFlags}
- HPD registered owner: ${p.registeredOwner ?? 'not registered'}
- NYC Public Advocate Worst Landlord Watchlist rank: ${p.watchlistRank ?? 'not on list'}${fareLine}${listingFactsBlock}

Source URLs to cite (use these exact URLs in indicator source_url):
- https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- https://data.cityofnewyork.us/City-Government/Marshal-Evictions/6z8x-wfk4
- https://advocate.nyc.gov/landlord-watchlist/${listingBlock}

Generate all four sections per the rules above. Output JSON only. Remember: never characterize the rent as fair/high/low/etc.`;
}
