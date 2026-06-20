'use client';

// Next.js convention: fires when the root layout itself throws. Must render
// its own <html>/<body> because the layout that normally wraps the tree is
// the thing that crashed. Keep this file dependency-free for the same
// reason — no imports of components or CSS modules that themselves rely on
// the layout's providers.

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global error boundary]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          margin: 0,
          padding: '48px 24px',
          background: '#f8f9fb',
          color: '#111',
          minHeight: '100vh',
        }}
      >
        <div
          style={{
            maxWidth: 520,
            margin: '0 auto',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 32,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          <p
            style={{
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: '#6b7280',
              margin: '0 0 8px',
            }}
          >
            RentGuard NYC
          </p>
          <h1 style={{ fontSize: 22, margin: '0 0 12px' }}>
            Something went wrong.
          </h1>
          <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
            We hit an error loading the page. Try reloading. If it keeps
            happening, this is on us. Email{' '}
            <a href="mailto:hello@rentguard.cc" style={{ color: '#0a66c2' }}>
              hello@rentguard.cc
            </a>{' '}
            and we will dig in.
          </p>
          {error.digest && (
            <p
              style={{
                fontSize: 12,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                color: '#6b7280',
                margin: '0 0 16px',
              }}
            >
              Error reference: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#111',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 16px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
