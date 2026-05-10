'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { createClient } from '@/lib/supabase/browser';

type FormState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

const GENERIC_SUCCESS =
  "If an account exists for that email, we've sent a link to reset your password. Check your inbox and spam folder.";

export function ForgotPasswordForm() {
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

  const [email, setEmail] = useState('');
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: '',
  });

  function buildResetRedirectUrl() {
    return new URL('/auth/reset-password', window.location.origin).toString();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (formState.status === 'loading') return;
    if (!supabaseState.client) {
      setFormState({ status: 'idle', message: '' });
      return;
    }

    setFormState({ status: 'loading', message: 'Sending reset link...' });
    // Intentionally ignore the Supabase response: we always show the same
    // generic confirmation so the form cannot be used to enumerate accounts.
    await supabaseState.client.auth.resetPasswordForEmail(email, {
      redirectTo: buildResetRedirectUrl(),
    });
    setFormState({ status: 'success', message: GENERIC_SUCCESS });
  }

  if (formState.status === 'success') {
    return (
      <div className="auth-panel">
        <div>
          <p className="eyebrow">RentGuard account</p>
          <h1>Check your email</h1>
          <p className="auth-copy">{formState.message}</p>
        </div>
        <Link className="link-button" href="/login">
          Back to sign in
        </Link>
      </div>
    );
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">RentGuard account</p>
        <h1>Forgot your password?</h1>
        <p className="auth-copy">
          Enter the email on your RentGuard account and we&apos;ll send you a
          link to choose a new password.
        </p>
      </div>

      <label className="field" htmlFor="email">
        <span>Email address</span>
        <input
          id="email"
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </label>

      <button
        className="primary-button"
        type="submit"
        disabled={formState.status === 'loading'}
      >
        {formState.status === 'loading' ? 'Sending...' : 'Send reset link'}
      </button>

      <Link className="link-button" href="/login">
        Back to sign in
      </Link>

      {supabaseState.error ? (
        <p className="form-message error">{supabaseState.error}</p>
      ) : null}

      {formState.status === 'error' && formState.message ? (
        <p className="form-message error">{formState.message}</p>
      ) : null}
    </form>
  );
}
