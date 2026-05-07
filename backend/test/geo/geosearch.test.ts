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

  it('matches venue-layer features (e.g. Empire State Building)', async () => {
    // Regression: well-known buildings come back as layer=venue, not layer=address.
    // The handler must accept any layer as long as a BBL is present.
    const venueFeat = {
      properties: {
        confidence: 0.8,
        label: '350 5 AVENUE, New York, NY, USA',
        borough: 'Manhattan',
        layer: 'venue',
        addendum: { pad: { bbl: '1008350041' } },
      },
    };
    mockGeo([venueFeat]);
    const r = await geosearch('350 5th Ave New York NY');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.bbl).toBe('1008350041');
      expect(r.borough).toBe('MANHATTAN');
    }
  });

  it('short-circuits to outside_nyc on non-NYC state token (no GeoSearch call)', async () => {
    const spy = vi.spyOn(global, 'fetch');
    const r = await geosearch('1600 Amphitheatre Parkway Mountain View CA');
    expect(r.kind).toBe('outside_nyc');
    if (r.kind === 'outside_nyc') {
      expect(r.detected_state).toBe('CA');
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns matched when one BBL dominates duplicates + false positives', async () => {
    // Real-world Pelias response for "350 5th Ave New York NY":
    // 3 features map to the same Manhattan BBL (350, 350A, 350B) and 2 are
    // weaker Brooklyn matches with different BBLs. Dominant BBL wins.
    mockGeo([
      makeFeature('1008350041', 0.8, 'Manhattan'), // 350 5 Ave Manhattan
      makeFeature('3009810111', 0.8, 'Brooklyn'),  // 350 5 Ave Brooklyn (false positive)
      makeFeature('1008350041', 0.8, 'Manhattan'), // 350A 5 Ave (same BBL)
      makeFeature('1008350041', 0.8, 'Manhattan'), // 350B 5 Ave (same BBL)
      makeFeature('3009880011', 0.8, 'Brooklyn'),  // 350 5 St Brooklyn (different street)
    ]);
    const r = await geosearch('350 5th Ave New York NY');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.bbl).toBe('1008350041');
    }
  });

  it('returns ambiguous (deduplicated) on a true tie — equal-count BBLs', async () => {
    mockGeo([
      makeFeature('1008440007', 0.8, 'Manhattan'),
      makeFeature('1008440007', 0.8, 'Manhattan'), // same BBL twice
      makeFeature('3009810111', 0.8, 'Brooklyn'),
      makeFeature('3009810111', 0.8, 'Brooklyn'), // tied 2-2
    ]);
    const r = await geosearch('500 Pine St');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      // dedupe → 2 unique matches, not 4
      expect(r.matches.length).toBe(2);
      const bbls = r.matches.map((m) => m.bbl).sort();
      expect(bbls).toEqual(['1008440007', '3009810111']);
    }
  });

  it('does not request a layers filter (must accept venue + address layers)', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ features: [] }), { status: 200 }),
    );
    await geosearch('350 5th Ave New York NY');
    const calledUrl = (spy.mock.calls[0]?.[0] as URL | string).toString();
    expect(calledUrl).not.toMatch(/layers=/i);
  });
});
