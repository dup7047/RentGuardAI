'use client';

// Lookup input form. Handles all API response states:
// success → redirect to /building/[bbl]
// email_gate → show email capture
// outside_nyc → show waitlist form
// ambiguous → show address picker
// error states → inline messages

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postLookup, postWaitlistEmail, type LookupResponse } from '@/lib/api/backend';

export function LookupForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [listingDescription, setListingDescription] = useState('');
  const [showListingPaste, setShowListingPaste] = useState(false);
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [waitlistSaved, setWaitlistSaved] = useState(false);

  async function submit(extras: { email?: string } = {}) {
    setLoading(true);
    const isUrl = /^https?:\/\//i.test(input);
    const trimmedListing = listingDescription.trim();
    const r = await postLookup({
      ...(isUrl ? { listingUrl: input } : { address: input }),
      ...(trimmedListing.length > 0 ? { listingDescription: trimmedListing } : {}),
      ...extras,
    });
    setLoading(false);
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
          onKeyDown={(e) => e.key === 'Enter' && !loading && submit()}
          placeholder="NYC address or listing URL"
          aria-label="Address or listing URL"
          className="lookup-input"
        />
        <button onClick={() => submit()} disabled={loading || !input.trim()} className="lookup-btn">
          {loading ? 'Looking up…' : 'Look up'}
        </button>
      </div>

      <div className="lookup-listing-toggle">
        <button
          type="button"
          className="link-button"
          onClick={() => setShowListingPaste((v) => !v)}
        >
          {showListingPaste ? '− Hide listing copy' : '+ Paste listing copy for a critical review (optional)'}
        </button>
      </div>

      {showListingPaste && (
        <div className="lookup-listing-paste">
          <label htmlFor="listing-description">
            Paste the listing description (StreetEasy, Zillow, Craigslist, etc.):
          </label>
          <textarea
            id="listing-description"
            value={listingDescription}
            onChange={(e) => setListingDescription(e.target.value)}
            placeholder='Charming 2BR in Manhattan... No broker fee. Tenant pays utilities. No pets. $3,500/mo.'
            rows={6}
            maxLength={4000}
            className="lookup-listing-textarea"
            aria-describedby="listing-description-hint"
          />
          <p id="listing-description-hint" className="lookup-hint">
            We&apos;ll quote phrases verbatim and flag NYC-law things to verify.
            We never judge whether a listing is trustworthy. (Up to 4,000 chars.)
          </p>
        </div>
      )}

      {resp?.kind === 'requires_address' && (
        <p className="lookup-msg error">
          We could not extract an address from that URL. Paste the building address directly.
        </p>
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

      {resp?.kind === 'cost_cap' && (
        <p className="lookup-msg error">{resp.message}</p>
      )}

      {resp?.kind === 'rate_limited' && (
        <p className="lookup-msg error">{resp.message}</p>
      )}

      {resp?.kind === 'invalid_input' && (
        <p className="lookup-msg error">Please enter a valid NYC address or listing URL.</p>
      )}
    </div>
  );
}
