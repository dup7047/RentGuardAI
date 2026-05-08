import type { Metadata } from 'next';

import { LegalDoc } from '@/components/LegalDoc';
import { LegalFooter } from '@/components/LegalFooter';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Privacy Policy — RentGuard NYC',
  description:
    'How RentGuard NYC collects, uses, retains, and protects your information, including lease PDFs and building search history.',
  alternates: { canonical: '/legal/privacy' },
};

export default function PrivacyPage() {
  return (
    <div className="screen-fade">
      <div className="container" style={{ paddingTop: 48, paddingBottom: 40 }}>
        <div className="eyebrow" style={{ marginBottom: 16 }}>
          <span className="ico" aria-hidden="true">§</span>
          Legal
        </div>
        <div className="card panel">
          <LegalDoc slug="privacy" />
        </div>
      </div>
      <LegalFooter />
    </div>
  );
}
