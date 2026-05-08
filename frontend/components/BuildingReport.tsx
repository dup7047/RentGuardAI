// Building risk report — Phase 5 visual rebrand.
// Layout: breadcrumb → 2-col header (left address card + actions, right
// gauge + score band) → tabs (only Overview is real) → CTA strip.
// Used by both /building/[bbl] (ISR) and the post-lookup redirect.

'use client';

import { useEffect, useState } from 'react';

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
import { buildingJsonLd } from '@/lib/seo/structured-data';
import {
  getBandLabel,
  getReportTone,
  getSavedBuildingState,
  getValueBandLabel,
  getValueTone,
  saveBuilding,
  unsaveBuilding,
  SavedBuildingsAuthError,
  type LookupResponse,
  type ValueBand,
  type ValueConfidence,
} from '@/lib/api/backend';
import { createClient } from '@/lib/supabase/browser';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;
type Tab = 'overview' | 'violations' | 'complaints' | 'owner' | 'sources';

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

export function BuildingReport({ data }: { data: SuccessData }) {
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
  const [modal, setModal] = useState<null | { kind: 'save' | 'lease' | 'gate'; reason: SignInReason } | { kind: 'share' }>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Saved-building state. `null` means "haven't checked yet" — render the
  // default unsaved label until we know. After checking, true/false drive
  // the button label.
  const [isAuthed, setIsAuthed] = useState<boolean>(false);
  const [isSaved, setIsSaved] = useState<boolean | null>(null);
  const [saveInFlight, setSaveInFlight] = useState<boolean>(false);

  // On mount + when bbl changes, check auth status. If signed in, fetch
  // whether this BBL is already saved so the button label reflects reality
  // before the user clicks anything.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (cancelled) return;
        const authed = Boolean(session);
        setIsAuthed(authed);
        if (authed) {
          const state = await getSavedBuildingState(bbl);
          if (!cancelled) setIsSaved(state.saved);
        } else {
          setIsSaved(false);
        }
      } catch {
        if (!cancelled) {
          setIsAuthed(false);
          setIsSaved(false);
        }
      }
    })();
    return () => {
      cancelled = true;
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
    window.setTimeout(() => setToast(null), 2400);
  }

  async function handleSave() {
    // Anon → SignInModal (existing flow, unchanged).
    if (!isAuthed) {
      setModal({ kind: 'save', reason: 'save' });
      return;
    }
    if (saveInFlight) return; // debounce double-clicks
    // Authed: optimistic toggle, fire API, revert + toast on error.
    const wasSaved = isSaved === true;
    setIsSaved(!wasSaved);
    setSaveInFlight(true);
    try {
      if (wasSaved) {
        await unsaveBuilding(bbl);
        showToast('Removed from saved buildings');
      } else {
        await saveBuilding(bbl);
        showToast('Saved to your dashboard');
      }
    } catch (err) {
      // Revert on failure.
      setIsSaved(wasSaved);
      if (err instanceof SavedBuildingsAuthError) {
        // Token expired or invalid — fall back to the sign-in modal.
        setIsAuthed(false);
        setModal({ kind: 'save', reason: 'save' });
      } else {
        showToast(wasSaved ? "Couldn't unsave — try again" : "Couldn't save — try again");
      }
    } finally {
      setSaveInFlight(false);
    }
  }

  function handleLease() {
    setModal({ kind: 'lease', reason: 'lease' });
  }

  function handleDownloadPdf() {
    if (typeof window !== 'undefined') {
      window.print();
    }
  }

  return (
    <div className="building-report report screen-fade">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <LegalFraming />

      <div className="container">
        <div className="breadcrumb">
          <a href="/lookup">Search</a>
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
            <h2 style={{ marginTop: 12 }}>
              {address}
              {unit ? `, ${unit}` : ''}
            </h2>
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
                onClick={() => setModal({ kind: 'share' })}
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
                  onClick={() =>
                    showToast(
                      'Score = 100 minus penalties. See "Notable findings" for the breakdown.',
                    )
                  }
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
                    onClick={() =>
                      showToast(
                        'Value score compares this rent to borough medians for similar-sized apartments. Higher = better deal.',
                      )
                    }
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

        {/* Have-a-lease CTA strip */}
        <div className="lease-cta">
          <div className="body">
            <div>Have a lease in hand?</div>
            <div>
              Upload the PDF and we&apos;ll flag clauses that disagree with
              NYC tenant law.
            </div>
          </div>
          <button type="button" className="btn primary" onClick={handleLease}>
            Review my lease →
          </button>
        </div>
      </div>

      <LegalFooter />

      {modal?.kind === 'save' && (
        <SignInModal reason="save" onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'lease' && (
        <SignInModal reason="lease" onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'gate' && (
        <SignInModal reason="gate" onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'share' && (
        <ShareModal bbl={bbl} onClose={() => setModal(null)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
