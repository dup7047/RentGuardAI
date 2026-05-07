// Outside-NYC card — shown when the backend returns kind='outside_nyc'.
// Captures the user's email for the waitlist via /v1/waitlist/email.

'use client';

import { useState, type FormEvent } from 'react';

import { postWaitlistEmail } from '@/lib/api/backend';

export function OutsideNyc({
  detectedCity,
  detectedState,
  onBack,
}: {
  detectedCity: string | null;
  detectedState: string | null;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const cityLabel = detectedCity || 'Unknown';
  const stateLabel = detectedState || 'Unknown';

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.includes('@')) return;
    setSubmitting(true);
    try {
      await postWaitlistEmail(email);
      setDone(true);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="center-card screen-fade">
      <div className="card">
        <div className="center-card-icn">🗺</div>
        <h2>Outside our coverage</h2>
        <p>
          RentGuard only covers <b>New York City</b> right now. We&apos;d love to
          expand — drop your email and we&apos;ll let you know when we launch{' '}
          {cityLabel !== 'Unknown' ? `in ${cityLabel}` : 'where you are'}.
        </p>
        {!done ? (
          <form onSubmit={handleSubmit}>
            <div className="detected-pill">
              <div className="label">Detected</div>
              <div className="value">
                {cityLabel}
                {stateLabel !== 'Unknown' ? `, ${stateLabel}` : ''}
              </div>
            </div>
            <input
              className="modal-input"
              placeholder="you@example.com"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              aria-label="Email address for waitlist"
            />
            <button
              type="submit"
              className="btn primary full"
              disabled={!email.includes('@') || submitting}
            >
              {submitting ? 'Saving…' : 'Notify me when we launch'}
            </button>
          </form>
        ) : (
          <>
            <div
              style={{
                padding: '14px 16px',
                background: 'var(--good-soft)',
                color: 'var(--good)',
                borderRadius: 10,
                fontSize: 13.5,
                marginBottom: 14,
              }}
            >
              ✓ You&apos;re on the list. We&apos;ll email <b>{email}</b> when we
              expand.
            </div>
            <button className="btn ghost full" onClick={onBack} type="button">
              ← Back to search
            </button>
          </>
        )}
      </div>
    </div>
  );
}
