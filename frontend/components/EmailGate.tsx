'use client';

import { useState, type FormEvent } from 'react';

export function EmailGate({
  message,
  onContinue,
  onBack,
}: {
  message: string;
  onContinue: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState('');
  const canContinue = email.includes('@');

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canContinue) return;
    onContinue(email.trim());
  }

  return (
    <div className="center-card screen-fade">
      <div className="card">
        <div className="center-card-icn">@</div>
        <h2>One more step</h2>
        <p>{message}</p>
        <form onSubmit={handleSubmit}>
          <input
            className="modal-input"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="Email address"
          />
          <button type="submit" className="btn primary full" disabled={!canContinue}>
            Continue
          </button>
        </form>
        <button className="btn ghost full" onClick={onBack} type="button">
          Back to search
        </button>
      </div>
    </div>
  );
}
