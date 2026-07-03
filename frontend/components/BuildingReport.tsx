// Building risk report — Phase 5 visual rebrand.
// Layout: breadcrumb → 2-col header (left address card + actions, right
// gauge + score band) → tabs (only Overview is real) → CTA strip.
// Used by both /building/[bbl] (ISR) and the post-lookup redirect.

'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { LegalFooter } from './LegalFooter';
import { LegalFraming } from './LegalFraming';
import { Gauge } from './Gauge';
import { OverviewTab } from './OverviewTab';
import { ViolationsTab } from './ViolationsTab';
import { ComplaintsTab } from './ComplaintsTab';
import { OwnerTab } from './OwnerTab';
import { SourcesTab } from './SourcesTab';
import { ShareModal } from './ShareModal';
import { SignInModal, type SignInReason } from './SignInModal';
import { MetricInfoModal } from './MetricInfoModal';
import { buildingJsonLd, serializeJsonLd } from '@/lib/seo/structured-data';
import { computeBuildingGrade } from '@/lib/building-grade';
import {
  getBandLabel,
  getReportTone,
  getValueBandLabel,
  getValueTone,
  type LookupResponse,
  type ValueBand,
  type ValueConfidence,
} from '@/lib/api/backend';
import {
  getSavedBuildingStateAction,
  saveBuildingAction,
  unsaveBuildingAction,
} from '@/app/building/[bbl]/actions';
import { createClient } from '@/lib/supabase/browser';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;
type Tab = 'overview' | 'violations' | 'complaints' | 'owner' | 'sources';

function mergeFreshLookupData(serverData: SuccessData, freshData: SuccessData): SuccessData {
  return {
    ...serverData,
    ...freshData,
    violations_rows: freshData.violations_rows ?? serverData.violations_rows,
    complaints_rows: freshData.complaints_rows ?? serverData.complaints_rows,
    evictions_rows: freshData.evictions_rows ?? serverData.evictions_rows,
    total_counts: freshData.total_counts ?? serverData.total_counts,
    has_more: freshData.has_more ?? serverData.has_more,
  };
}

function fmtUnit(scrapedUnit: string | null | undefined): string | null {
  if (!scrapedUnit) return null;
  return scrapedUnit;
}

function bedsLabel(beds: number | null | undefined): string {
  if (beds === null || beds === undefined) return '— bed';
  if (beds === 0) return 'Studio';
  return `${beds} bed`;
}

function moneyFromCents(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined) return null;
  return `$${Math.round(cents / 100).toLocaleString()}/mo`;
}

