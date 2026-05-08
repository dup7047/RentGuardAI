// Sign-in gate modal — shown when an anon user clicks Save building, Share,
// Lease review, or any quota-gate. Defaults to email + password; can switch
// to magic link.

'use client';

import { useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/browser';
import { useLockBodyScroll } from '@/lib/useLockBodyScroll';

import { Mark } from './Mark';

export type SignInReason = 'save' | 'share' | 'lease' | 'gate';

type Mode = 'password' | 'magic';

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
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  async function submit() {
    if (submitting || !supabase) return;
    if (!email.includes('@')) return;
    setSubmitting(true);
    setError(null);

    if (mode === 'password') {
      if (password.length === 0) {
        setSubmitting(false);
        return;
      }
      const { error: err } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      setSubmitting(false);
      if (err) {
        setError(err.message);
        return;
      }
      // Parent components subscribe to onAuthStateChange and react to the
      // SIGNED_IN event, so just close — no router refresh needed.
      onClose();
      return;
    }

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

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
  }

  const copy = COPY[reason];
  const passwordValid = mode === 'magic' || password.length > 0;
  const canSubmit =
    email.includes('@') && passwordValid && !submitting && Boolean(supabase);

  return (
    <div
      className="modal-veil"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal"
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
              autoComplete="email"
            />
            {mode === 'password' ? (
              <input
                className="modal-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                autoComplete="current-password"
              />
            ) : null}
            <button
              type="button"
              className="btn primary full"
              disabled={!canSubmit}
              onClick={submit}
            >
              {submitting
                ? mode === 'password'
                  ? 'Signing in…'
                  : 'Sending…'
                : mode === 'password'
                  ? 'Sign in'
                  : 'Send magic link'}
            </button>
            <button
              type="button"
              className="link-button"
              style={{ marginTop: 8 }}
              onClick={() =>
                switchMode(mode === 'password' ? 'magic' : 'password')
              }
            >
              {mode === 'password'
                ? 'Use a magic link instead'
                : 'Use password instead'}
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
