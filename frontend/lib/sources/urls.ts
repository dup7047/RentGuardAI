// Deterministic deep-link builders for the four core indicator sources.
// Frontend constructs these from BBL/BIN/hpd_building_id on the response so
// the user lands on this building's record on the primary source — not the
// dataset homepage.

const HPD_HOMEPAGE = 'https://hpdonline.nyc.gov/hpdonline/';
const DOB_HOMEPAGE = 'https://a810-bisweb.nyc.gov/bisweb/bsqpm01.jsp';
const EVICTIONS_DATASET = 'https://data.cityofnewyork.us/City-Government/Evictions/6z8x-wfk4';
const WATCHLIST_HOMEPAGE = 'https://landlordwatchlist.com/';

export function hpdViolationsUrl(opts: {
  hpdBuildingId?: string | null;
  bbl: string;
}): string {
  if (opts.hpdBuildingId) {
    return `https://hpdonline.nyc.gov/hpdonline/building/${encodeURIComponent(opts.hpdBuildingId)}/violations`;
  }
  return HPD_HOMEPAGE;
}

export function dobComplaintsUrl(opts: { bin?: string | null }): string {
  if (opts.bin) {
    return `https://a810-bisweb.nyc.gov/bisweb/PropertyProfileOverviewServlet?bin=${encodeURIComponent(opts.bin)}`;
  }
  return DOB_HOMEPAGE;
}

export function threeOneOneUrl(opts: { bbl: string }): string {
  return `https://data.cityofnewyork.us/resource/erm2-nwe9.json?bbl=${encodeURIComponent(opts.bbl)}`;
}

export function evictionsUrl(opts: { bbl: string }): string {
  return `${EVICTIONS_DATASET}?bbl=${encodeURIComponent(opts.bbl)}`;
}

export function hpdRegistrationsUrl(opts: { bbl: string }): string {
  return `https://data.cityofnewyork.us/Housing-Development/Multiple-Dwelling-Registrations/tesw-yqqr?bbl=${encodeURIComponent(opts.bbl)}`;
}

function landlordSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function watchlistUrl(opts: {
  registeredOwnerName?: string | null;
  watchlistRank?: number | null;
}): string {
  if (opts.watchlistRank && opts.registeredOwnerName) {
    return `https://landlordwatchlist.com/landlord/${landlordSlug(opts.registeredOwnerName)}`;
  }
  return WATCHLIST_HOMEPAGE;
}
