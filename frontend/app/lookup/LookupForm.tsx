'use client';

// Lookup input form (Phase 4 — URL-first).
// One textbox accepts a URL or address. The URL path runs through the
// scraping pipeline so the AI sees concrete listing facts. Manual paste
// fallback is auto-revealed when the scrape is blocked by bot protection.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { postLookup, postWaitlistEmail, type LookupResponse } from '@/lib/api/backend';

type LoadingPhase = 'idle' | 'fetching_listing' | 'looking_up' | 'generating';

const PHASE_COPY: Record<Exclude<LoadingPhase, 'idle'>, string> = {
  fetching_listing: 'Reading the listing…',
  looking_up: 'Looking up public records…',
  generating: 'Generating your review…',
};

export function LookupForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [phase, setPhase] = useState<LoadingPhase>('idle');
  const [email, setEmail] = useState('');
  const [waitlistSaved, setWaitlistSaved] = useState(false);
  // Fallback paste — only shown when the scrape returns kind: 'listing_blocked'
  const [showFallbackPaste, setShowFallbackPaste] = useState(false);
  const [fallbackAddress, setFallbackAddress] = useState('');
  const [fallbackDescription, setFallbackDescription] = useState('');
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loading = phase !== 'idle';

  function clearPhaseTimer() {
    if (phaseTimer.current) {
      clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  }

  // Visual progressive loader — request runs as one HTTP call but a typical
  // URL-based lookup takes ~8-15s; show progress so it doesn't feel hung.
  function startProgressivePhase(initial: LoadingPhase) {
    setPhase(initial);
    if (initial === 'fetching_listing') {
      phaseTimer.current = setTimeout(() => {
        setPhase('looking_up');
        phaseTimer.current = setTimeout(() => setPhase('generating'), 5000);
      }, 6000);
    } else {
      phaseTimer.current = setTimeout(() => setPhase('generating'), 6000);
    }
  }

  useEffect(() => () => clearPhaseTimer(), []);

  async function submit(extras: { email?: string; address?: string; listingDescription?: string } = {}) {
    const isUrl = /^https?:\/\//i.test(input);
    startProgressivePhase(isUrl ? 'fetching_listing' : 'looking_up');
    const r = await postLookup({
      ...(isUrl ? { listingUrl: input } : { address: input }),
      ...extras,
    });
    clearPhaseTimer();
    setPhase('idle');
    setResp(r);
    if (r.kind === 'success') {
      router.push(`/building/${r.bbl}?fresh=1`);
    }
    if (r.kind === 'listing_blocked') {
      setShowFallbackPaste(true);
    }
  }

  async function submitFallback() {
    // User filled in address + description after a listing_blocked response.
    // Re-submit with the original URL plus the user-supplied data.
    if (!fallbackAddress.trim()) return;
    startProgressivePhase('looking_up');
    const r = await postLookup({
      listingUrl: input,
      address: fallbackAddress.trim(),
      ...(fallbackDescription.trim().length > 0
        ? { listingDescription: fallbackDescription.trim() }
        : {}),
    });
    clearPhaseTimer();
    setPhase('idle');
    setResp(r);
    if (r.kind === 'success') {
      router.push(`/building/${r.bbl}?fresh=1`);
    }
  }

  return (
    <div className="lookup-form">
      <div className="lookup-input-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && input.trim() && submit()}
          placeholder="Paste a NYC listing URL or address"
          aria-label="NYC listing URL or address"
          className="lookup-input"
        />
        <button
          onClick={() => submit()}
          disabled={loading || !input.trim()}
          className="lookup-btn"
        >
          {loading ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      {loading && (
        <p className="lookup-progress" role="status" aria-live="polite">
          {PHASE_COPY[phase as Exclude<LoadingPhase, 'idle'>]}
        </p>
      )}

      {resp?.kind === 'requires_address' && !showFallbackPaste && (
        <p className="lookup-msg error">
          We couldn&apos;t extract an address from that URL. Paste the building address directly above.
        </p>
      )}

      {resp?.kind === 'listing_not_found' && (
        <p className="lookup-msg error">
          That listing was removed or is no longer active. Try the building address.
        </p>
      )}

      {resp?.kind === 'listing_expired' && (
        <p className="lookup-msg error">
          That listing has expired. Try the building address to see records anyway.
        </p>
      )}

      {resp?.kind === 'unsupported_url' && (
        <p className="lookup-msg error">
          We don&apos;t recognize that site yet. Try a StreetEasy or Zillow URL, or paste the address.
        </p>
      )}

      {resp?.kind === 'listing_blocked' && showFallbackPaste && (
        <div className="lookup-fallback">
          <p className="lookup-msg warn">
            That listing is behind bot protection — we couldn&apos;t read it. Paste the address (and
            description if you can) and we&apos;ll generate a building review.
          </p>
          <label htmlFor="fb-address">Address:</label>
          <input
            id="fb-address"
            type="text"
            value={fallbackAddress}
            onChange={(e) => setFallbackAddress(e.target.value)}
            placeholder="123 W 23rd St New York NY"
            className="lookup-input"
          />
          <label htmlFor="fb-description">Listing description (optional):</label>
          <textarea
            id="fb-description"
            value={fallbackDescription}
            onChange={(e) => setFallbackDescription(e.target.value)}
            placeholder="Paste the listing copy here…"
            rows={5}
            maxLength={4000}
            className="lookup-listing-textarea"
          />
          <button onClick={submitFallback} disabled={loading || !fallbackAddress.trim()}>
            Continue with address
          </button>
        </div>
      )}

      {resp?.kind === 'ambiguous' && (
        <div className="lookup-ambiguous">
          <p>Multiple addresses found — which one?</p>
          {resp.matches.map((m) => (
            <button key={m.bbl} onClick={() => router.push(`/building/${m.bbl}`)}>
              {m.address} — {m.borough}
            </button>
          ))}
        </div>
      )}

      {resp?.kind === 'outside_nyc' && !waitlistSaved && (
        <form
          className="lookup-waitlist"
          onSubmit={async (e) => {
            e.preventDefault();
            await postWaitlistEmail(email);
            setWaitlistSaved(true);
          }}
        >
          <p>
            {resp.detected_city ? `${resp.detected_city} is` : 'That address is'} outside our
            coverage area. Drop your email and we&apos;ll let you know when we expand.
          </p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            aria-label="Email address for waitlist"
          />
          <button type="submit">Save my spot</button>
        </form>
      )}

      {resp?.kind === 'outside_nyc' && waitlistSaved && (
        <p className="lookup-msg success">Saved! We&apos;ll email you when we expand.</p>
      )}

      {resp?.kind === 'email_gate' && (
        <form
          className="lookup-email-gate"
          onSubmit={(e) => {
            e.preventDefault();
            submit({ email });
          }}
        >
          <p>{resp.message}</p>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            aria-label="Email address"
          />
          <button type="submit">Continue</button>
        </form>
      )}

      {resp?.kind === 'cost_cap' && <p className="lookup-msg error">{resp.message}</p>}
      {resp?.kind === 'rate_limited' && <p className="lookup-msg error">{resp.message}</p>}
      {resp?.kind === 'invalid_input' && (
        <p className="lookup-msg error">Please enter a valid NYC address or listing URL.</p>
      )}
    </div>
  );
}
