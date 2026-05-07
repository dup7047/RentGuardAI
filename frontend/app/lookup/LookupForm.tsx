'use client';

// Lookup landing — Phase 5 visual rebrand.
// Hero + single-input search card + trust pill + sources strip.
//
// Phase 6: submit POSTs to /v1/lookup/stream (NDJSON) so the Loading
// animation can advance step-by-step in sync with backend phases.
// The final response shape is identical to the old /v1/lookup endpoint,
// so all 11 response-kind branches below are unchanged.
//
// Phase 7: live address autocomplete. While the user types a non-URL
// query (≥ 3 chars), we hit NYC Geosearch's /v2/autocomplete and show
// matching buildings in a dropdown. Picking one fills the input and
// fires the lookup immediately (Google-Maps-style).

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AddressSuggestions } from '@/components/AddressSuggestions';
import { Ambiguous } from '@/components/Ambiguous';
import { Loading } from '@/components/Loading';
import { OutsideNyc } from '@/components/OutsideNyc';
import {
  postLookupStream,
  type LookupPhase,
  type LookupResponse,
} from '@/lib/api/backend';
import {
  getAddressSuggestions,
  type AddressSuggestion,
} from '@/lib/api/geosearch';

const SOURCES = [
  { ico: 'H', nm: 'HPD violations', ds: 'Open & closed code violations' },
  { ico: 'D', nm: 'DOB complaints', ds: 'Construction & safety filings' },
  { ico: 'E', nm: 'Evictions', ds: 'Marshal eviction records' },
  { ico: 'O', nm: 'Owner records', ds: 'HPD registered owner & officer' },
  { ico: 'W', nm: 'Watchlist', ds: 'Public Advocate Worst Landlord' },
] as const;

const AUTOCOMPLETE_DEBOUNCE_MS = 180;
const AUTOCOMPLETE_MIN_LEN = 3;

