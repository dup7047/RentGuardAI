import { describe, it, expect } from 'vitest';
import { normalize } from '../../src/geo/normalize.js';

describe('normalize', () => {
  it('uppercases and removes commas', () => {
    expect(normalize('350 5th ave, new york, ny')).toBe('350 5TH AVENUE NEW YORK NY');
  });

  it('expands W and ST abbreviations', () => {
    expect(normalize('123 W 5th St')).toBe('123 WEST 5TH STREET');
  });

  it('expands BLVD', () => {
    expect(normalize('100 Ocean Blvd')).toBe('100 OCEAN BOULEVARD');
  });

  it('collapses multiple spaces', () => {
    expect(normalize('  1  Main   St  ')).toBe('1 MAIN STREET');
  });
});
