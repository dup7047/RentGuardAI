import { describe, it, expect } from 'vitest';
import { checkFare } from '../../src/fare/check.js';

describe('checkFare', () => {
  it('returns possible_violation for "tenant pays broker fee"', () => {
    const r = checkFare({ listingText: 'Tenant pays broker fee.' });
    expect(r.flag).toBe('possible_violation');
    expect(r.indicators.some((i) => i.kind === 'strong')).toBe(true);
  });

  it('returns possible_violation for "broker fee charged by tenant"', () => {
    const r = checkFare({ listingText: 'Broker fee charged by tenant.' });
    expect(r.flag).toBe('possible_violation');
  });

  it('returns no_indicators when "no broker fee" present and no strong signals', () => {
    const r = checkFare({ listingText: 'Great apartment — no broker fee!' });
    expect(r.flag).toBe('no_indicators');
    expect(r.indicators.some((i) => i.kind === 'counter')).toBe(true);
  });

  it('returns no_indicators when "broker fee paid by owner"', () => {
    const r = checkFare({ listingText: 'Broker fee paid by owner. Move in ready.' });
    expect(r.flag).toBe('no_indicators');
  });

  it('returns unclear when no relevant text found', () => {
    const r = checkFare({ listingText: 'Beautiful 2BR in Manhattan with great views.' });
    expect(r.flag).toBe('unclear');
    expect(r.indicators).toHaveLength(0);
  });

  it('returns unclear when strong and counter both present', () => {
    const r = checkFare({
      listingText: 'Tenant pays broker commission. No broker fee for qualified applicants.',
    });
    expect(r.flag).toBe('unclear');
  });

  it('returns unclear when listingText is empty string', () => {
    const r = checkFare({ listingText: '' });
    expect(r.flag).toBe('unclear');
  });

  it('returns unclear when listingText is undefined', () => {
    const r = checkFare({});
    expect(r.flag).toBe('unclear');
  });

  it('explanation is non-empty for all flag values', () => {
    const cases = [
      checkFare({ listingText: 'Tenant pays broker fee' }),
      checkFare({ listingText: 'No fee apartment' }),
      checkFare({ listingText: 'Fees may apply' }),
    ];
    for (const r of cases) {
      expect(r.explanation.length).toBeGreaterThan(0);
    }
  });

  it('detects broker commission as strong signal', () => {
    const r = checkFare({ listingText: 'Renter responsible for broker commission.' });
    expect(r.flag).toBe('possible_violation');
  });
});