export function LookupForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  // Phase 6: latest backend phase event drives the Loading animation.
  const [phase, setPhase] = useState<LookupPhase | null>(null);
  const [email, setEmail] = useState('');
  // Fallback paste — only shown when the scrape returns kind: 'listing_blocked'
  const [showFallbackPaste, setShowFallbackPaste] = useState(false);
  const [fallbackAddress, setFallbackAddress] = useState('');
  const [fallbackDescription, setFallbackDescription] = useState('');

  // Phase 7: autocomplete state.
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Fetch effect — debounced + cancellable.
  useEffect(() => {
    if (/^https?:\/\//i.test(input)) {
      setShowSuggestions(false);
      return;
    }
    if (input.trim().length < AUTOCOMPLETE_MIN_LEN) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const list = await getAddressSuggestions(input.trim(), ctrl.signal);
        setSuggestions(list);
        setActiveIndex(-1);
        setShowSuggestions(list.length > 0);
      } catch (e) {
        // Aborted by a newer keystroke — ignore. (Helper re-throws AbortError;
        // returns [] for any other failure so we never reach this catch for
        // network/parse errors.)
        if ((e as Error).name !== 'AbortError') throw e;
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [input]);

  // Click-outside effect — closes the dropdown when the user clicks
  // anywhere outside the search-card wrap.
  useEffect(() => {
    if (!showSuggestions) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [showSuggestions]);

  async function submit(extras: {
    email?: string;
    address?: string;
    listingDescription?: string;
    addressOverride?: string;
  } = {}) {
    const value = extras.addressOverride ?? input;
    // Picked-suggestion overrides are always addresses (NYC Geosearch only
    // returns address features). Otherwise check the input shape.
    const isUrl = !extras.addressOverride && /^https?:\/\//i.test(value);
    setLoading(true);
    setPhase(null);
    setResp(null);
    setShowFallbackPaste(false);
    setShowSuggestions(false);
    let r: LookupResponse;
    try {
      r = await postLookupStream(
        {
          ...(isUrl ? { listingUrl: value } : { address: value }),
          ...(extras.email ? { email: extras.email } : {}),
          ...(extras.listingDescription
            ? { listingDescription: extras.listingDescription }
            : {}),
        },
        (p) => setPhase(p),
      );
    } catch {
      // Network drop or stream parse failure — surface as a generic error.
      r = { kind: 'invalid_input', errors: { _: 'network' } };
    }
    setLoading(false);
    setResp(r);
    if (r.kind === 'success') {
      router.push(`/building/${r.bbl}?fresh=1`);
    }
    if (r.kind === 'listing_blocked') {
      setShowFallbackPaste(true);
    }
  }

  async function submitFallback() {
    if (!fallbackAddress.trim()) return;
    setLoading(true);
    setPhase(null);
    let r: LookupResponse;
    try {
      r = await postLookupStream(
        {
          listingUrl: input,
          address: fallbackAddress.trim(),
          ...(fallbackDescription.trim().length > 0
            ? { listingDescription: fallbackDescription.trim() }
            : {}),
        },
        (p) => setPhase(p),
      );
    } catch {
      r = { kind: 'invalid_input', errors: { _: 'network' } };
    }
    setLoading(false);
    setResp(r);
    if (r.kind === 'success') {
      router.push(`/building/${r.bbl}?fresh=1`);
    }
  }

  function reset() {
    setResp(null);
    setShowFallbackPaste(false);
    setFallbackAddress('');
    setFallbackDescription('');
  }

  function handlePick(s: AddressSuggestion) {
    setInput(s.display);
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    // submit() reads `input` from React state, but the setState above
    // hasn't flushed yet. Pass the value directly via the override path.
    void submit({ addressOverride: s.display });
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
      if (e.key === 'Enter' && activeIndex >= 0) {
        e.preventDefault();
        const picked = suggestions[activeIndex];
        if (picked) handlePick(picked);
        return;
      }
    }
    if (e.key === 'Enter' && input.trim()) {
      submit();
    }
  }

  // Top-level branches — full-screen takeovers
  if (loading) return <Loading phase={phase} />;
  if (resp?.kind === 'outside_nyc') {
    return (
      <OutsideNyc
        detectedCity={resp.detected_city}
        detectedState={resp.detected_state}
        onBack={reset}
      />
    );
  }
  if (resp?.kind === 'ambiguous') {
    return (
      <Ambiguous
        matches={resp.matches}
        onPick={(match) => {
          // Re-run /v1/lookup with the canonical (borough-qualified) label
          // so the backend resolves to a single BBL and the FULL pipeline
          // runs (geosearch → datasets → score → AI → DB upsert). Going
          // straight to /building/[bbl] would 404 because the SEO archive
          // route requires a buildings row, which an ambiguous geosearch
          // never inserts.
          void submit({ addressOverride: match.address });
        }}
        onBack={reset}
      />
    );
  }

  const activeId =
    showSuggestions && activeIndex >= 0 ? `addr-opt-${activeIndex}` : undefined;

  // Default: landing hero + search card
  return (
    <div className="landing screen-fade">
      <div className="landing-bg" />
      <div className="container">
        <div className="hero-center">
          <div className="eyebrow">
            <span className="ico" aria-hidden="true">
              ✦
            </span>
            Powered by NYC Open Data + AI
          </div>
          <h1 className="hero">
            Look up any NYC building <em>before you sign.</em>
          </h1>
          <p className="hero-sub">
            RentGuard pulls HPD violations, DOB complaints, owner records, and
            the Worst Landlord Watchlist into one plain-English risk report.
            Free for renters.
          </p>

          <div className="search-card-wrap" ref={wrapRef}>
            <div className="search-card">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onInputKeyDown}
                onFocus={() => {
                  if (
                    suggestions.length > 0 &&
                    !/^https?:\/\//i.test(input)
                  ) {
                    setShowSuggestions(true);
                  }
                }}
                placeholder="Paste a listing URL or NYC address…"
                aria-label="NYC listing URL or address"
                role="combobox"
                aria-expanded={showSuggestions}
                aria-controls="address-suggestions"
                aria-autocomplete="list"
                aria-activedescendant={activeId}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                className="btn primary lg"
                onClick={() => submit()}
                disabled={!input.trim()}
              >
                Look up <span className="arr">→</span>
              </button>
            </div>
            {showSuggestions && suggestions.length > 0 && (
              <AddressSuggestions
                suggestions={suggestions}
                activeIndex={activeIndex}
                onPick={handlePick}
                onHover={setActiveIndex}
              />
            )}
          </div>

          {/* Inline error banners */}
          {resp?.kind === 'requires_address' && !showFallbackPaste && (
            <p className="lookup-msg error">
              We couldn&apos;t extract an address from that URL. Paste the
              building address directly above.
            </p>
          )}
          {resp?.kind === 'listing_not_found' && (
            <p className="lookup-msg error">
              That listing was removed or is no longer active. Try the
              building address.
            </p>
          )}
          {resp?.kind === 'listing_expired' && (
            <p className="lookup-msg error">
              That listing has expired. Try the building address to see records
              anyway.
            </p>
          )}
          {resp?.kind === 'unsupported_url' && (
            <p className="lookup-msg error">
              We don&apos;t recognize that site yet. Try a StreetEasy or Zillow
              URL, or paste the address.
            </p>
          )}
          {resp?.kind === 'cost_cap' && (
            <p className="lookup-msg error">{resp.message}</p>
          )}
          {resp?.kind === 'rate_limited' && (
            <p className="lookup-msg error">{resp.message}</p>
          )}
          {resp?.kind === 'invalid_input' && (
            <p className="lookup-msg error">
              Please enter a valid NYC address or listing URL.
            </p>
          )}

          {/* Listing-blocked: show the paste-fallback expansion */}
          {resp?.kind === 'listing_blocked' && showFallbackPaste && (
            <div className="lookup-fallback">
              <p
                style={{
                  margin: 0,
                  fontSize: 13.5,
                  color: 'oklch(0.45 0.13 70)',
                }}
              >
                That listing is behind bot protection — we couldn&apos;t read
                it. Paste the address (and description if you can) and
                we&apos;ll generate a building review.
              </p>
              <label htmlFor="fb-address">Address</label>
              <input
                id="fb-address"
                type="text"
                value={fallbackAddress}
                onChange={(e) => setFallbackAddress(e.target.value)}
                placeholder="123 W 23rd St, New York, NY"
              />
              <label htmlFor="fb-description">Listing description (optional)</label>
              <textarea
                id="fb-description"
                value={fallbackDescription}
                onChange={(e) => setFallbackDescription(e.target.value)}
                placeholder="Paste the listing copy here…"
                rows={5}
                maxLength={4000}
              />
              <div className="actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={submitFallback}
                  disabled={!fallbackAddress.trim()}
                >
                  Continue with address →
                </button>
              </div>
            </div>
          )}

          {/* Email-gate: inline form */}
          {resp?.kind === 'email_gate' && (
            <form
              className="lookup-email-gate"
              onSubmit={(e) => {
                e.preventDefault();
                submit({ email });
              }}
            >
              <p style={{ margin: 0, fontSize: 13.5 }}>{resp.message}</p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                aria-label="Email address"
              />
              <button type="submit" className="btn primary">
                Continue
              </button>
            </form>
          )}

          <div className="trust">
            <div className="item">
              <b>9</b>
              <span>NYC Open Data sources</span>
            </div>
            <div className="sep" />
            <div className="item">
              <b>$0</b>
              <span>Per lookup</span>
            </div>
          </div>

          <div className="sources-strip">
            <div className="label">What we check on every lookup</div>
            <div className="sources-grid">
              {SOURCES.map((s) => (
                <div key={s.ico} className="source-card">
                  <div className="ico">{s.ico}</div>
                  <div className="nm">{s.nm}</div>
                  <div className="ds">{s.ds}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
