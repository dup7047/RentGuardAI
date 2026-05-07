// Address normalization for improved GeoSearch match rates.

const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bAVE\b/g, 'AVENUE'],
  [/\bST\b/g, 'STREET'],
  [/\bBLVD\b/g, 'BOULEVARD'],
  [/\bRD\b/g, 'ROAD'],
  [/\bDR\b/g, 'DRIVE'],
  [/\bPL\b/g, 'PLACE'],
  [/\bPKWY\b/g, 'PARKWAY'],
  [/\bSQ\b/g, 'SQUARE'],
  [/\bN\b/g, 'NORTH'],
  [/\bS\b/g, 'SOUTH'],
  [/\bE\b/g, 'EAST'],
  [/\bW\b/g, 'WEST'],
];

/**
 * Normalize an address string: uppercase, remove commas, expand common abbreviations.
 * Applied before sending to the GeoSearch API to improve hit rate.
 */
export function normalize(input: string): string {
  let s = input.trim().toUpperCase().replace(/[,]/g, '').replace(/\s+/g, ' ');
  for (const [pat, repl] of ABBREVIATIONS) {
    s = s.replace(pat, repl);
  }
  return s;
}
