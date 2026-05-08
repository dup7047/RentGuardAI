// Single source of truth for "is this cached aiSummary in the current format?"
//
// The pattern-lede + at-risk-apartments [summary] rule REQUIRES the model to
// emit either "At-risk apartments:" (when units recur across records) or
// "No specific units recurred across recent records." (when they don't).
// Older summaries from the pre-PR-#15 4-dataset walkthrough rule contain
// neither marker, so we use them to detect stale cache rows that need to be
// regenerated even when they're still inside their TTL.
//
// If you change the prompt's required markers, update them here too — the
// LIKE patterns in routes/lookup.ts findRecentLookup() must match.

export const SUMMARY_FORMAT_MARKERS = [
  'At-risk apartments:',
  'No specific units recurred',
] as const;

export function isCurrentSummaryFormat(summary: string | null | undefined): boolean {
  if (!summary) return false;
  return SUMMARY_FORMAT_MARKERS.some((m) => summary.includes(m));
}
