import type { Metadata } from 'next';

import { LegalDoc } from '@/components/LegalDoc';
import { LegalFooter } from '@/components/LegalFooter';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Disclaimers — RentGuard NYC',
  description:
    'Disclaimer language for RentGuard NYC building reports, AI summaries, public records, and affiliate disclosures.',
  alternates: { canonical: '/legal/disclaimer' },
};

export default function DisclaimerPage() {
  return (
    <div className="screen-fade">
      <div className="container" style={{ paddingTop: 48, paddingBottom: 40 }}>
        <div className="legal-page">
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            <span className="ico" aria-hidden="true">§</span>
            Legal
          </div>
          <div className="card panel">
            <LegalDoc slug="disclaimer" />
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
