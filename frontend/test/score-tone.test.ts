// Verifies the band → tone mapping that the design depends on. The prototype
// CSS only defines `.pill.good`, `.pill.warn`, `.pill.bad`; we must collapse
// the backend's 4 bands onto these 3 classes.

import { describe, expect, it } from 'vitest';

import { getReportTone, getBandLabel } from '@/lib/api/backend';

describe('getReportTone', () => {
  it('maps minimal to good', () => {
    expect(getReportTone('minimal')).toBe('good');
  });

  it('maps moderate and elevated to warn', () => {
    expect(getReportTone('moderate')).toBe('warn');
    expect(getReportTone('elevated')).toBe('warn');
  });

  it('maps high to bad', () => {
    expect(getReportTone('high')).toBe('bad');
  });

  it('maps null/undefined to warn (safe default)', () => {
    expect(getReportTone(null)).toBe('warn');
    expect(getReportTone(undefined)).toBe('warn');
  });
});

describe('getBandLabel', () => {
  it('returns human-readable copy for each band', () => {
    expect(getBandLabel('minimal')).toBe('Minimal concern');
    expect(getBandLabel('moderate')).toBe('Moderate concern');
    expect(getBandLabel('elevated')).toBe('Elevated concern');
    expect(getBandLabel('high')).toBe('High concern');
  });

  it('falls back gracefully when band is missing', () => {
    expect(getBandLabel(null)).toBe('Score unavailable');
    expect(getBandLabel(undefined)).toBe('Score unavailable');
  });
});
