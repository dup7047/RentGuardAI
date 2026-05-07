// Canonical registry of NYC Open Data Socrata endpoints.
// This is the single source of truth consumed by:
//   - scripts/verify-data-sources.ts (Phase 0.3 verifier)
//   - src/data/datasets/* (Phase 3 typed dataset wrappers)

import type { DatasetKey } from './types.js';

export type DatasetEndpoint = {
  /** DatasetKey used as the cache key in buildings.raw_data */
  key: DatasetKey;
  /** Human label for log output */
  label: string;
  /** Socrata resource id (4x4 format) */
  resourceId: string;
  /** Field that must exist in any non-empty response */
  primaryKey: string;
  /** Alternate keys accepted in addition to primaryKey */
  alternatePrimaryKeys?: string[];
};

export const ENDPOINTS: DatasetEndpoint[] = [
  {
    key: 'hpd_violations',
    label: 'HPD Housing Maintenance Code Violations',
    resourceId: 'wvxf-dwi5',
    primaryKey: 'violationid',
  },
  {
    key: 'hpd_registrations',
    label: 'HPD Multiple Dwelling Registrations',
    resourceId: 'tesw-yqqr',
    primaryKey: 'registrationid',
  },
  {
    key: 'hpd_contacts',
    label: 'HPD Registration Contacts',
    resourceId: 'feu5-w2e2',
    primaryKey: 'registrationcontactid',
  },
  {
    key: 'dob_complaints',
    label: 'DOB Complaints Received',
    resourceId: 'eabe-havv',
    primaryKey: 'complaint_number',
  },
  {
    key: 'three11_housing',
    label: '311 Service Requests (2020 - Present)',
    resourceId: 'erm2-nwe9',
    primaryKey: 'unique_key',
  },
  {
    key: 'evictions',
    label: 'NYC Marshal Evictions',
    resourceId: '6z8x-wfk4',
    primaryKey: 'court_index_number',
  },
  {
    key: 'bedbug',
    label: 'Bedbug Reporting',
    resourceId: 'wz6d-d3jb',
    primaryKey: 'building_id',
    alternatePrimaryKeys: [':id', 'buildingid', 'registrationid'],
  },
  {
    key: 'lead_paint',
    label: 'HPD Lead Paint Violations',
    resourceId: 'au8t-hgv2',
    primaryKey: 'violationid',
  },
];
