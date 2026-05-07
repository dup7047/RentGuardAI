'use client';

// Lookup landing — Phase 5 visual rebrand.
// Hero + single-input search card + trust pill + sources strip.
// Submit logic is preserved: still POSTs to /v1/lookup, still routes the
// 11 response kinds (success, requires_address, outside_nyc, ambiguous,
// email_gate, cost_cap, rate_limited, invalid_input, listing_blocked,
// listing_not_found, listing_expired, unsupported_url).

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Ambiguous } from '@/components/Ambiguous';
import { Loading } from '@/components/Loading';
import { OutsideNyc } from '@/components/OutsideNyc';
import { postLookup, type LookupResponse } from '@/lib/api/backend';

const SOURCES = [
  { ico: 'H', nm: 'HPD violations', ds: 'Open & closed code violations' },
  { ico: 'D', nm: 'DOB complaints', ds: 'Construction & safety filings' },
  { ico: 'E', nm: 'Evictions', ds: 'Marshal eviction records' },
  { ico: 'O', nm: 'Owner records', ds: 'HPD registered owner & officer' },
  { ico: 'W', nm: 'Watchlist', ds: 'Public Advocate Worst Landlord' },
] as const;

export function LookupForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  // Fallback paste — only shown when the scrape returns kind: 'listing_blocked'
  const [showFallbackPaste, setShowFallbackPaste] = useState(false);
  const [fallbackAddress, setFallbackAddress] = useState('');
  const [fallbackDescription, setFallbackDescription] = useState('');

  async function submit(extras: { email?: string; address?: string; listingDescription?: string } = {}) {
    const isUrl = /^https?:\/\//i.test(input);
    setLoading(true);
    setResp(null);
    setShowFallbackPaste(false);
    const r = await postLookup({
      ...(isUrl ? { listingUrl: input } : { address: input }),
      ...extras,
    });
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
    const r = await postLookup({
      listingUrl: input,
      address: fallbackAddress.trim(),
      ...(fallbackDescription.trim().length > 0
        ? { listingDescription: fallbackDescription.trim() }
        : {}),
    });
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

  // Top-level branches — full-screen takeovers
  if (loading) return <Loading />;
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
    return <Ambiguous matches={resp.matches} onBack={reset} />;
  }

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

          <div className="search-card">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && input.trim()) submit();
              }}
              placeholder="Paste a listing URL or NYC address…"
              aria-label="NYC listing URL or address"
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
