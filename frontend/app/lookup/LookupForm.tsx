'use client';

// Interactive search form — client boundary.
// Static hero content (eyebrow, h1, hero-sub, trust pill, sources strip) lives
// in the server-rendered page.tsx so it ships as plain HTML with no JS cost.
//
// "Takeover" states (loading, outside_nyc, ambiguous, email_gate) render via a fixed
// full-viewport overlay so the server-rendered hero behind them is hidden.

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { AddressSuggestions } from '@/components/AddressSuggestions';
import { Ambiguous } from '@/components/Ambiguous';
import { EmailGate } from '@/components/EmailGate';
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

const AUTOCOMPLETE_DEBOUNCE_MS = 180;
const AUTOCOMPLETE_MIN_LEN = 3;

// Shown when the stream itself fails (network drop, retries exhausted). Kept
// distinct from `invalid_input` so the user isn't told their address is wrong
// when the real problem is connectivity.
const NETWORK_FAILURE: LookupResponse = {
  kind: 'server_error',
  message: 'We could not reach the report service. Check your connection and try again.',
};

type LookupSuccess = Extract<LookupResponse, { kind: 'success' }>;

function rememberFreshReport(report: LookupSuccess) {
  try {
    window.sessionStorage.setItem(
      `rentguard:fresh-report:${report.bbl}`,
      JSON.stringify(report),
    );
  } catch {
    // Session storage is best-effort; the report route still fetches by BBL.
  }
}

export function LookupForm() {
  const router = useRouter();
  // Seed the input from ?q= so the schema.org SearchAction deep-link
  // (target=https://www.rentguard.cc/?q={search_term_string}) actually
  // pre-fills the search box. User still presses Enter to run the lookup.
  const searchParams = useSearchParams();
  const [input, setInput] = useState(() => searchParams?.get('q') ?? '');
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<LookupPhase | null>(null);
  const [pickedBbl, setPickedBbl] = useState<string | null>(null);
  const [showFallbackPaste, setShowFallbackPaste] = useState(false);
  const [fallbackAddress, setFallbackAddress] = useState('');
  const [fallbackDescription, setFallbackDescription] = useState('');

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

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
      } catch {
        // AbortError (stale debounce) or an unexpected throw — either way the
        // dropdown just stays as-is. Rethrowing here would surface as an
        // unhandled rejection since we're inside a timer callback.
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
  }, [input]);

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

  async function submit(
    extras: {
      address?: string;
      listingDescription?: string;
      addressOverride?: string;
      bblOverride?: string;
      email?: string;
    } = {},
  ) {
    const value = extras.addressOverride ?? input;
    const isUrl = !extras.addressOverride && /^https?:\/\//i.test(value);
    const bblToForward = extras.bblOverride ?? (!isUrl ? pickedBbl : null);
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
          ...(extras.listingDescription
            ? { listingDescription: extras.listingDescription }
            : {}),
          ...(extras.email ? { email: extras.email } : {}),
          ...(bblToForward ? { bbl: bblToForward } : {}),
        },
        (p) => setPhase(p),
      );
    } catch {
      r = NETWORK_FAILURE;
    }
    if (r.kind === 'success') {
      rememberFreshReport(r);
      router.push(`/building/${r.bbl}?fresh=1`);
      return;
    }
    setLoading(false);
    setResp(r);
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
      r = NETWORK_FAILURE;
    }
    if (r.kind === 'success') {
      rememberFreshReport(r);
      router.push(`/building/${r.bbl}?fresh=1`);
      return;
    }
    setLoading(false);
    setResp(r);
  }

  function reset() {
    setResp(null);
    setShowFallbackPaste(false);
    setFallbackAddress('');
    setFallbackDescription('');
  }

  function handlePick(s: AddressSuggestion) {
    setInput(s.display);
    setPickedBbl(s.bbl);
    setShowSuggestions(false);
    setSuggestions([]);
    setActiveIndex(-1);
    void submit({ addressOverride: s.display, bblOverride: s.bbl });
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

  // Full-page takeover states — rendered in a fixed overlay so they cover
  // the server-rendered hero content sitting behind this client boundary.
  if (loading) {
    return (
      <div className="lookup-overlay">
        <Loading phase={phase} />
      </div>
    );
  }
  if (resp?.kind === 'outside_nyc') {
    return (
      <div className="lookup-overlay">
        <OutsideNyc
          detectedCity={resp.detected_city}
          detectedState={resp.detected_state}
          onBack={reset}
        />
      </div>
    );
  }
  if (resp?.kind === 'ambiguous') {
    return (
      <div className="lookup-overlay">
        <Ambiguous
          matches={resp.matches}
          onPick={(match) => {
            void submit({ addressOverride: match.address, bblOverride: match.bbl });
          }}
          onBack={reset}
        />
      </div>
    );
  }
  if (resp?.kind === 'email_gate') {
    return (
      <div className="lookup-overlay">
        <EmailGate
          message={resp.message}
          onContinue={(email) => {
            void submit({ email });
          }}
          onBack={reset}
        />
      </div>
    );
  }

  const activeId =
    showSuggestions && activeIndex >= 0 ? `addr-opt-${activeIndex}` : undefined;

  return (
    <div className="search-card-wrap" ref={wrapRef}>
      <div className="search-card">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (pickedBbl) setPickedBbl(null);
          }}
          onKeyDown={onInputKeyDown}
          onFocus={() => {
            if (suggestions.length > 0 && !/^https?:\/\//i.test(input)) {
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

      {/* Inline error banners */}
      {resp?.kind === 'requires_address' && !showFallbackPaste && (
        <p className="lookup-msg error">
          We couldn&apos;t extract an address from that URL. Paste the building
          address directly above.
        </p>
      )}
      {resp?.kind === 'listing_not_found' && (
        <p className="lookup-msg error">
          That listing was removed or is no longer active. Try the building
          address.
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
      {resp?.kind === 'server_error' && (
        <p className="lookup-msg error">
          We hit a server error while building this report. Please try again in
          a minute.
        </p>
      )}

      {resp?.kind === 'listing_blocked' && showFallbackPaste && (
        <div className="lookup-fallback">
          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              color: 'oklch(0.45 0.13 70)',
            }}
          >
            That listing is behind bot protection, so we couldn&apos;t read it.
            Paste the address (and description if you can) and we&apos;ll
            generate a building review.
          </p>
          <label htmlFor="fb-address">Address</label>
          <input
            id="fb-address"
            type="text"
            value={fallbackAddress}
            onChange={(e) => setFallbackAddress(e.target.value)}
            placeholder="123 W 23rd St, New York, NY"
          />
          <label htmlFor="fb-description">
            Listing description (optional)
          </label>
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

      {resp?.kind === 'signup_gate' && (
        <div className="lookup-signup-gate">
          <p style={{ margin: 0, fontSize: 13.5 }}>{resp.message}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn primary" href="/login?mode=signup">
              Create free account
            </Link>
            <Link className="btn ghost" href="/login">
              Sign in
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
