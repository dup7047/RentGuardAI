# Marketing Copy Audit — Week 1 (Phase 11.9)

**Date:** 2026-05-12
**Scope:** `frontend/app/`, `frontend/components/`
**Audit goal:** ensure no marketing copy implies legal advice, attorney-equivalent
analysis, or "we'll tell you what to do" judgments. DoNotPay-precedent risk
mitigation (FTC §5 settlement against DoNotPay, 2024) — informational tools
must not present themselves as substitutes for licensed legal advice.

## Method

Two grep passes over `frontend/app/` and `frontend/components/`. The forbidden
term list is taken from the v7 roadmap §11.9 plus a follow-up sweep for
common adjacent phrases.

### Pass 1 — primary forbidden terms

```
grep -rniE "(robot lawyer|iron[- ]?clad|expert legal analysis|we'll tell you what to do|legal advice|lawyer)" app/ components/
```

Output:

```
app/for-landlords/page.tsx:136:    RentGuard is not a law firm and does not provide legal advice. Building reports are generated from public NYC datasets. Records may be incomplete or out of date — that is exactly why we link back to every source.
app/how-it-works/page.tsx:51: d: 'RentGuard is informational. For legal advice on a specific lease or dispute, talk to a licensed NY attorney.',
app/building/[bbl]/opengraph-image.tsx:67: Always verify records yourself · Not legal advice
components/MetricInfoModal.tsx:101: All data is sourced directly from NYC open data APIs and refreshed regularly. Scores are informational, not legal advice.
```

**Verdict:** All 4 matches are **negative disclaimers** ("not a law firm",
"not legal advice", "talk to a licensed NY attorney", "informational, not
legal advice"). This is the *safe* pattern — copy disclaiming what
RentGuard is **not**, not claiming attorney-equivalent capability.

No edits required.

### Pass 2 — adjacent risk phrases

```
grep -rniE "(we'll tell you|tell you what to do|attorney-level|like a lawyer|act on your behalf|guaranteed legal|complaint letter|lawsuit ready|sue|cease and desist|guaranteed|guarantee|promises?|fight for you|win your case|legal expert|lease expert|expert review|professional review)" app/ components/
```

Output (after filtering TypeScript `Promise<T>` type literals and the word
"issues" / "issued" false positives):

```
(no user-facing copy matches)
```

The TypeScript `Promise` matches in `app/dashboard/actions.ts`,
`app/sitemap.ts`, etc. are internal types, not marketing copy. The word
"issued" matches in `components/ViolationsTab.tsx` describe HPD violations
("Issued" column header), which is record-level data, not legal-advice
language.

**Verdict:** No edits required.

## Outcome

| Check | Result |
| --- | --- |
| Forbidden terms present in user copy | 0 |
| Negative disclaimers present | 4 (good — leave in place) |
| Advice-implying CTAs | 0 |
| Attorney-level claims | 0 |

Audit complete. No copy edits needed for Phase 11.9.

## Follow-up reminders

- Re-run this audit before launch (Phase 14.10) and any time marketing
  pages are edited.
- If the Phase 13 evidence-pack generator or the Phase 6 FARE tool adds
  CTAs that talk about complaints, lawsuits, or DCWP filings, audit those
  pages **before** they ship to production.
- The roadmap explicitly cuts the "complaint letter" workflow from v7. If
  someone re-adds it later, mention of "complaint letter" needs an
  attorney-reviewed disclaimer because of NY S7263.
