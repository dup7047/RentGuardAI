import { describe, it, expect } from 'vitest';
import { buildApartmentRisks } from '../../src/routes/apartment-risks.js';
import type { HpdViolation } from '../../src/data/datasets/hpd-violations.js';
import type { Eviction } from '../../src/data/datasets/evictions.js';
import type { LeadPaintViolation } from '../../src/data/datasets/lead-paint.js';

function hpd(overrides: Partial<HpdViolation> = {}): HpdViolation {
  return { violationid: 'V1', bbl: '1000010001', ...overrides };
}

function evic(overrides: Partial<Eviction> = {}): Eviction {
  return { court_index_number: 'E1', ...overrides };
}

function lead(overrides: Partial<LeadPaintViolation> = {}): LeadPaintViolation {
  return { violationid: 'L1', ...overrides };
}

describe('buildApartmentRisks', () => {
  it('returns empty array when all inputs are empty', () => {
    expect(buildApartmentRisks({ hpd: [], evic: [], lead: [] })).toEqual([]);
  });

  it('drops HPD rows with null apartment', () => {
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: undefined }), hpd({ apartment: '3A' })],
      evic: [],
      lead: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.apt).toBe('3A');
  });

  it('drops HPD rows with empty/whitespace-only apartment', () => {
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: '' }), hpd({ apartment: '   ' }), hpd({ apartment: '2B' })],
      evic: [],
      lead: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.apt).toBe('2B');
  });

  it('drops eviction rows with null eviction_apt_num', () => {
    const result = buildApartmentRisks({
      hpd: [],
      evic: [evic({ eviction_apt_num: undefined }), evic({ eviction_apt_num: '1R' })],
      lead: [],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.apt).toBe('1R');
  });

  it('trims whitespace from apartment labels', () => {
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: '  4F  ' })],
      evic: [],
      lead: [],
    });
    expect(result[0]!.apt).toBe('4F');
  });

  it('groups multiple datasets under the same apartment key', () => {
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: '2L', class: 'B', currentstatus: 'Open' })],
      evic: [evic({ eviction_apt_num: '2L', executed_date: '2025-01-01' })],
      lead: [lead({ apartment: '2L', class: 'C', currentstatus: 'Open' })],
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.apt).toBe('2L');
    expect(result[0]!.issues).toHaveLength(3);
    expect(result[0]!.issues.map((i) => i.source).sort()).toEqual(['eviction', 'hpd', 'lead']);
  });

  it('ranks open Class B/C violations above closed Class A', () => {
    const result = buildApartmentRisks({
      hpd: [
        hpd({ apartment: '1A', violationid: 'V1', class: 'A', currentstatus: 'CLOSE' }),
        hpd({
          apartment: '2B',
          violationid: 'V2',
          class: 'B',
          currentstatus: 'Open',
          inspectiondate: '2025-01-01',
        }),
      ],
      evic: [],
      lead: [],
    });
    expect(result[0]!.apt).toBe('2B');
    expect(result[1]!.apt).toBe('1A');
  });

  it('issues within an apartment: open high-class sorts before closed', () => {
    const result = buildApartmentRisks({
      hpd: [
        hpd({ apartment: '3C', violationid: 'V1', class: 'A', currentstatus: 'CLOSE', inspectiondate: '2025-06-01' }),
        hpd({ apartment: '3C', violationid: 'V2', class: 'B', currentstatus: 'Open', inspectiondate: '2024-01-01' }),
        hpd({ apartment: '3C', violationid: 'V3', class: 'C', currentstatus: 'Open', inspectiondate: '2025-01-01' }),
      ],
      evic: [],
      lead: [],
    });
    const apt = result[0]!;
    const firstHighOpen = apt.issues.findIndex(
      (i) => (i.cls === 'B' || i.cls === 'C') && i.status !== 'CLOSE',
    );
    const firstClassA = apt.issues.findIndex((i) => i.cls === 'A');
    expect(firstHighOpen).toBeGreaterThanOrEqual(0);
    expect(firstClassA).toBeGreaterThan(firstHighOpen);
  });

  it('breaks apartment ranking ties by most-recent issue date', () => {
    const result = buildApartmentRisks({
      hpd: [
        hpd({ apartment: 'OldApt', violationid: 'V1', class: 'A', currentstatus: 'CLOSE', inspectiondate: '2020-01-01' }),
        hpd({ apartment: 'NewApt', violationid: 'V2', class: 'A', currentstatus: 'CLOSE', inspectiondate: '2025-06-01' }),
      ],
      evic: [],
      lead: [],
    });
    expect(result[0]!.apt).toBe('NewApt');
  });

  it('enforces max 8 apartments cap', () => {
    const hpdRows = Array.from({ length: 12 }, (_, i) =>
      hpd({ apartment: `Apt${i}`, violationid: `V${i}`, class: 'B', currentstatus: 'Open' }),
    );
    const result = buildApartmentRisks({ hpd: hpdRows, evic: [], lead: [] });
    expect(result).toHaveLength(8);
  });

  it('enforces max 6 issues per apartment', () => {
    const hpdRows = Array.from({ length: 10 }, (_, i) =>
      hpd({ apartment: '5E', violationid: `V${i}`, class: 'B', currentstatus: 'Open' }),
    );
    const result = buildApartmentRisks({ hpd: hpdRows, evic: [], lead: [] });
    expect(result[0]!.issues).toHaveLength(6);
  });

  it('truncates description to 140 characters', () => {
    const longDesc = 'x'.repeat(200);
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: '6F', novdescription: longDesc })],
      evic: [],
      lead: [],
    });
    expect(result[0]!.issues[0]!.description).toHaveLength(140);
  });

  it('accepts undefined description without error', () => {
    const result = buildApartmentRisks({
      hpd: [hpd({ apartment: '7G', novdescription: undefined })],
      evic: [],
      lead: [],
    });
    expect(result[0]!.issues[0]!.description).toBeUndefined();
  });
});
