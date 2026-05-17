'use client';

import { useState } from 'react';

interface ShareCardProps {
  url: string;
  title: string;
  text?: string;
  className?: string;
}

export function ShareCard({ url, title, text, className }: ShareCardProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  const handleShare = async () => {
    try {
      const nav: Navigator | undefined =
        typeof navigator !== 'undefined' ? navigator : undefined;
      if (nav && typeof nav.share === 'function') {
        await nav.share({ url, title, text });
        return;
      }
      await nav!.clipboard.writeText(url);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  };

  const labels = {
    idle: 'Share this report',
    copied: 'Link copied!',
    error: "Couldn't share — try again",
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      className={className}
      aria-label={labels[state]}
    >
      {labels[state]}
    </button>
  );
}
