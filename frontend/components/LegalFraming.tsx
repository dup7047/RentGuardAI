// Displayed above AI-generated building reports.
// Text sourced from docs/legal/disclaimers.md (preOutputFraming).

import { DISCLAIMERS } from '@/lib/legal/disclaimers';

export function LegalFraming() {
  return (
    <aside className="legal-framing" aria-label="AI-generated content notice">
      <p>{DISCLAIMERS.preOutputFraming}</p>
    </aside>
  );
}
