// Animated character-by-character text reveal. Ported from the design prototype.
// The module-level Set ensures each unique text reveals only ONCE per page-load:
// if the user navigates away and back (soft nav within the SPA), the text
// renders instantly. A hard refresh clears the Set and re-animates.

'use client';

import { useEffect, useState } from 'react';

const REVEALED = new Set<string>();

export function RevealText({ text, speed = 14 }: { text: string; speed?: number }) {
  const alreadyRevealed = REVEALED.has(text);
  const [n, setN] = useState(alreadyRevealed ? text.length : 0);

  useEffect(() => {
    if (REVEALED.has(text)) {
      setN(text.length);
      return;
    }
    setN(0);
  }, [text]);

  useEffect(() => {
    if (n >= text.length) {
      REVEALED.add(text);
      return;
    }
    const inc = Math.max(2, Math.round(text.length / 220));
    const id = setTimeout(() => setN((v) => Math.min(text.length, v + inc)), speed);
    return () => clearTimeout(id);
  }, [n, text, speed]);

  const showCaret = n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {showCaret && (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: '.5ch',
            height: '1em',
            background: 'var(--accent)',
            verticalAlign: '-0.12em',
            marginLeft: 2,
            animation: 'fadein .4s ease both, blink 1s steps(2) infinite',
          }}
        />
      )}
    </>
  );
}
