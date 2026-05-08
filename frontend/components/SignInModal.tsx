// Sign-in gate modal — shown when an anon user clicks Save building, Share,
// Lease review, or any quota-gate. Sends a real Supabase magic link.

'use client';

import { useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/browser';
import { useLockBodyScroll } from '@/lib/useLockBodyScroll';

import { Mark } from './Mark';

export type SignInReason = 'save' | 'share' | 'lease' | 'gate';

const COPY: Record<SignInReason, { title: string; body: string }> = {
  save: {
    title: 'Sign in to save buildings',
    body: "We'll keep this report on your dashboard and re-check it before you sign.",
  },
  share: {
    title: 'Sign in to share',
    body: 'Generate a shareable URL that stays in sync with the latest data.',
  },
  lease: {
    title: 'Sign in to review your lease',
    body: 'Upload a lease PDF and we\'ll flag clauses that disagree with NYC tenant law.',
  },
  gate: {
    title: 'Free quota reached',
    body: "You've used your free lookups for this month. Sign in for more — no card needed.",
  },
};

export function SignInModal({
  reason,
  onClose,
}: {
  reason: SignInReason;
  onClose: () => void;
}) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => {
    try {
      return createClient();
    } catch {
      return null;
    }
  }, []);

  useLockBodyScroll();

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    if (!email.includes('@') || !supabase) return;
    setSubmitting(true);
    setError(null);
    const callbackUrl = new URL('/auth/callback', window.location.origin);
    const { error: err } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });
    setSubmitting(false);
    if (err) {
      setError(err.message);
      return;
    }
    setSent(true);
  }

  const copy = COPY[reason];

  return (
    <div className="modal-veil" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-modal-title"
      >
        <button
          type="button"
          className="close-x"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        {!sent ? (
          <>
            <div className="modal-mark">
              <Mark size={40} />
            </div>
            <h3 id="signin-modal-title">{copy.title}</h3>
            <p>{copy.body}</p>
            <input
              className="modal-input"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
            />
            <button
              type="button"
              className="btn primary full"
              disabled={!email.includes('@') || submitting || !supabase}
              onClick={send}
            >
              {submitting ? 'Sending…' : 'Send magic link'}
            </button>
            {error && (
              <p
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  fontSize: 12.5,
                  color: 'var(--bad)',
                }}
              >
                {error}
              </p>
            )}
            {!supabase && (
              <p
                style={{
                  marginTop: 10,
                  marginBottom: 0,
                  fontSize: 12.5,
                  color: 'var(--bad)',
                }}
              >
                Sign-in is not configured for this environment.
              </p>
            )}
            <div
              style={{
                textAlign: 'center',
                marginTop: 12,
                fontSize: 12,
                color: 'var(--muted)',
              }}
            >
              No password. We&apos;ll email you a one-tap sign-in link.
            </div>
          </>
        ) : (
          <>
            <div className="modal-success-icn" aria-hidden="true">
              ✓
            </div>
            <h3 id="signin-modal-title">Check your inbox</h3>
            <p>
              We sent a magic link to <b>{email}</b>. Click it to sign in —
              this tab will be ready when you come back.
            </p>
            <button type="button" className="btn primary full" onClick={onClose}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}
