'use client';

// Affiliate CTA button with disclosure modal.
// Logs click events to backend; shows FARE Act affiliate disclaimer before redirect.
// Text sourced from docs/legal/disclaimers.md (affiliateClickThrough).

import { useState } from 'react';
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
import { postAffiliateClick } from '@/lib/api/backend';

type Partner = 'lemonade' | 'bellhop' | 'moved';

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

  return (
    <>
      <button
        className="affiliate-cta"
        onClick={() => {
          setOpen(true);
          postAffiliateClick({ partner, proceeded: false }).catch(() => {});
        }}
      >
        {label}
      </button>
      {open && (
        <div role="dialog" aria-modal="true" className="affiliate-modal">
          <p>{DISCLAIMERS.affiliateClickThrough}</p>
          <button
            onClick={async () => {
              await postAffiliateClick({ partner, referrerUrl: href, proceeded: true });
              window.open(href, '_blank', 'noopener,noreferrer');
              setOpen(false);
            }}
          >
            Continue
          </button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}
