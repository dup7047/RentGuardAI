import type { Metadata } from 'next';

import { LegalDoc } from '@/components/LegalDoc';
import { LegalFooter } from '@/components/LegalFooter';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Disclaimers — RentGuard NYC',
  description:
    'Master disclaimer language for RentGuard NYC, including building risk reports, lease reviews, FARE Act checks, and affiliate disclosures.',
  alternates: { canonical: '/legal/disclaimer' },
};

export default function DisclaimerPage() {
  return (
    <div className="screen-fade">
      <div className="container" style={{ paddingTop: 48, paddingBottom: 40 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          <span className="ico" aria-hidden="true">§</span>
          Legal
        </div>
        <div className="card panel">
          <LegalDoc slug="disclaimer" />
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
