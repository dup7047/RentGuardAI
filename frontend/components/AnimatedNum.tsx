// Count-up animation wrapper for indicator values. Ported from prototype.
// Preserves any non-numeric prefix/suffix (e.g. "$" or "/mo" or "#82").

'use client';

import { useEffect, useState } from 'react';

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setVal(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

export function AnimatedNum({ value }: { value: string | number }) {
  const str = String(value);
  const num = parseInt(str.replace(/[^\d]/g, ''), 10);

  // Always render via the hook to keep hooks call order stable across re-renders.
  // When the input has no digits we'll just discard the animation result and
  // render the original string.
  const animated = useCountUp(Number.isFinite(num) ? num : 0, 900);

  if (!Number.isFinite(num)) return <>{str}</>;

  const prefix = str.match(/^[^\d]*/)?.[0] ?? '';
  const suffix = str.match(/[^\d]*$/)?.[0] ?? '';
  return (
    <>
      {prefix}
      {animated}
      {suffix}
    </>
  );
}
