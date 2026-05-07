// Verifies postLookupStream's NDJSON parser:
//   - Calls onPhase for each phase line as it arrives
//   - Handles multi-line chunks (multiple JSON objects in one read)
//   - Handles lines split across chunk boundaries
//   - Resolves with the response from the complete event
//   - Throws when the stream ends without a complete event

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import { postLookupStream, type LookupPhase } from '@/lib/api/backend';

// Build a Response whose body is a ReadableStream that emits the given
// chunks (as strings) in order, then closes.
function makeStreamingResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]!));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}

const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  // Avoid the supabase auth-header import attempt failing in test.
  // The import inside authHeader is dynamic and will throw on missing env;
  // the function catches and returns {}.
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

describe('postLookupStream', () => {
  it('reports phase events in order and resolves with the response', async () => {
    const chunks = [
      '{"event":"phase","name":"parse"}\n',
      '{"event":"phase","name":"geo"}\n{"event":"phase","name":"hpd"}\n',
      '{"event":"phase","name":"dob"}\n{"event":"phase","name":"owner"}\n{"event":"phase","name":"ai"}\n',
      '{"event":"complete","status":200,"response":{"kind":"success","bbl":"1008240001","address":"350 5th Ave","borough":"Manhattan","listing_summary":null,"summary":"ok","score_explanation":null,"score":95,"score_band":"minimal","score_factors":[],"indicators":[],"questions_to_ask":[],"listing_notes":[],"scraped_listing":null,"landlord":{},"fare_check":null,"stats":{},"lookup_id":null,"building_url":"/building/1008240001"}}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeStreamingResponse(chunks));

    const seen: LookupPhase[] = [];
    const result = await postLookupStream({ address: '350 5th Ave' }, (p) =>
      seen.push(p),
    );

    expect(seen).toEqual(['parse', 'geo', 'hpd', 'dob', 'owner', 'ai']);
    expect(result.kind).toBe('success');
    if (result.kind === 'success') {
      expect(result.bbl).toBe('1008240001');
    }
  });

  it('handles a JSON line split across two chunks', async () => {
    const chunks = [
      '{"event":"phase","na',
      'me":"parse"}\n{"event":"complete","status":200,"response":{"kind":"requires_address","reason":"x"}}\n',
    ];
    globalThis.fetch = vi.fn().mockResolvedValue(makeStreamingResponse(chunks));

    const seen: LookupPhase[] = [];
    const result = await postLookupStream({ listingUrl: 'https://x' }, (p) =>
      seen.push(p),
    );

    expect(seen).toEqual(['parse']);
    expect(result.kind).toBe('requires_address');
  });

  it('throws when the stream ends without a complete event', async () => {
    const chunks = ['{"event":"phase","name":"parse"}\n'];
    globalThis.fetch = vi.fn().mockResolvedValue(makeStreamingResponse(chunks));

    await expect(
      postLookupStream({ address: '350 5th Ave' }, () => {}),
    ).rejects.toThrow(/complete event/i);
  });
});
