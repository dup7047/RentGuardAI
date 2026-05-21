'use client';

import { useState, useTransition } from 'react';

import { deleteAccountAction } from '../actions';

type State =
  | { kind: 'idle' }
  | { kind: 'confirming' }
  | { kind: 'success'; at: string }
  | { kind: 'error'; reason: 'auth' | 'error' };

export function DeleteAccountSection() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [pending, startTransition] = useTransition();

  const onConfirm = () => {
    startTransition(async () => {
      const result = await deleteAccountAction();
      if (result.ok) {
        setState({ kind: 'success', at: result.deletion_requested_at });
      } else {
        setState({ kind: 'error', reason: result.reason });
      }
    });
  };

  if (state.kind === 'success') {
    return (
      <div className="finding" style={{ marginTop: 16 }}>
        <div className="icn good" aria-hidden="true">
          ✓
        </div>
        <div className="body">
          <b>Account marked for deletion</b>
          <span>
            Check your inbox for a confirmation email with a 30-day undo link.
          </span>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="finding" style={{ marginTop: 16 }}>
        <div className="icn bad" aria-hidden="true">
          !
        </div>
        <div className="body">
          <b>We could not process that.</b>
          <span>
            {state.reason === 'auth'
              ? 'Sign in again and try once more.'
              : 'Try again, or email hello@rentguard.cc if it keeps failing.'}
          </span>
        </div>
      </div>
    );
  }

  if (state.kind === 'confirming') {
    return (
      <div style={{ marginTop: 16 }}>
        <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
          Are you sure? You will have 30 days to undo from the confirmation email.
        </p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button
            type="button"
            className="btn primary"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? 'Deleting…' : 'Yes, delete my account'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => setState({ kind: 'idle' })}
            disabled={pending}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        className="btn ghost"
        onClick={() => setState({ kind: 'confirming' })}
      >
        Delete account
      </button>
    </div>
  );
}
