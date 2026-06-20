// Static FARE Act explanation copy.
// RentGuard never makes legal determinations — we describe what we found
// and refer users to DCWP for enforcement.

export const FARE_EXPLANATIONS = {
  no_indicators:
    'We did not find broker-fee language in this listing. The FARE Act prohibits charging tenants broker fees for non-tenant-hired brokers. Only DCWP can determine if a specific listing violates the law.',
  possible_violation:
    'We found language suggesting the tenant may pay a broker fee, which DCWP can determine is a FARE Act violation. RentGuard does not make that determination. See the DCWP FARE Act page (https://www.nyc.gov/site/dca/about/FARE-Act.page) to file a complaint.',
  unclear:
    'We could not tell from the listing text whether a broker fee is charged. Ask the broker or landlord directly. RentGuard does not make legal determinations. Only DCWP enforces the FARE Act.',
} as const;
