// Site-wide legal footer shown on building report pages.
// Text sourced from docs/legal/disclaimers.md (weAreNotFooter).

import { DISCLAIMERS } from '@/lib/legal/disclaimers';

export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal disclosures">
      <p>{DISCLAIMERS.weAreNotFooter}</p>
    </footer>
  );
}
