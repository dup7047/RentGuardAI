'use client';

// Hooks into the `rentguard:request-slow` / `rentguard:request-slow-end`
// events emitted by `fetchWithRetry` in `lib/api/backend.ts`. Returns true
// while at least one in-flight request has crossed the 5s threshold — the
// UI uses that to render the "Warming up… first request takes a sec" copy
// during Render free-tier cold starts.

import { useEffect, useState } from 'react';

export function useColdStartHint(): boolean {
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onSlow = () => setPending((n) => n + 1);
    const onSlowEnd = () => setPending((n) => Math.max(0, n - 1));
    window.addEventListener('rentguard:request-slow', onSlow);
    window.addEventListener('rentguard:request-slow-end', onSlowEnd);
    return () => {
      window.removeEventListener('rentguard:request-slow', onSlow);
      window.removeEventListener('rentguard:request-slow-end', onSlowEnd);
    };
  }, []);

  return pending > 0;
}
