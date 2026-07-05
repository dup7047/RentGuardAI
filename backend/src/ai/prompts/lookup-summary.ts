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
//   listing_summary    — 2-3 sentence narrative of what the listing offers
//   summary            — ≤220-word renter-facing risk briefing: 1-2 sentence pattern lede,
//                         then "At-risk apartments:" + 2-5 unit bullets, optional watchlist
//                         sentence, closing disclaimer. Newlines and "- " bullets are
//                         literal — frontend renders with white-space: pre-line.
//   score_explanation  — 1-3 sentences narrating the deterministic score
//   indicators         — 3-6 cited counts with source_url
//   questions_to_ask   — 3-5 concrete factual questions tied to the records
//   listing_notes      — neutral observations on listing copy (only when provided)
//
// A deterministic 0-100 score is computed in code (NOT by the AI)
// and handed to the AI as input. The AI's job is to NARRATE the score in
// `score_explanation` referencing the top factors — not to invent its own.
// The score itself is the recommendation; the AI just explains the math.
//
// Price commentary is BANNED for free-form opinions (no market data) EXCEPT
// in value_explanation, which is only generated when the deterministic value
// score block is present. That section may narrate comp data handed in — it
// cannot invent comparisons. score_explanation still covers record counts only.

export const SYSTEM_PROMPT = `You are RentGuard, an information assistant for NYC renters.

Generate seven sections from the public records, (when provided) the listing copy, the deterministic risk score, and (when provided) the deterministic value score handed to you. Keep all output strictly factual. RentGuard is not a law firm and does not make legal determinations.

═══════════════════════════════════════════════════════════════
GLOBAL RULES (apply to every section)
═══════════════════════════════════════════════════════════════
• Cite literal counts. Say "47 open HPD violations", never "many violations".
• Never invent data. Only cite numbers/owners that appear in the input.
• NEVER use slur-style verdict words: scam, slumlord, sketchy, predatory, terrible, beware. (Factual descriptors of risk such as "elevated concern" or "high concern" are fine — they reference the score, which is a deterministic computation.)
• PRICE COMMENTARY BAN: do NOT characterize rent as fair, high, low, above market, below market, overpriced, a deal, expensive, or cheap UNLESS a value_score block was given to you. If it was given, you may ONLY narrate the comp data in that block — you cannot invent comparisons or add your own editorial. State the rent as a literal fact everywhere else ("Listed at $4,500/mo").
• SCORE INTEGRITY: scores are computed deterministically in code. You are TOLD the scores, you do NOT pick them. Do NOT invent factors. Do NOT contradict the scores in your prose.

═══════════════════════════════════════════════════════════════
SECTION RULES
═══════════════════════════════════════════════════════════════

[listing_summary]
- 2-3 sentences in plain English describing what the user is being offered.
- Start with the layout + neighborhood when possible (e.g. "This is a 2-bedroom rental in Gramercy listed at $5,825/mo with no broker fee, available June 1.").
- Include rent (as fact), broker-fee status (as fact), lease term, included utilities, key amenities. Skip fields that weren't scraped.
- If no listing was provided OR the listing data is empty (address-only lookup, or scraper-blocked URL with only an address recovered), leave this field as an empty string ""; the frontend renders its own notice in that case. Do NOT generate placeholder text like "No listing was provided".
- DO NOT comment on whether the rent is fair / high / low. State it.

[summary]
- A renter-facing risk briefing in plain English, ≤220 words total. Structure is fixed:

  PART 1 — Building-wide pattern lede (1-2 sentences):
    Name the THEMES recurring across HPD violations, HPD complaints, DOB complaints, and 311 housing complaints — water leaks, mold/dampness, heat/hot water, plaster damage, fire safety, gas, smoke/CO detectors, egress, vermin. Note when issues appear to cluster by unit. Use hedged language ("suggests", "appears", "should be verified") — do not overstate certainty.

  PART 2 — Blank line, then the literal label "At-risk apartments:" on its own line.

  PART 3 — A bulleted list of 2-5 apartments that recur across the records. Each bullet is on its own line, prefixed with "- Apt. <unit>:" exactly. Most concerning apartment first. For each bullet, cite the most recent / most severe records driving the call (recent open HPD violations, Class B/C citations, recent HPD complaints, safety-related categories). Pull verbatim phrases from the violation descriptions when they sharpen the picture (e.g. "WATER LEAK SOURCE", "DAMAGED PLASTER PAINT").

  PART 4 — If watchlist rank is non-null, append exactly one sentence after the bullet list naming the registered owner and the rank as a fact (e.g. "The registered owner, ACME LLC, is ranked #42 on the NYC Public Advocate's Worst Landlord Watchlist this year."). Skip this sentence entirely when the rank is null — do NOT write "not on the watchlist" filler.

  PART 5 — Closing sentence (verbatim, on its own line): "Always check the cited records yourself before relying on anything in this summary."

- If no apartment recurs across records (or every record's apartment field is empty), the bullet list MUST be exactly:
  - No specific units recurred across recent records.
  Do not fabricate apartment numbers.
- Prioritize: open over closed; Class B/C over Class A; safety categories (heat/hot water, gas, fire egress, smoke/CO, lead paint) over cosmetic ones; recent dates over old.
- Cite literal counts where the lede mentions one ("12 open HPD violations" — not "many violations"). Do not invent thresholds the records don't support and do not use slur-style verdicts (slumlord, predatory, sketchy, beware).
- Mention the registered owner only by literal name.

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

[value_explanation]
- If NO value_score block was given to you: output an empty string "".
- If a value_score block WAS given: write 2-3 sentences explaining the value score using ONLY the comp data handed to you. Do not add editorial opinion beyond what the numbers say.
- The first sentence MUST state the band ("Great deal", "Fair market rate", "Above market", or "Overpriced") and the score (e.g. "This listing scores 84/100 for value — a great deal.").
- Reference the specific comp median and percentage difference from the value_factors[] you were given.
- Good: "This listing scores 84/100 for value — a great deal. At $2,800/mo, it sits 22% below the Brooklyn median of $3,600/mo for 2BR apartments (n=34 recent listings). The $/sqft figure of $4.20 also comes in below the local median of $5.10/sqft."
- Good: "This listing scores 45/100 for value — above market. At $5,200/mo, it is 18% above the Manhattan median of $4,420/mo for 2BR apartments (HUD/Census baseline)."
- Bad: "This seems overpriced for the neighborhood." (invented editorial)
- Bad: "Great deal — you should grab this!" (advice)

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════════════

Output strict JSON only — no prose before or after:
{
  "listing_summary": "<2-3 sentences on what the listing offers>",
  "summary": "<≤220 words: pattern lede + blank line + 'At-risk apartments:' + 2-5 '- Apt. X: ...' bullets + optional watchlist sentence + closing disclaimer; literal newlines preserved>",
  "score_explanation": "<1-3 sentences narrating the score with band + top factors>",
  "value_explanation": "<2-3 sentences narrating the value score from comp data, or empty string if no value_score block was given>",
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

import { valueBandLabel, type ValueScoreResult } from '../../scoring/value.js';

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
   * Structured listing data scraped from the URL the user pasted.
   * Lets the AI question concrete numbers (price, lease term, broker fee,
   * amenities) instead of speculating.
   */
  scrapedListing?: ScrapedListingForPrompt | null;
  /**
   * Deterministic score (0-100) computed in src/scoring/score.ts.
   * The AI does NOT pick this — it's handed in. The AI's score_explanation
   * narrates these factors but cannot contradict the score.
   */
  score?: {
    score: number;
    band: 'minimal' | 'moderate' | 'elevated' | 'high';
    factors: Array<{ key: string; label: string; impact: number; reason: string }>;
  } | null;
  /**
   * Record-level context for the at-risk-apartments callouts. Each array is
   * pre-sorted (most recent first) and capped by the orchestrator before
   * landing here. Optional so legacy callers keep working — the prompt
   * handles missing arrays as "no record-level data available".
   */
  recentHpdViolations?: Array<{
    apartment: string | null;
    class: string | null;
    issuedDate: string | null;
    description: string | null;
    status: 'open' | 'closed';
  }>;
  recentHpdComplaints?: Array<{
    apartment: string | null;
    receivedDate: string | null;
    status: string | null;
  }>;
  recentDobComplaints?: Array<{
    date: string | null;
    category: string | null;
    status: string | null;
  }>;
  recent311Complaints?: Array<{
    date: string | null;
    type: string | null;
    descriptor: string | null;
    status: string | null;
  }>;
  /**
   * Apartment Value Score — deterministic 0-100 from src/scoring/value.ts.
   * Only present for rental URL lookups with rent + beds. Null = no listing data.
   * The AI narrates this in value_explanation using ONLY the comp data here.
   */
  valueScore?: ValueScoreResult | null;
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

const DESCRIPTION_MAX_CHARS = 90;

function shortDate(d: string | null | undefined): string {
  if (!d) return '?';
  // Socrata floating_timestamp comes through as e.g. "2026-04-27T00:00:00.000".
  return d.slice(0, 10);
}

function clip(s: string | null | undefined, n = DESCRIPTION_MAX_CHARS): string {
  if (!s) return '';
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function formatHpdViolationLines(
  rows: NonNullable<BuildingPayload['recentHpdViolations']>,
): string {
  if (rows.length === 0) return 'Recent HPD violations (apartment-level): none';
  const lines = [`Recent HPD violations (apartment-level), most recent first:`];
  for (const r of rows) {
    const apt = r.apartment ? `Apt ${r.apartment}` : 'no-unit';
    const cls = r.class ? `Class ${r.class}` : 'class ?';
    lines.push(
      `- ${apt} · ${cls} · ${shortDate(r.issuedDate)} · ${r.status.toUpperCase()} · ${clip(r.description)}`,
    );
  }
  return lines.join('\n');
}

function formatHpdComplaintLines(
  rows: NonNullable<BuildingPayload['recentHpdComplaints']>,
): string {
  if (rows.length === 0) return 'Recent HPD complaints (apartment-level): none';
  const lines = [`Recent HPD complaints (apartment-level), most recent first:`];
  for (const r of rows) {
    const apt = r.apartment ? `Apt ${r.apartment}` : 'no-unit';
    const status = r.status ? r.status.toUpperCase() : 'STATUS ?';
    lines.push(`- ${apt} · ${shortDate(r.receivedDate)} · ${status}`);
  }
  return lines.join('\n');
}

function formatDobComplaintLines(
  rows: NonNullable<BuildingPayload['recentDobComplaints']>,
): string {
  if (rows.length === 0) return 'Recent DOB complaints: none';
  const lines = [`Recent DOB complaints (building-level), most recent first:`];
  for (const r of rows) {
    const status = r.status ? r.status.toUpperCase() : 'STATUS ?';
    lines.push(`- ${shortDate(r.date)} · ${status} · ${clip(r.category)}`);
  }
  return lines.join('\n');
}

function format311ComplaintLines(
  rows: NonNullable<BuildingPayload['recent311Complaints']>,
): string {
  if (rows.length === 0) return 'Recent 311 housing complaints: none';
  const lines = [`Recent 311 housing complaints (building-level), most recent first:`];
  for (const r of rows) {
    const status = r.status ? r.status.toUpperCase() : 'STATUS ?';
    const what = clip([r.type, r.descriptor].filter(Boolean).join(' / '));
    lines.push(`- ${shortDate(r.date)} · ${status} · ${what}`);
  }
  return lines.join('\n');
}

function formatValue(v: ValueScoreResult): string {
  const lines: string[] = [
    `Apartment Value Score (DETERMINISTIC — computed from rent comp data; do not change it):`,
    `- Score: ${v.score}/100`,
    `- Band: ${valueBandLabel(v.band)} (use this exact band in value_explanation)`,
    `- Confidence: ${v.confidence}`,
    `- Comp source: ${v.comp.source}${v.comp.sampleSize > 0 ? ` (n=${v.comp.sampleSize})` : ''}`,
    `- Borough median for ${v.comp.bedrooms === 0 ? 'studios' : `${v.comp.bedrooms}BR`} in ${v.comp.borough}: $${Math.round(v.comp.medianRentCents / 100).toLocaleString()}/mo`,
  ];
  if (v.comp.medianRentPerSqftCents != null) {
    lines.push(`- Borough median $/sqft: $${(v.comp.medianRentPerSqftCents / 100).toFixed(2)}/sqft`);
  }
  lines.push(`- Top value factors (sorted by impact):`);
  for (const f of v.factors.slice(0, 3)) {
    const sign = f.impact === 0 ? '·' : f.impact > 0 ? '+' : '−';
    lines.push(`  ${sign} ${Math.abs(f.impact)}: ${f.reason}`);
  }
  return lines.join('\n');
}

export function buildUserPrompt(p: BuildingPayload): string {
  const listingFactsBlock = p.scrapedListing
    ? `\n\n${formatListingFacts(p.scrapedListing)}`
    : '';
  const scoreBlock = p.score ? `\n\n${formatScore(p.score)}` : '';
  const valueBlock = p.valueScore ? `\n\n${formatValue(p.valueScore)}` : '';

  const recordsBlock = [
    p.recentHpdViolations ? formatHpdViolationLines(p.recentHpdViolations) : null,
    p.recentHpdComplaints ? formatHpdComplaintLines(p.recentHpdComplaints) : null,
    p.recentDobComplaints ? formatDobComplaintLines(p.recentDobComplaints) : null,
    p.recent311Complaints ? format311ComplaintLines(p.recent311Complaints) : null,
  ]
    .filter((s): s is string => s != null)
    .join('\n\n');
  const recordsSection = recordsBlock ? `\n\n${recordsBlock}` : '';

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
- NYC Public Advocate Worst Landlord Watchlist rank: ${p.watchlistRank ?? 'not on list'}${fareLine}${recordsSection}${listingFactsBlock}${scoreBlock}${valueBlock}

Source URLs to cite (use these exact URLs in indicator source_url):
- https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- https://data.cityofnewyork.us/City-Government/Marshal-Evictions/6z8x-wfk4
- https://advocate.nyc.gov/landlord-watchlist/${listingBlock}

Generate all seven sections per the rules above. Output JSON only. Remember: only characterize rent in value_explanation, and only using the comp data given to you.`;
}
