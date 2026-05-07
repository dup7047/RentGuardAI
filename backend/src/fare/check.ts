// FARE Act compliance signal detector.
// Pure function — no DB or network calls.
// Returns a descriptive flag enum and phrase-level evidence, never a legal verdict.

import { FARE_EXPLANATIONS } from './copy.js';

export type FareFlag = 'no_indicators' | 'possible_violation' | 'unclear';

export type FareIndicator = {
  phrase: string;
  offset: number;
  kind: 'strong' | 'counter' | 'ambiguous';
};

export type FareCheckResult = {
  flag: FareFlag;
  indicators: FareIndicator[];
  explanation: string;
};

// Strong signals: tenant is expected to pay broker fee
const STRONG: RegExp[] = [
  /tenant\s+pays?\s+broker['']?s?\s+fee/i,
  /broker(?:'s)?\s+fee\s+(?:paid|charged)\s+by\s+tenant/i,
  /applicant\s+covers\s+broker/i,
  /broker[\s,]{0,20}commission/i,
];

// Counter signals: broker fee is not charged to tenant
const COUNTER: RegExp[] = [
  /no\s+broker(?:'s)?\s+fee/i,
  /broker(?:'s)?\s+fee\s+paid\s+by\s+(?:landlord|owner)/i,
  /no[\s-]+fee/i,
];

// Ambiguous signals: could go either way
const AMBIGUOUS: RegExp[] = [/fees?\s+apply/i, /fees?\s+may\s+apply/i];

/**
 * Scan listing text for FARE Act indicators.
 * @param input  Object with optional listingText string
 * @returns      FareCheckResult with flag, indicators, and explanation
 */
export function checkFare(input: { listingText?: string }): FareCheckResult {
  const text = (input.listingText ?? '').trim();
  if (!text) {
    return {
      flag: 'unclear',
      indicators: [],
      explanation: FARE_EXPLANATIONS.unclear,
    };
  }

  const indicators: FareIndicator[] = [];

  for (const re of STRONG) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'strong' });
  }
  for (const re of COUNTER) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'counter' });
  }
  for (const re of AMBIGUOUS) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'ambiguous' });
  }

  const strongCount = indicators.filter((i) => i.kind === 'strong').length;
  const counterCount = indicators.filter((i) => i.kind === 'counter').length;

  let flag: FareFlag;
  if (strongCount > 0 && counterCount === 0) {
    flag = 'possible_violation';
  } else if (strongCount === 0 && counterCount > 0) {
    flag = 'no_indicators';
  } else {
    flag = 'unclear';
  }

  return { flag, indicators, explanation: FARE_EXPLANATIONS[flag] };
}
