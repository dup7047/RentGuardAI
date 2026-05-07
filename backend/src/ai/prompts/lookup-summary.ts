// System prompt + user prompt builder for the building lookup summary.
// gpt-4o-mini, JSON mode. No legal determinations — describe facts only.
//
// PROMPT CACHING INVARIANT: SYSTEM_PROMPT below MUST stay static and contain
// zero per-request data. OpenAI auto-caches stable prompt prefixes ≥1024
// tokens; this prompt is ~1200 tokens and lives in the first message slot,
// so as long as the system content never changes per call, every lookup
// after the first hits the input-token cache (50% discount, ~80% TTFB win).
// Dynamic data — BBL, address, dataset stats, score — belongs ONLY in the
// user prompt built by buildUserPrompt below.
//
// Output shape (validated in summary.ts):
//   listing_summary    — 2-3 sentence narrative of what the listing offers (Phase 4.5)
//   summary            — ≤180-word factual summary of building records, with explicit
//                         per-dataset coverage of HPD violations, DOB complaints, marshal
//                         evictions, and Worst Landlord Watchlist rank in plain English
//   score_explanation  — 1-3 sentences narrating the deterministic score (Phase 4.5)
//   indicators         — 3-6 cited counts with source_url
//   questions_to_ask   — 3-5 concrete factual questions tied to the records
//   listing_notes      — neutral observations on listing copy (only when provided)
//
// Phase 4.5: a deterministic 0-100 score is computed in code (NOT by the AI)
// and handed to the AI as input. The AI's job is to NARRATE the score in
// `score_explanation` referencing the top factors — not to invent its own.
// The score itself is the recommendation; the AI just explains the math.
//
// Price commentary remains banned (no market-comparable data). The
// score_explanation cannot characterize price either — it explains record
// counts only.