export function BuildingReport({ data: serverData }: { data: SuccessData }) {
  const [data, setData] = useState<SuccessData>(serverData);
  const {
    bbl,
    address,
    borough,
    summary,
    score,
    score_band,
    scraped_listing,
    stats,
    value_score,
    value_band,
    value_confidence,
  } = data;

  const [tab, setTab] = useState<Tab>('overview');
  const [modal, setModal] = useState<null | { kind: 'save' | 'gate'; reason: SignInReason } | { kind: 'share' } | { kind: 'maintenance-info' } | { kind: 'value-info' }>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Saved-building state. `null` means "haven't checked yet" — render the
  // default unsaved label until we know. After checking, true/false drive
  // the button label.
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean | null>(null);
  const [saveInFlight, setSaveInFlight] = useState<boolean>(false);
  const toastTimerRef = useRef<number | null>(null);

  // Clear any pending toast timer on unmount so it can't fire afterwards.
  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setData(serverData);
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('fresh') !== '1') return;
      const raw = window.sessionStorage.getItem(`rentguard:fresh-report:${serverData.bbl}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as LookupResponse;
      if (parsed.kind === 'success' && parsed.bbl === serverData.bbl) {
        setData(mergeFreshLookupData(serverData, parsed));
      }
    } catch {
      // Fresh lookup metadata is only a client-side enhancement.
    }
  }, [serverData]);

  // On mount + when bbl changes, ask the server whether this BBL is already
  // saved. The server action reads the session via @/lib/supabase/server
  // (raw HTTP cookies) — that's the path that survives Safari's chunked-
  // cookie parsing bug, which is what was making the browser-client
  // getSession() in the old flow return null and force the modal open.
  //
  // We still subscribe to onAuthStateChange so a sign-in that lands AFTER
  // mount (e.g. completing the sign-in flow in another tab) re-fetches the
  // saved-state. Filter to SIGNED_IN / SIGNED_OUT only — INITIAL_SESSION
  // fires immediately (we already do that work in the explicit call below)
  // and TOKEN_REFRESHED fires hourly (would silently spam the server action).
  useEffect(() => {
    let cancelled = false;

    async function refreshSavedState() {
      try {
        const result = await getSavedBuildingStateAction(bbl);
        if (cancelled) return;
        if (result.kind === 'ok') {
          setIsAuthed(true);
          setIsSaved(result.saved);
        } else {
          setIsAuthed(false);
          setIsSaved(false);
        }
      } catch {
        if (!cancelled) {
          setIsAuthed(false);
          setIsSaved(false);
        }
      }
    }

    void refreshSavedState();

    // createClient() throws if Supabase env vars are missing (e.g. in unit
    // tests that don't mock the client). The save flow already degrades to
    // anon in that case via the server action above; the subscription is
    // purely additive, so swallow the construction error and skip
    // subscribing rather than crashing the whole report.
    let unsubscribe: (() => void) | null = null;
    try {
      const supabase = createClient();
      const sub = supabase.auth.onAuthStateChange((event) => {
        if (cancelled) return;
        if (event === 'SIGNED_IN') void refreshSavedState();
        else if (event === 'SIGNED_OUT') {
          setIsAuthed(false);
          setIsSaved(false);
        }
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
    } catch {
      // No subscription — the explicit getSavedBuildingStateAction above
      // still runs.
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [bbl]);

  const tone = getReportTone(score_band);
  const label = getBandLabel(score_band);
  const numericScore = score ?? 50;

  const jsonLd = buildingJsonLd({
    address,
    bbl,
    summary: summary ?? '',
    borough,
  });

  const unit = fmtUnit(scraped_listing?.unit ?? null);
  const beds = scraped_listing?.bedrooms ?? null;
  const baths = scraped_listing?.bathrooms ?? null;
  const sqft = scraped_listing?.squareFeet ?? null;
  const rent = moneyFromCents(scraped_listing?.monthlyRentCents ?? null);
  const hasMeta =
    beds !== null || baths !== null || sqft !== null || rent !== null;

  const openHpd = stats.hpd_violations_open ?? 0;

  function showToast(msg: string) {
    setToast(msg);
    // Restart the dismiss timer so a rapid second toast gets its full 2.4s
    // instead of being cut short by the first toast's timer.
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  }

  async function handleSave() {
    if (saveInFlight) return; // debounce double-clicks
    // Optimistic toggle. The server action is the source of truth for auth
    // state — if it returns `unauthorized` we revert and open the modal.
    // No client-side getSession() check; that path was unreliable on Safari
    // (see the mount effect's comment).
    const wasSaved = isSaved === true;
    setIsSaved(!wasSaved);
    setSaveInFlight(true);
    try {
      const result = wasSaved
        ? await unsaveBuildingAction(bbl)
        : await saveBuildingAction(bbl);
      if (result.kind === 'ok') {
        showToast(wasSaved ? 'Removed from saved buildings' : 'Saved to your dashboard');
        return;
      }
      // Revert optimistic toggle on any non-ok result.
      setIsSaved(wasSaved);
      if (result.kind === 'unauthorized') {
        setIsAuthed(false);
        setModal({ kind: 'save', reason: 'save' });
      } else {
        showToast(wasSaved ? "Couldn't unsave. Try again" : "Couldn't save. Try again");
      }
    } finally {
      setSaveInFlight(false);
    }
  }

  function handleDownloadPdf() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  async function handleShare() {
    const openViolations = stats?.hpd_violations_open ?? 0;
    const grade = computeBuildingGrade(openViolations);
    const shareUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/building/${bbl}`
        : `https://www.rentguard.cc/building/${bbl}`;
    const shareTitle = `${address ?? `BBL ${bbl}`} | RentGuard NYC`;
    const shareText = `${openViolations} open HPD violations · grade ${grade} · check your building free`;

    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url: shareUrl, title: shareTitle, text: shareText });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        // Any other failure: fall through to the modal so the user still has a path.
      }
    }
    setModal({ kind: 'share' });
  }

  return (
    <div className="building-report report screen-fade">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <LegalFraming />

      <div className="container">
        <div className="breadcrumb">
          <a href="/">Search</a>
          <span>›</span>
          <span>{borough}</span>
          <span>›</span>
          <span style={{ color: 'var(--ink)' }}>{address}</span>
        </div>

        <div className="report-head">
          {/* Left: address + actions */}
          <div className="card head-left">
            <span className={`pill ${tone}`}>
              <span className="dot" />
              {label}
            </span>
            <h1 style={{ marginTop: 12, fontSize: 28, fontWeight: 700, lineHeight: 1.2 }}>
              {address}
              {unit ? `, ${unit}` : ''}
            </h1>
            <div style={{ color: 'var(--ink-2)', fontSize: 14 }}>
              {borough} · NYC
            </div>
            {hasMeta && (
              <div className="meta-row">
                {beds !== null && <span>🛏 {bedsLabel(beds)}</span>}
                {baths !== null && <span>🛁 {baths} bath</span>}
                {sqft !== null && <span>📐 {sqft.toLocaleString()} sqft</span>}
                {rent !== null && <span>💵 {rent}</span>}
                <span
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--muted)' }}
                >
                  BBL {bbl}
                </span>
              </div>
            )}
            {!hasMeta && (
              <div className="meta-row">
                <span
                  className="mono"
                  style={{ fontSize: 12, color: 'var(--muted)' }}
                >
                  BBL {bbl}
                </span>
              </div>
            )}
            <div className="head-actions">
              <button
                type="button"
                className="btn primary"
                onClick={handleSave}
                disabled={saveInFlight}
              >
                {isSaved ? '★ Saved' : '★ Save building'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={handleShare}
              >
                ↗ Share report
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={handleDownloadPdf}
              >
                ⤓ Download PDF
              </button>
            </div>
          </div>

          {/* Right: maintenance gauge + optional value gauge (stacked) */}
          <div className="card head-right" style={{ gap: 20 }}>
            {/* Maintenance score */}
            <div className="score-row">
              <Gauge score={numericScore} band={score_band} size={88} stroke={8} />
              <div className="col">
                <div className="score-label">Maintenance</div>
                <h3
                  style={{
                    color:
                      tone === 'good'
                        ? 'var(--good)'
                        : tone === 'warn'
                          ? 'oklch(0.45 0.13 70)'
                          : 'var(--bad)',
                    marginTop: 2,
                  }}
                >
                  {label}
                </h3>
                <div className="sub" style={{ fontSize: 12 }}>
                  HPD violations, complaints, evictions, watchlist.
                </div>
                <button
                  type="button"
                  className="btn link sm"
                  style={{ padding: '4px 0', marginTop: 4, fontSize: 12 }}
                  onClick={() => setModal({ kind: 'maintenance-info' })}
                >
                  How is this calculated? →
                </button>
              </div>
            </div>

            {/* Value score — shown only when we have a result with medium/high confidence */}
            {value_score !== null && value_confidence !== 'low' ? (
              <div className="score-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <Gauge score={value_score} band={null} valueBand={value_band ?? undefined} size={88} stroke={8} />
                <div className="col">
                  <div className="score-label">Value</div>
                  <h3
                    style={{
                      color:
                        getValueTone(value_band) === 'good'
                          ? 'var(--good)'
                          : getValueTone(value_band) === 'warn'
                            ? 'oklch(0.45 0.13 70)'
                            : 'var(--bad)',
                      marginTop: 2,
                    }}
                  >
                    {getValueBandLabel(value_band)}
                  </h3>
                  <div className="sub" style={{ fontSize: 12 }}>
                    Rent vs. comparable nearby listings.
                    {value_confidence === 'medium' && (
                      <span style={{ color: 'var(--muted)', marginLeft: 4 }}>(limited data)</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn link sm"
                    style={{ padding: '4px 0', marginTop: 4, fontSize: 12 }}
                    onClick={() => setModal({ kind: 'value-info' })}
                  >
                    How is this calculated? →
                  </button>
                </div>
              </div>
            ) : scraped_listing?.monthlyRentCents ? (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, fontSize: 13, color: 'var(--muted)' }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>Value</div>
                Not enough nearby comp data for a value rating yet.
              </div>
            ) : null}
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" role="tablist">
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'violations', label: `HPD violations (${openHpd})` },
              { id: 'complaints', label: 'DOB & 311' },
              { id: 'owner', label: 'Owner & watchlist' },
              { id: 'sources', label: 'Sources' },
            ] as Array<{ id: Tab; label: string }>
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && <OverviewTab data={data} onSelectTab={setTab} />}
        {tab === 'violations' && <ViolationsTab data={data} />}
        {tab === 'complaints' && <ComplaintsTab data={data} />}
        {tab === 'owner' && <OwnerTab data={data} />}
        {tab === 'sources' && <SourcesTab data={data} />}

        {/* Source-first CTA strip */}
        <div className="report-cta">
          <div className="body">
            <div>Need to double-check the source?</div>
            <div>
              Open the Sources tab to verify every public record used in this report.
            </div>
          </div>
          <button type="button" className="btn primary" onClick={() => setTab('sources')}>
            View sources →
          </button>
        </div>
      </div>

      <LegalFooter />

      {typeof document !== 'undefined' && modal && createPortal(
        <>
          {modal.kind === 'save' && (
            <SignInModal reason="save" onClose={() => setModal(null)} />
          )}
          {modal.kind === 'gate' && (
            <SignInModal reason="gate" onClose={() => setModal(null)} />
          )}
          {modal.kind === 'share' && (
            <ShareModal bbl={bbl} onClose={() => setModal(null)} />
          )}
          {modal.kind === 'maintenance-info' && (
            <MetricInfoModal kind="maintenance" onClose={() => setModal(null)} />
          )}
          {modal.kind === 'value-info' && (
            <MetricInfoModal kind="value" onClose={() => setModal(null)} />
          )}
        </>,
        document.body
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
