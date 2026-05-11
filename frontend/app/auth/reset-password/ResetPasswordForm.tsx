'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { EmailOtpType } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/browser';

type VerifyState =
  | { status: 'verifying' }
  | { status: 'ready' }
  | { status: 'expired' };

type SubmitState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

// Matches `minimum_password_length` in supabase/config.toml so the form
// surfaces validation errors before they hit Supabase.
const MIN_PASSWORD_LENGTH = 12;

function ExpiredLink() {
  return (
    <div className="auth-panel">
      <div>
        <p className="eyebrow">RentGuard account</p>
        <h1>This link is no longer valid</h1>
        <p className="auth-copy">
          Password reset links expire and can only be used once. Request a new
          one to continue.
        </p>
      </div>
      <Link className="primary-button" href="/forgot-password">
        Request a new link
      </Link>
      <Link className="link-button" href="/login">
        Back to sign in
      </Link>
    </div>
  );
}

export function ResetPasswordForm({
  tokenHash,
  type,
}: {
  tokenHash: string | undefined;
  type: string | undefined;
}) {
  const router = useRouter();
  const supabaseState = useMemo(() => {
    try {
      return { client: createClient(), error: '' };
    } catch (error) {
      return {
        client: null,
        error:
          error instanceof Error
            ? error.message
            : 'Supabase Auth is not configured.',
      };
    }
  }, []);

  const [verifyState, setVerifyState] = useState<VerifyState>(() =>
    tokenHash && type === 'recovery'
      ? { status: 'verifying' }
      : { status: 'expired' },
  );
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitState, setSubmitState] = useState<SubmitState>({
    status: 'idle',
    message: '',
  });

  useEffect(() => {
    // verifyOtp must run on the browser so the resulting session cookie is
    // actually persisted — Next.js silently discards cookies set inside a
    // Server Component, which would leave the subsequent updateUser call
    // with no session.
    if (verifyState.status !== 'verifying') return;
    if (!tokenHash || type !== 'recovery') return;
    if (!supabaseState.client) {
      setVerifyState({ status: 'expired' });
      return;
    }

    let cancelled = false;
    void (async () => {
      const { error } = await supabaseState.client!.auth.verifyOtp({
        token_hash: tokenHash,
        type: type as EmailOtpType,
      });
      if (cancelled) return;
      setVerifyState({ status: error ? 'expired' : 'ready' });
    })();
    return () => {
      cancelled = true;
    };
  }, [verifyState.status, tokenHash, type, supabaseState.client]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitState.status === 'loading') return;
    if (!supabaseState.client) return;

    if (password.length < MIN_PASSWORD_LENGTH) {
      setSubmitState({
        status: 'error',
        message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      });
      return;
    }
    if (password !== confirmPassword) {
      setSubmitState({ status: 'error', message: 'Passwords do not match.' });
      return;
    }

    setSubmitState({ status: 'loading', message: 'Updating your password...' });
    const { error } = await supabaseState.client.auth.updateUser({ password });
    if (error) {
      setSubmitState({ status: 'error', message: error.message });
      return;
    }

    // Sign out the recovery session so the user must re-authenticate with
    // their new password — prevents the recovery link from acting as a
    // long-lived session.
    await supabaseState.client.auth.signOut();
    setSubmitState({
      status: 'success',
      message: 'Password updated. Redirecting...',
    });
    router.replace('/login?reset=success');
  }

  if (verifyState.status === 'expired') {
    return <ExpiredLink />;
  }

  if (verifyState.status === 'verifying') {
    return (
      <div className="auth-panel">
        <div>
          <p className="eyebrow">RentGuard account</p>
          <h1>Verifying your link…</h1>
          <p className="auth-copy">One moment while we check your reset link.</p>
        </div>
      </div>
    );
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">RentGuard account</p>
        <h1>Choose a new password</h1>
        <p className="auth-copy">
          Pick a password you haven&apos;t used before. We&apos;ll sign you in
          with it from here on.
        </p>
      </div>

      <label className="field" htmlFor="password">
        <span>New password</span>
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>

      <label className="field" htmlFor="confirmPassword">
        <span>Confirm new password</span>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </label>

      <button
        className="primary-button"
        type="submit"
        disabled={submitState.status === 'loading'}
      >
        {submitState.status === 'loading' ? 'Updating...' : 'Update password'}
      </button>

      {supabaseState.error ? (
        <p className="form-message error">{supabaseState.error}</p>
      ) : null}

      {submitState.message && submitState.status !== 'loading' ? (
        <p className={`form-message ${submitState.status}`}>
          {submitState.message}
        </p>
      ) : null}
    </form>
  );
}
