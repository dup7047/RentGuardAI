import type { Borough } from '../data/types.js';

export type GeocodeResult =
  | { kind: 'matched'; bbl: string; address: string; borough: Borough; confidence: number }
  | { kind: 'ambiguous'; matches: Array<{ bbl: string; address: string; borough: Borough }> }
  | {
      kind: 'outside_nyc';
      detected_city: string | null;
      detected_state: string | null;
      raw_input: string;
    };

export class GeocodeError extends Error {
  constructor(
    public readonly code: 'empty_input' | 'unavailable',
    message: string,
  ) {
    super(message);
    this.name = 'GeocodeError';
  }
}
