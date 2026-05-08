// Build the per-record arrays the AI summary prompt consumes. Each source's
// raw fetcher returns up to 500 rows; we cap aggressively here so the prompt
// stays well within MAX_INPUT_CHARS and only sees the records most likely
// to drive an at-risk-apartments call.

import type { HpdViolation } from '../data/datasets/hpd-violations.js';
import type { HpdComplaint } from '../data/datasets/hpd-complaints.js';
import type { DobComplaint } from '../data/datasets/dob-complaints.js';
import type { ServiceRequest311 } from '../data/datasets/three11-housing.js';
import type { BuildingPayload } from './prompts/lookup-summary.js';

const HPD_VIOLATION_CAP = 30;
const HPD_COMPLAINT_CAP = 25;
const DOB_COMPLAINT_CAP = 20;
const THREE11_CAP = 20;

function dateDesc(a: string | undefined, b: string | undefined): number {
  // Socrata floating_timestamp strings sort lexicographically same as date order.
  return (b ?? '').localeCompare(a ?? '');
}

export function projectHpdViolations(
  rows: HpdViolation[],
): NonNullable<BuildingPayload['recentHpdViolations']> {
  const open = rows
    .filter((r) => r.currentstatus !== 'CLOSE')
    .slice()
    .sort((a, b) => dateDesc(a.inspectiondate ?? a.novissueddate, b.inspectiondate ?? b.novissueddate));
  const closed = rows
    .filter((r) => r.currentstatus === 'CLOSE')
    .slice()
    .sort((a, b) => dateDesc(a.inspectiondate ?? a.novissueddate, b.inspectiondate ?? b.novissueddate));
  // Open records matter most — fill the cap with them first, top off with
  // most-recent closed only if there's room left.
  const slice = open.concat(closed).slice(0, HPD_VIOLATION_CAP);
  return slice.map((r) => ({
    apartment: r.apartment ?? null,
    class: r.class ?? null,
    issuedDate: r.inspectiondate ?? r.novissueddate ?? null,
    description: r.novdescription ?? null,
    status: r.currentstatus === 'CLOSE' ? 'closed' : 'open',
  }));
}

export function projectHpdComplaints(
  rows: HpdComplaint[],
): NonNullable<BuildingPayload['recentHpdComplaints']> {
  return rows
    .slice()
    .sort((a, b) => dateDesc(a.receiveddate, b.receiveddate))
    .slice(0, HPD_COMPLAINT_CAP)
    .map((r) => ({
      apartment: r.apartment ?? null,
      receivedDate: r.receiveddate ?? null,
      status: r.status ?? null,
    }));
}

export function projectDobComplaints(
  rows: DobComplaint[],
): NonNullable<BuildingPayload['recentDobComplaints']> {
  return rows
    .slice()
    .sort((a, b) => dateDesc(a.date_entered, b.date_entered))
    .slice(0, DOB_COMPLAINT_CAP)
    .map((r) => ({
      date: r.date_entered ?? null,
      category: r.complaint_category ?? null,
      status: r.status ?? null,
    }));
}

export function project311Complaints(
  rows: ServiceRequest311[],
): NonNullable<BuildingPayload['recent311Complaints']> {
  return rows
    .slice()
    .sort((a, b) => dateDesc(a.created_date, b.created_date))
    .slice(0, THREE11_CAP)
    .map((r) => ({
      date: r.created_date ?? null,
      type: r.complaint_type ?? null,
      descriptor: r.descriptor ?? null,
      status: r.status ?? null,
    }));
}
