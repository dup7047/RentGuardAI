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
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [waitlistSaved, setWaitlistSaved] = useState(false);

  async function submit(extras: { email?: string } = {}) {
    setLoading(true);
    const isUrl = /^https?:\/\//i.test(input);
    const r = await postLookup({
      ...(isUrl ? { listingUrl: input } : { address: input }),
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
