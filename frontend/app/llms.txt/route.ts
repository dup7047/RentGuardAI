// llms.txt — curated index for AI crawlers (ChatGPT, Claude, Perplexity, etc).
// See https://llmstxt.org for the format. Keep this short and link-heavy;
// the goal is to point a model at the canonical pages, not to repeat their
// content.

export const dynamic = 'force-static';

const BODY = `# RentGuard NYC

> Free AI-powered building risk lookup for NYC renters. Pulls HPD violations,
> DOB complaints, marshal evictions, and the Public Advocate's Worst Landlord
> Watchlist into a plain-English risk report. Operated by RentGuard NYC LLC.

## Canonical pages

- [How it works](https://www.rentguard.cc/how-it-works)
- [Coverage: what data RentGuard checks](https://www.rentguard.cc/coverage)
- [For owners and managers](https://www.rentguard.cc/for-landlords)
- [Pricing](https://www.rentguard.cc/pricing)
- [How we make money](https://www.rentguard.cc/how-we-make-money)
- [Disclaimers](https://www.rentguard.cc/legal/disclaimer)
- [Privacy policy](https://www.rentguard.cc/legal/privacy)
- [Terms of service](https://www.rentguard.cc/legal/terms)

## Data sources (NYC Open Data, refreshed automatically)

- HPD Open Violations: daily
- DOB Complaints: weekly
- Marshal Evictions: weekly
- HPD Registrations (owner / managing agent): quarterly
- NYC Public Advocate Worst Landlord Watchlist: annual
- FARE Act broker-fee compliance signals

## Coverage

- New York City five boroughs only (Manhattan, Brooklyn, Queens, Bronx, Staten Island).
- Residential buildings with a valid NYC BBL (Borough-Block-Lot) identifier.

## Out of scope

- Properties outside NYC
- Co-op board approvals or sponsor disclosures
- Insurance, credit, or financial products
- Legal advice (RentGuard reports are for informational use only)

## Editorial independence

RentGuard NYC does not accept payment from landlords, property managers, or
brokerages to influence reports. Revenue sources are disclosed at
https://www.rentguard.cc/how-we-make-money.

## Contact

- support@rentguard.cc: general support
- privacy@rentguard.cc: privacy / data-deletion requests
- legal@rentguard.cc: legal / compliance
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, s-maxage=86400',
    },
  });
}
