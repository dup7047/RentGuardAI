// Shared types for the NYC Open Data layer.

export type Borough = 'MANHATTAN' | 'BRONX' | 'BROOKLYN' | 'QUEENS' | 'STATEN ISLAND';

export type DatasetKey =
  | 'hpd_violations'
  | 'hpd_registrations'
  | 'hpd_contacts'
  | 'dob_complaints'
  | 'three11_housing'
  | 'evictions'
  | 'bedbug'
  | 'lead_paint';

/** Shape of `buildings.raw_data` JSONB. Each dataset key maps to a raw row array;
 *  `_meta` holds ISO-8601 timestamps of when each dataset was last fetched. */
export type CachedData = Partial<Record<DatasetKey, unknown[]>> & {
  _meta?: Partial<Record<`${DatasetKey}_fetched_at`, string>>;
};
