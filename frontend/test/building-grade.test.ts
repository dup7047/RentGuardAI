import { describe, expect, it } from 'vitest';

import { computeBuildingGrade } from '@/lib/building-grade';

describe('computeBuildingGrade', () => {
  it('returns A for 0', () => expect(computeBuildingGrade(0)).toBe('A'));
  it('returns A for 4', () => expect(computeBuildingGrade(4)).toBe('A'));
  it('returns B for 5', () => expect(computeBuildingGrade(5)).toBe('B'));
  it('returns B for 19', () => expect(computeBuildingGrade(19)).toBe('B'));
  it('returns C for 20', () => expect(computeBuildingGrade(20)).toBe('C'));
  it('returns C for 49', () => expect(computeBuildingGrade(49)).toBe('C'));
  it('returns D for 50', () => expect(computeBuildingGrade(50)).toBe('D'));
  it('returns D for 99', () => expect(computeBuildingGrade(99)).toBe('D'));
  it('returns F for 100', () => expect(computeBuildingGrade(100)).toBe('F'));
  it('returns F for 1000', () => expect(computeBuildingGrade(1000)).toBe('F'));
  it('throws for -1', () => {
    expect(() => computeBuildingGrade(-1)).toThrow(
      'openViolations cannot be negative',
    );
  });
});
