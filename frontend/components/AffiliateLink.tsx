'use client';

// Affiliate CTA button with disclosure modal.
// Logs two events to /v1/affiliate/click: one on modal-open (proceeded=false)
// and one on click-through (proceeded=true). Disclosure copy is sourced
// verbatim from docs/legal/disclaimers.md (affiliateClickThrough) so the
// page audit can guarantee byte-for-byte alignment with the attorney-approved
// disclaimer.
//
// Phase 11.6: feature-flagged behind NEXT_PUBLIC_AFFILIATE_ENABLED. When the
// flag is off (v7 default), the CTA renders as a non-interactive "Coming
// soon" pill — keeps the /how-we-make-money page layout intact without
// actually opening partner traffic. The flag flips on in Phase 14.10.

import { useEffect, useState } from 'react';
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
import { postAffiliateClick } from '@/lib/api/backend';

type Partner = 'lemonade' | 'bellhop' | 'moved';

const PARTNER_LABELS: Record<Partner, string> = {
  lemonade: 'Lemonade',
  bellhop: 'Bellhop',
  moved: 'Moved',
};

function isAffiliateEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AFFILIATE_ENABLED === 'true';
}

export function AffiliateLink({
  partner,
  href,
  label,
}: {
  partner: Partner;
  href: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const enabled = isAffiliateEnabled();

  // Close on ESC. Mounted only while the dialog is open so the listener
  // does not leak when several AffiliateLink instances are on the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!enabled) {
    return (
      <span
        className="affiliate-cta is-disabled"
        aria-disabled="true"
        title="Partner CTAs go live after the soft launch."
      >
        Coming soon
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="affiliate-cta"
        onClick={() => {
          setOpen(true);
          // Modal-open is the first event. Fire-and-forget — if the network
          // request fails we still want the modal to open so the user can
          // continue manually.
          postAffiliateClick({ partner, proceeded: false }).catch(() => {});
        }}
      >
        {label}
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`affiliate-dialog-${partner}`}
          className="affiliate-modal"
          onClick={(e) => {
            // Outside-click dismiss: only when the click target is the
            // backdrop itself, not a child element of the modal.
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="affiliate-modal-card">
            <h4 id={`affiliate-dialog-${partner}`}>Before you continue</h4>
            <p>{DISCLAIMERS.affiliateClickThrough}</p>
            <div className="affiliate-modal-actions">
              <button
                type="button"
                className="btn primary"
                onClick={async () => {
                  // Log the click-through, then open the partner site in a
                  // new tab. We await the log call so the request is in
                  // flight before the user navigates away — but we don't
                  // block them if it fails.
                  await postAffiliateClick({ partner, referrerUrl: href, proceeded: true }).catch(
                    () => {},
                  );
                  window.open(href, '_blank', 'noopener,noreferrer');
                  setOpen(false);
                }}
              >
                Continue to {PARTNER_LABELS[partner]}
              </button>
              <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
