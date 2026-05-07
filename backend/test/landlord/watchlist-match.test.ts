import { describe, it, expect } from 'vitest';
import { normalizeOwner, matchByNormalized, type WatchlistRow, type LandlordRow } from '../../src/landlord/watchlist-match.js';

describe('normalizeOwner', () => {
  it('LLC variants compare equal', () => {
    expect(normalizeOwner('Vantage Properties LLC')).toBe(
      normalizeOwner('VANTAGE PROPERTIES, LLC.'),
    );
  });

  it('strips Corp, removes punctuation, uppercases', () => {
    expect(normalizeOwner('Croman, S. Realty Corp')).toBe('CROMAN S REALTY');
  });

  it('strips Inc.', () => {
    expect(normalizeOwner('Acme Inc.')).toBe('ACME');
  });

  it('strips Corporation and Corp both', () => {
    // The regex strips both CORP and CORPORATION word tokens
    expect(normalizeOwner('Big Corp Corporation')).toBe('BIG');
  });

  it('collapses whitespace', () => {
    expect(normalizeOwner('  Big   Landlord   LLC  ')).toBe('BIG LANDLORD');
  });
});

describe('matchByNormalized', () => {
  const watchlist: WatchlistRow[] = [
    { rank: 1, ownerName: 'VANTAGE PROPERTIES LLC' },
    { rank: 2, ownerName: 'Croman, Steven Realty Corp' },
    { rank: 3, ownerName: 'Big Landlord Inc.' },
  ];

  const landlords: LandlordRow[] = [
    { id: 'id-1', registeredOwnerName: 'Vantage Properties, LLC.' },
    { id: 'id-2', registeredOwnerName: 'CROMAN STEVEN REALTY' },
    { id: 'id-3', registeredOwnerName: 'Some Other Owner LLC' },
    { id: 'id-4', registeredOwnerName: 'Another Corp' },
    { id: 'id-5', registeredOwnerName: null },
  ];

  it('returns 2 expected matches from 3 watchlist + 5 landlords', () => {
    const matches = matchByNormalized(watchlist, landlords);
    expect(matches).toHaveLength(2);
    const ids = matches.map((m) => m.landlord_id);
    expect(ids).toContain('id-1');
    expect(ids).toContain('id-2');
  });

  it('returns correct ranks', () => {
    const matches = matchByNormalized(watchlist, landlords);
    const m1 = matches.find((m) => m.landlord_id === 'id-1');
    expect(m1?.rank).toBe(1);
    const m2 = matches.find((m) => m.landlord_id === 'id-2');
    expect(m2?.rank).toBe(2);
  });

  it('empty watchlist → empty result', () => {
    expect(matchByNormalized([], landlords)).toEqual([]);
  });

  it('null registeredOwnerName skipped without throw', () => {
    const result = matchByNormalized(watchlist, [{ id: 'x', registeredOwnerName: null }]);
    expect(result).toEqual([]);
  });
});
