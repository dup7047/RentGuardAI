export type ListingParseResult =
  | { kind: 'address_extracted'; address: string; host: 'streeteasy' | 'zillow' | 'apartments' }
  | { kind: 'requires_address'; reason: 'opaque_id' | 'unknown_host' };

export class ListingParseError extends Error {
  constructor(public readonly code: 'invalid_url') {
    super('invalid URL');
    this.name = 'ListingParseError';
  }
}
