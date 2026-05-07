'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

type FormState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

export function LoginForm() {
  const searchParams = useSearchParams();
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

  const redirectedFromDashboard = searchParams.get('redirectTo') === '/dashboard';
  const loggedOut = searchParams.get('loggedOut') === '1';
  const authError = searchParams.get('authError');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setFormState({
      status: 'loading',
      message: 'Sending your magic link...',
    });

    if (!supabaseState.client) {
      setFormState({
        status: 'idle',
        message: '',
      });
      return;
    }

    // Use the bare /auth/callback URL (no query string). Supabase only
    // accepts URLs that exactly match `additional_redirect_urls` in the
    // allow-list; if it doesn't match, GoTrue silently strips the path
    // back to site_url, breaking the round-trip. The /auth/callback route
    // always redirects to /dashboard, which is the only authenticated page
    // we currently gate, so a query-string `?next=` isn't actually needed.
    const callbackUrl = new URL('/auth/callback', window.location.origin);

    const { error } = await supabaseState.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      setFormState({
        status: 'error',
        message: error.message,
      });
      return;
    }

    setFormState({
      status: 'success',
      message: `Check ${email} for your RentGuard sign-in link.`,
    });
  }

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">RentGuard account</p>
        <h1>Sign in with email</h1>
        <p className="auth-copy">
          Use a magic link to reach your renter dashboard. No password needed.
        </p>
      </div>

      {redirectedFromDashboard ? (
        <p className="notice">Sign in first to view your dashboard.</p>
      ) : null}
      {loggedOut ? <p className="notice">You have been signed out.</p> : null}
      {authError ? (
        <p className="notice error">That sign-in link could not be verified.</p>
      ) : null}

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

      <button className="primary-button" type="submit" disabled={formState.status === 'loading'}>
        {formState.status === 'loading' ? 'Sending...' : 'Email me a magic link'}
      </button>

      {supabaseState.error ? (
        <p className="form-message error">{supabaseState.error}</p>
      ) : null}

      {formState.message ? (
        <p className={`form-message ${formState.status}`}>{formState.message}</p>
      ) : null}
    </form>
  );
}
