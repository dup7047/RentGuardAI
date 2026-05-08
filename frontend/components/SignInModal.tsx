// Sign-in gate modal — shown when an anon user clicks Save building, Share,
// Lease review, or any quota-gate. Defaults to email + password; can switch
// to magic link or sign up.

'use client';

import { useEffect, useMemo, useState } from 'react';

import { createClient } from '@/lib/supabase/browser';
import { useLockBodyScroll } from '@/lib/useLockBodyScroll';

import { Mark } from './Mark';

export type SignInReason = 'save' | 'share' | 'lease' | 'gate';

type Mode = 'password' | 'signup' | 'magic';

const MIN_PASSWORD_LENGTH = 8;

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

const SIGNUP_COPY: Record<SignInReason, { title: string; body: string }> = {
  save: {
    title: 'Create an account to save buildings',
    body: "We'll keep this report on your dashboard and re-check it before you sign.",
  },
  share: {
    title: 'Create an account to share',
    body: 'Generate a shareable URL that stays in sync with the latest data.',
  },
  lease: {
    title: 'Create an account to review your lease',
    body: "Upload a lease PDF and we'll flag clauses that disagree with NYC tenant law.",
  },
  gate: {
    title: 'Create an account to keep going',
    body: "You've used your free lookups for this month. Sign up for more — no card needed.",
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
  const [confirmPassword, setConfirmPassword] = useState('');
  const [sentMessage, setSentMessage] = useState<string | null>(null);
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

    if (mode === 'password' || mode === 'signup') {
      if (password.length === 0) return;
    }
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    setError(null);

    const callbackUrl = new URL('/auth/callback', window.location.origin);

    if (mode === 'password') {
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

    if (mode === 'signup') {
      const { data, error: err } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl.toString() },
      });
      setSubmitting(false);
      if (err) {
        setError(err.message);
        return;
      }
      // If the project has email confirmations disabled, signUp returns a
      // session and the parent's auth listener will fire SIGNED_IN; close.
      // If confirmations are required, session is null and we surface the
      // inbox message so the user knows to click the email link.
      if (data.session) {
        onClose();
        return;
      }
      setSentMessage(
        `We sent a confirmation link to ${email}. Click it to finish signing up — this tab will be ready when you come back.`,
      );
      return;
    }

    // Magic link
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
    setSentMessage(
      `We sent a magic link to ${email}. Click it to sign in — this tab will be ready when you come back.`,
    );
  }

  function switchMode(next: Mode) {
    setMode(next);
    setConfirmPassword('');
    setError(null);
  }

  const copy = mode === 'signup' ? SIGNUP_COPY[reason] : COPY[reason];
  const showPasswordField = mode === 'password' || mode === 'signup';
  const passwordValid = mode === 'magic' || password.length > 0;
  const canSubmit =
    email.includes('@') && passwordValid && !submitting && Boolean(supabase);

  const submitLabel = submitting
    ? mode === 'magic'
      ? 'Sending…'
      : mode === 'signup'
        ? 'Creating…'
        : 'Signing in…'
    : mode === 'magic'
      ? 'Send magic link'
      : mode === 'signup'
        ? 'Create account'
        : 'Sign in';

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
        {!sentMessage ? (
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
            {showPasswordField ? (
              <input
                className="modal-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Password"
                autoComplete={
                  mode === 'signup' ? 'new-password' : 'current-password'
                }
                minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              />
            ) : null}
            {mode === 'signup' ? (
              <input
                className="modal-input"
                type="password"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-label="Confirm password"
                autoComplete="new-password"
              />
            ) : null}
            <button
              type="button"
              className="btn primary full"
              disabled={!canSubmit}
              onClick={submit}
            >
              {submitLabel}
            </button>
            <button
              type="button"
              className="link-button"
              style={{ marginTop: 8 }}
              onClick={() =>
                switchMode(mode === 'signup' ? 'password' : 'signup')
              }
            >
              {mode === 'signup'
                ? 'Already have an account? Sign in'
                : "Don't have an account? Sign up"}
            </button>
            {mode !== 'signup' ? (
              <button
                type="button"
                className="link-button"
                style={{ marginTop: 4 }}
                onClick={() =>
                  switchMode(mode === 'magic' ? 'password' : 'magic')
                }
              >
                {mode === 'magic'
                  ? 'Use password instead'
                  : 'Use a magic link instead'}
              </button>
            ) : null}
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
            <p>{sentMessage}</p>
            <button type="button" className="btn primary full" onClick={onClose}>
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}
