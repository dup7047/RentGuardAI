'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { createClient } from '@/lib/supabase/browser';

type FormState =
  | { status: 'idle'; message: string }
  | { status: 'loading'; message: string }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

// Matches `minimum_password_length` in supabase/config.toml so the form
// surfaces validation errors before they hit Supabase.
const MIN_PASSWORD_LENGTH = 12;

export function ResetPasswordForm() {
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

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [formState, setFormState] = useState<FormState>({
    status: 'idle',
    message: '',
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (formState.status === 'loading') return;
    if (!supabaseState.client) {
      setFormState({ status: 'idle', message: '' });
      return;
    }

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

    setFormState({ status: 'loading', message: 'Updating your password...' });
    const { error } = await supabaseState.client.auth.updateUser({ password });
    if (error) {
      setFormState({ status: 'error', message: error.message });
      return;
    }

    // Sign out the recovery session so the user must re-authenticate with
    // their new password — prevents the recovery link from acting as a
    // long-lived session.
    await supabaseState.client.auth.signOut();
    setFormState({
      status: 'success',
      message: 'Password updated. Redirecting...',
    });
    router.replace('/login?reset=success');
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
        disabled={formState.status === 'loading'}
      >
        {formState.status === 'loading' ? 'Updating...' : 'Update password'}
      </button>

      {supabaseState.error ? (
        <p className="form-message error">{supabaseState.error}</p>
      ) : null}

      {formState.message && formState.status !== 'loading' ? (
        <p className={`form-message ${formState.status}`}>{formState.message}</p>
      ) : null}
    </form>
  );
}
