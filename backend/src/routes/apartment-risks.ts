import type { HpdViolation } from '../data/datasets/hpd-violations.js';
import type { Eviction } from '../data/datasets/evictions.js';
import type { LeadPaintViolation } from '../data/datasets/lead-paint.js';

export type ApartmentIssue = {
  source: 'hpd' | 'eviction' | 'lead';
  cls?: string;
  status?: string;
  date?: string;
  description?: string;
};

export type ApartmentRisk = {
  apt: string;
  issues: ApartmentIssue[];
};

const MAX_APARTMENTS = 8;
const MAX_ISSUES_PER_APT = 6;
const DESCRIPTION_MAX_CHARS = 140;

function isOpen(status: string | undefined): boolean {
  return status !== 'CLOSE';
}

function isHighClass(cls: string | undefined): boolean {
  return cls === 'B' || cls === 'C';
}

function parseDate(d: string | undefined): number {
  if (!d) return 0;
  const ms = Date.parse(d);
  return isNaN(ms) ? 0 : ms;
}

function trimApt(apt: string | undefined): string {
  return apt?.trim() ?? '';
}

function truncate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  return s.length > DESCRIPTION_MAX_CHARS ? s.slice(0, DESCRIPTION_MAX_CHARS) : s;
}

export function buildApartmentRisks(input: {
  hpd: HpdViolation[];
  evic: Eviction[];
  lead: LeadPaintViolation[];
}): ApartmentRisk[] {
  const map = new Map<string, ApartmentIssue[]>();

  function add(apt: string | undefined, issue: ApartmentIssue) {
    const key = trimApt(apt);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(issue);
  }

  for (const v of input.hpd) {
    add(v.apartment, {
      source: 'hpd',
      cls: v.class,
      status: v.currentstatus,
      date: v.inspectiondate ?? v.novissueddate,
      description: truncate(v.novdescription),
    });
  }

  for (const e of input.evic) {
    add(e.eviction_apt_num, {
      source: 'eviction',
      date: e.executed_date,
      description: truncate(e.eviction_legal_possession),
    });
  }

  for (const l of input.lead) {
    add(l.apartment, {
      source: 'lead',
      cls: l.class,
      status: l.currentstatus,
      date: l.inspectiondate,
      description: truncate(l.novdescription),
    });
  }

  // Sort issues within each apartment: open high-class first, then by recency
  function issueScore(i: ApartmentIssue): number {
    const highOpen = i.source !== 'eviction' && isHighClass(i.cls) && isOpen(i.status) ? 2 : 0;
    const highClosed = i.source !== 'eviction' && isHighClass(i.cls) ? 1 : 0;
    return highOpen + highClosed;
  }

  function sortIssues(issues: ApartmentIssue[]): ApartmentIssue[] {
    return [...issues].sort((a, b) => {
      const scoreDiff = issueScore(b) - issueScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return parseDate(b.date) - parseDate(a.date);
    });
  }

  // Rank apartments: open high-class count desc, then most-recent date desc, then total count desc
  const ranked = Array.from(map.entries())
    .map(([apt, issues]) => {
      const sorted = sortIssues(issues);
      const openHighClass = issues.filter(
        (i) => i.source !== 'eviction' && isHighClass(i.cls) && isOpen(i.status),
      ).length;
      const mostRecent = Math.max(...issues.map((i) => parseDate(i.date)));
      return { apt, issues: sorted, openHighClass, mostRecent, total: issues.length };
    })
    .sort((a, b) => {
      if (b.openHighClass !== a.openHighClass) return b.openHighClass - a.openHighClass;
      if (b.mostRecent !== a.mostRecent) return b.mostRecent - a.mostRecent;
      return b.total - a.total;
    });

  return ranked.slice(0, MAX_APARTMENTS).map(({ apt, issues }) => ({
    apt,
    issues: issues.slice(0, MAX_ISSUES_PER_APT),
  }));
}
