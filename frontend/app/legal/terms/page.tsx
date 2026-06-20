import type { Metadata } from 'next';

import { LegalDoc } from '@/components/LegalDoc';
import { LegalFooter } from '@/components/LegalFooter';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Terms of Service | RentGuard NYC',
  description:
    'The Terms of Service governing your use of RentGuard NYC building reports, accounts, acceptable use, and dispute resolution.',
  alternates: { canonical: '/legal/terms' },
};

export default function TermsPage() {
  return (
    <div className="screen-fade">
      <div className="container" style={{ paddingTop: 48, paddingBottom: 40 }}>
        <div className="legal-page">
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            <span className="ico" aria-hidden="true">§</span>
            Legal
          </div>
          <div className="card panel">
            <LegalDoc slug="terms" />
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
