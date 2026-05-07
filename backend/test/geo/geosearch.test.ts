import { describe, it, expect, vi, afterEach } from 'vitest';
import { geosearch } from '../../src/geo/geosearch.js';
import { GeocodeError } from '../../src/geo/types.js';

afterEach(() => vi.restoreAllMocks());

function mockGeo(features: object[]): void {
  vi.spyOn(global, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ features }), { status: 200 }),
  );
}

function makeFeature(bbl: string, conf: number, borough = 'Manhattan'): object {
  return {
    properties: {
      confidence: conf,
      label: `350 5th Ave, ${borough}, New York, NY 10118, USA`,
      borough,
      addendum: { pad: { bbl } },
    },
  };
}

describe('geosearch', () => {
  it('returns matched when single feature with conf >= 0.9', async () => {
    mockGeo([makeFeature('1008440007', 0.95)]);
    const r = await geosearch('350 5th Ave New York NY');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.bbl).toBe('1008440007');
      expect(r.confidence).toBe(0.95);
    }
  });

  it('returns outside_nyc with nulls when 0 features and no state hint', async () => {
    mockGeo([]);
    const r = await geosearch('350 5th Ave NYC');
    expect(r.kind).toBe('outside_nyc');
    if (r.kind === 'outside_nyc') {
      expect(r.detected_state).toBeNull();
    }
  });

  it('detects city and state when address contains non-NYC state', async () => {
    mockGeo([]);
    const r = await geosearch('1600 Pennsylvania Ave Washington DC');
    expect(r.kind).toBe('outside_nyc');
    if (r.kind === 'outside_nyc') {
      expect(r.detected_state).toBe('DC');
    }
  });

  it('returns ambiguous when multiple distinct BBLs', async () => {
    mockGeo([
      makeFeature('1008440007', 0.8),
      makeFeature('2001000001', 0.7),
      makeFeature('3001000001', 0.6),
    ]);
    const r = await geosearch('100 Main St');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.matches.length).toBe(3);
    }
  });

  it('throws GeocodeError unavailable on HTTP error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('bad', { status: 500 }));
    await expect(geosearch('350 5th Ave')).rejects.toBeInstanceOf(GeocodeError);
  });

  it('throws GeocodeError empty_input on blank string', async () => {
    await expect(geosearch('')).rejects.toMatchObject({ code: 'empty_input' });
  });

  it('returns matched even with low confidence when single result', async () => {
    mockGeo([makeFeature('1008440007', 0.7)]);
    const r = await geosearch('350 5th Ave');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.confidence).toBe(0.7);
    }
  });

  it('throws GeocodeError unavailable on fetch timeout', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new DOMException('timeout', 'AbortError'));
    await expect(geosearch('350 5th Ave')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('returns outside_nyc when feature has no BBL', async () => {
    const feat = { properties: { confidence: 0.9, label: 'some address', borough: 'Bronx' } };
    mockGeo([feat]);
    const r = await geosearch('some address');
    expect(r.kind).toBe('outside_nyc');
  });

  it('trims whitespace-only input before checking empty', async () => {
    await expect(geosearch('   ')).rejects.toMatchObject({ code: 'empty_input' });
  });
});