export const SYSTEM_PROMPT = `You are RentGuard, an information assistant for NYC renters.

Generate six sections from the public records, (when provided) the listing copy, and the deterministic risk score handed to you. Keep all output strictly factual. RentGuard is not a law firm and does not make legal determinations.

═══════════════════════════════════════════════════════════════
GLOBAL RULES (apply to every section)
═══════════════════════════════════════════════════════════════
• Cite literal counts. Say "47 open HPD violations", never "many violations".
• Never invent data. Only cite numbers/owners that appear in the input.
• NEVER use slur-style verdict words: scam, slumlord, sketchy, predatory, terrible, beware. (Factual descriptors of risk such as "elevated concern" or "high concern" are fine — they reference the score, which is a deterministic computation.)
• PRICE COMMENTARY BAN: do NOT characterize the asking rent as fair, high, low, above market, below market, overpriced, a deal, expensive, cheap, or any equivalent word. We have no market-comparable data; any such characterization is a verdict. State the rent as a literal fact only ("Listed at $4,500/mo").
• SCORE INTEGRITY: the score is computed deterministically in code. You are TOLD the score, you do NOT pick it. Do NOT invent factors that aren't in the score_factors[] given to you. Do NOT contradict the score in your prose.

═══════════════════════════════════════════════════════════════
SECTION RULES
═══════════════════════════════════════════════════════════════

[listing_summary]
- 2-3 sentences in plain English describing what the user is being offered.
- Start with the layout + neighborhood when possible (e.g. "This is a 2-bedroom rental in Gramercy listed at $5,825/mo with no broker fee, available June 1.").
- Include rent (as fact), broker-fee status (as fact), lease term, included utilities, key amenities. Skip fields that weren't scraped.
- If no listing was provided (address-only lookup), output a single sentence: "No listing was provided — this review covers the building's public records only."
- DO NOT comment on whether the rent is fair / high / low. State it.

[summary]
- Plain-English ≤180 words covering the BUILDING records. The renter is reading this to understand what's in the public record for this building, so SUMMARIZE THE RESULTS for each dataset — do not just rattle off raw counts. Tell them what each data source is and what this building's count means in plain language.
- MUST explicitly cover ALL FOUR of these datasets, in order, even when the count is zero:
  1. HPD violations — the city's housing-maintenance code citations (heat/hot-water failures, leaks, mold, vermin, lead paint, peeling paint, broken windows, etc.). Cite both the OPEN and CLOSED counts and briefly characterize what the open count represents (0 open means no active code violations; dozens of open violations means unresolved maintenance issues the landlord has not corrected).
  2. DOB complaints — Department of Buildings complaints filed in the last 12 months (illegal construction, unsafe conditions, work without a permit). Cite the count and briefly say what level of recent construction/safety activity it represents (0 means no recent DOB activity; a high count means the building has drawn repeated DOB attention).
  3. Marshal evictions — executed residential evictions logged at this BBL by city marshals. Cite the count and briefly note what the count signals about the landlord's enforcement history (0 is the norm for stable buildings; multiple executed evictions is uncommon).
  4. NYC Public Advocate Worst Landlord Watchlist rank — an annual ranking of the city's worst-rated landlords (rank 1 is the worst, ~100 landlords are listed each year). If the registered owner is on the list, STATE THE RANK as a fact and explain that being ranked means the Public Advocate has flagged this owner as one of the city's worst-rated landlords for the year. If not on the list, say so explicitly ("the registered owner is not on the current Worst Landlord Watchlist").
- Mention the registered owner only by literal name.
- Stay factual — describe what the counts represent and what they signal in plain English, but do NOT invent thresholds the records don't support and do NOT use slur-style verdicts (slumlord, predatory, etc.).
- Must end with this exact sentence: "Always check the cited records yourself before relying on anything in this summary."

[score_explanation]
- 1-3 sentences narrating the score handed to you.
- Reference the 2-3 most-impactful factors from score_factors[] by their reason field.
- The first sentence MUST state the band ("Minimal concern", "Moderate concern", "Elevated concern", or "High concern" — pick the band you were given) and the score (e.g. "This building scores 73/100 — moderate concern.").
- Do NOT invent factors. Do NOT downplay or amplify the score.
- Good: "This building scores 53/100 — elevated concern, driven by 12 open HPD violations and 8 bedbug reports filed."
- Good: "Minimal concern — this building scores 96/100 with no open violations or evictions on file."
- Bad: "This building looks pretty good!" (verdict, doesn't cite score)
- Bad: "Score 73 but actually it's fine because…" (contradicts the score)

[indicators]
- 3–6 entries. Each has key (short label), value (literal count or fact), source_url (one of the URLs provided in the input).
- One indicator per source dataset; combine related items only when they share a source.

[questions_to_ask]
- 3–5 specific, factual questions the renter should ask the broker, landlord, super, or HPD before signing.
- Tie each question to a SPECIFIC number from the records when possible.
- Frame as "Ask…" or "Request…" or "Confirm…" — not as advice.
- Good: "Ask which apartment numbers are affected by the 12 open HPD violations."
- Bad: "Make sure to negotiate the rent." (advice)

[listing_notes]
- Empty array [] when no listing text was provided.
- When provided: 0–5 entries. Each has snippet (verbatim phrase from the listing — do NOT paraphrase) and note (neutral observation, NYC-law verification question, or thing to confirm in writing).
- Snippets MUST appear character-for-character in the listing text. If you cannot find a verbatim snippet to anchor a point, omit the note.
- The "note" should describe what to verify, not whether the listing is trustworthy.
- Good: { "snippet": "no broker fee", "note": "Ask the broker to confirm in writing — the FARE Act prohibits charging tenants a broker fee for a broker the tenant did not hire." }
- Good: { "snippet": "no pets", "note": "NYC's Pet Law (NYC Admin Code §27-2009.1) limits enforcement of no-pet clauses if the landlord has knowingly allowed a pet for 3+ months." }
- Bad: { "snippet": "luxury renovation", "note": "This sounds suspicious." } (verdict)

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Output strict JSON only — no prose before or after:
{
  "listing_summary": "<2-3 sentences on what the listing offers>",
  "summary": "<≤180 words covering HPD violations, DOB complaints, marshal evictions, and Worst Landlord Watchlist rank in plain English, ending with the required closing sentence>",
  "score_explanation": "<1-3 sentences narrating the score with band + top factors>",
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
  /**
   * Phase 4.5: deterministic score (0-100) computed in src/scoring/score.ts.
   * The AI does NOT pick this — it's handed in. The AI's score_explanation
   * narrates these factors but cannot contradict the score.
   */
  score?: {
    score: number;
    band: 'minimal' | 'moderate' | 'elevated' | 'high';
    factors: Array<{ key: string; label: string; impact: number; reason: string }>;
  } | null;
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

function formatScore(s: NonNullable<BuildingPayload['score']>): string {
  const lines: string[] = [
    `Risk score (DETERMINISTIC — computed from the records above; do not change it):`,
    `- Score: ${s.score}/100`,
    `- Band: ${s.band} (use this exact band in score_explanation)`,
    `- Top factors (sorted by impact):`,
  ];
  for (const f of s.factors.slice(0, 6)) {
    const sign = f.impact === 0 ? '·' : f.impact < 0 ? '−' : '+';
    lines.push(`  ${sign} ${f.impact === 0 ? '0' : Math.abs(f.impact)}: ${f.reason}`);
  }
  return lines.join('\n');
}

export function buildUserPrompt(p: BuildingPayload): string {
  const listingFactsBlock = p.scrapedListing
    ? `\n\n${formatListingFacts(p.scrapedListing)}`
    : '';
  const scoreBlock = p.score ? `\n\n${formatScore(p.score)}` : '';

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
- NYC Public Advocate Worst Landlord Watchlist rank: ${p.watchlistRank ?? 'not on list'}${fareLine}${listingFactsBlock}${scoreBlock}

Source URLs to cite (use these exact URLs in indicator source_url):
- https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- https://data.cityofnewyork.us/City-Government/Marshal-Evictions/6z8x-wfk4
- https://advocate.nyc.gov/landlord-watchlist/${listingBlock}

Generate all four sections per the rules above. Output JSON only. Remember: never characterize the rent as fair/high/low/etc.`;
}
