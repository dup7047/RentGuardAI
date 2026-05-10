'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

type FormState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

type Mode = 'password' | 'signup' | 'magic';

// Matches `minimum_password_length` in supabase/config.toml so signup
// validation fails client-side before Supabase rejects with a confusing
// server-side error.
const MIN_PASSWORD_LENGTH = 12;

const TITLE: Record<Mode, string> = {
  password: 'Sign in',
  signup: 'Create your account',
  magic: 'Sign in with email',
};

const COPY: Record<Mode, string> = {
  password: 'Use your email and password to reach your renter dashboard.',
  signup: 'Set up an email and password to save buildings to your dashboard.',
  magic: 'Use a magic link to reach your renter dashboard. No password needed.',
};

export function LoginForm() {
  const router = useRouter();
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
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: '',
  });

  const redirectedFromDashboard = searchParams.get('redirectTo') === '/dashboard';
  const loggedOut = searchParams.get('loggedOut') === '1';
  const authError = searchParams.get('authError');
  const resetSuccess = searchParams.get('reset') === 'success';

  // Use the bare /auth/callback URL (no query string). Supabase only
  // accepts URLs that exactly match `additional_redirect_urls` in the
  // allow-list; if it doesn't match, GoTrue silently strips the path
  // back to site_url, breaking the round-trip. The /auth/callback route
  // always redirects to /dashboard, which is the only authenticated page
  // we currently gate, so a query-string `?next=` isn't actually needed.
  function buildCallbackUrl() {
    return new URL('/auth/callback', window.location.origin).toString();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (formState.status === 'loading') return;
    if (!supabaseState.client) {
      setFormState({ status: 'idle', message: '' });
      return;
    }

    if (mode === 'password') {
      setFormState({ status: 'loading', message: 'Signing you in...' });
      const { error } = await supabaseState.client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) {
        setFormState({ status: 'error', message: error.message });
        return;
      }
      setFormState({ status: 'success', message: 'Signed in. Redirecting...' });
      router.push('/dashboard');
      router.refresh();
      return;
    }

    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setFormState({
          status: 'error',
          message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        });
        return;
      }
      if (password !== confirmPassword) {
        setFormState({ status: 'error', message: 'Passwords do not match.' });
        return;
      }

      setFormState({ status: 'loading', message: 'Creating your account...' });
      const { data, error } = await supabaseState.client.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: buildCallbackUrl() },
      });
      if (error) {
        setFormState({ status: 'error', message: error.message });
        return;
      }
      // If the project has email confirmations disabled, signUp returns a
      // session and we can route straight to the dashboard. If confirmations
      // are required, session is null and the user has to click the email
      // link before logging in.
      if (data.session) {
        setFormState({
          status: 'success',
          message: 'Account created. Redirecting...',
        });
        router.push('/dashboard');
        router.refresh();
        return;
      }
      setFormState({
        status: 'success',
        message: `Check ${email} for a confirmation link to finish signing up.`,
      });
      return;
    }

    // Magic link mode.
    setFormState({ status: 'loading', message: 'Sending your magic link...' });
    const { error } = await supabaseState.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: buildCallbackUrl(),
        shouldCreateUser: true,
      },
    });

    if (error) {
      setFormState({ status: 'error', message: error.message });
      return;
    }

    setFormState({
      status: 'success',
      message: `Check ${email} for your RentGuard sign-in link.`,
    });
  }

  function switchMode(next: Mode) {
    setMode(next);
    setConfirmPassword('');
    setFormState({ status: 'idle', message: '' });
  }

  const showPasswordField = mode === 'password' || mode === 'signup';
  const submitLabel =
    formState.status === 'loading'
      ? mode === 'magic'
        ? 'Sending...'
        : mode === 'signup'
          ? 'Creating...'
          : 'Signing in...'
      : mode === 'magic'
        ? 'Email me a magic link'
        : mode === 'signup'
          ? 'Create account'
          : 'Sign in';

  return (
    <form className="auth-panel" onSubmit={handleSubmit}>
      <div>
        <p className="eyebrow">RentGuard account</p>
        <h1>{TITLE[mode]}</h1>
        <p className="auth-copy">{COPY[mode]}</p>
      </div>

      {redirectedFromDashboard ? (
        <p className="notice">Sign in first to view your dashboard.</p>
      ) : null}
      {loggedOut ? <p className="notice">You have been signed out.</p> : null}
      {authError ? (
        <p className="notice error">That sign-in link could not be verified.</p>
      ) : null}
      {resetSuccess ? (
        <p className="notice">
          Password updated. Sign in with your new password.
        </p>
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

      {showPasswordField ? (
        <label className="field" htmlFor="password">
          <span>Password</span>
          <input
            id="password"
            name="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
            required
          />
        </label>
      ) : null}

      {mode === 'password' ? (
        <Link className="link-button" href="/forgot-password">
          Forgot your password?
        </Link>
      ) : null}

      {mode === 'signup' ? (
        <label className="field" htmlFor="confirmPassword">
          <span>Confirm password</span>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
      ) : null}

      <button
        className="primary-button"
        type="submit"
        disabled={formState.status === 'loading'}
      >
        {submitLabel}
      </button>

      <button
        type="button"
        className="link-button"
        onClick={() => switchMode(mode === 'signup' ? 'password' : 'signup')}
      >
        {mode === 'signup'
          ? 'Already have an account? Sign in'
          : "Don't have an account? Sign up"}
      </button>

      {mode !== 'signup' ? (
        <button
          type="button"
          className="link-button"
          onClick={() => switchMode(mode === 'magic' ? 'password' : 'magic')}
        >
          {mode === 'magic'
            ? 'Use password instead'
            : 'Use a magic link instead'}
        </button>
      ) : null}

      {supabaseState.error ? (
        <p className="form-message error">{supabaseState.error}</p>
      ) : null}

      {formState.message ? (
        <p className={`form-message ${formState.status}`}>{formState.message}</p>
      ) : null}
    </form>
  );
}
