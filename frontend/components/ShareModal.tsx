// Share modal — copy a deep link to this building's report.
// Email/Text/Slack buttons are placeholders matching the prototype design;
// the real Copy button uses navigator.clipboard.writeText.

'use client';

import { useEffect, useState } from 'react';

import { useLockBodyScroll } from '@/lib/useLockBodyScroll';

export function ShareModal({
  bbl,
  onClose,
}: {
  bbl: string;
  onClose: () => void;
}) {
  // Build the URL on render (window is available because this is a client
  // component). Falls back to the production domain on SSR/test.
  const url =
    typeof window !== 'undefined'
      ? `${window.location.origin}/building/${bbl}`
      : `https://rentguard.cc/building/${bbl}`;
  const [copied, setCopied] = useState(false);

  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function copy() {
    try {
      await navigator.clipboard?.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Fallback: select the input so the user can ctrl-c manually
      const input = document.getElementById('share-url-input') as HTMLInputElement | null;
      input?.select();
    }
  }

  return (
    <div className="modal-veil" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        <button
          type="button"
          className="close-x"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
        <h3 id="share-modal-title">Share this report</h3>
        <p>
          Anyone with the link can view the latest cached data — no sign-in
          required.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input
            id="share-url-input"
            className="modal-input"
            value={url}
            readOnly
            style={{
              marginBottom: 0,
              fontFamily: 'var(--font-mono), JetBrains Mono, monospace',
              fontSize: 12.5,
            }}
            aria-label="Shareable URL"
          />
          <button type="button" className="btn primary" onClick={copy}>
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn ghost full" disabled>
            ↗ Email
          </button>
          <button type="button" className="btn ghost full" disabled>
            ↗ Text
          </button>
          <button type="button" className="btn ghost full" disabled>
            ↗ Slack
          </button>
        </div>
      </div>
    </div>
  );
}
