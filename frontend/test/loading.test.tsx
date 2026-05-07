// Verifies the Loading component's two modes:
//   - Controlled: `phase` prop drives which step is active.
//   - Uncontrolled: internal timer fallback (drop-in compat with old callers).

import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { Loading } from '@/components/Loading';

afterEach(() => {
  cleanup();
});

const STEP_LABELS = [
  'Parsing your input',
  'Resolving address to BBL',
  'Pulling HPD violations & registrations',
  'Pulling DOB complaints, evictions, 311',
  'Looking up owner & watchlist match',
  'Synthesizing AI summary',
];

function getStepClasses(container: HTMLElement): string[] {
  const steps = container.querySelectorAll('.step');
  return Array.from(steps).map((el) => el.className);
}

describe('Loading (controlled)', () => {
  it('marks the parse step active when phase=parse', () => {
    const { container } = render(<Loading phase="parse" />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
    expect(classes[0]).not.toContain('done');
    for (let i = 1; i < STEP_LABELS.length; i += 1) {
      expect(classes[i]).not.toContain('active');
      expect(classes[i]).not.toContain('done');
    }
  });

  it('marks earlier steps done and current step active when phase=geo', () => {
    const { container } = render(<Loading phase="geo" />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('done');
    expect(classes[1]).toContain('active');
    expect(classes[1]).not.toContain('done');
  });

  it('puts everything done up to ai when phase=ai and pins progress at 100%', () => {
    const { container } = render(<Loading phase="ai" />);
    const classes = getStepClasses(container);
    for (let i = 0; i < 5; i += 1) {
      expect(classes[i]).toContain('done');
    }
    expect(classes[5]).toContain('active');
    expect(classes[5]).not.toContain('done');

    const bar = container.querySelector('.progress-bar') as HTMLElement | null;
    expect(bar).toBeTruthy();
    expect(bar?.style.width).toBe('100%');
  });

  it('treats null phase as "step 0 active" (just-submitted state)', () => {
    const { container } = render(<Loading phase={null} />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
    expect(classes[1]).not.toContain('active');
    expect(classes[1]).not.toContain('done');
  });
});

describe('Loading (uncontrolled timer fallback)', () => {
  it('starts with step 0 active when no phase prop is passed', () => {
    const { container } = render(<Loading />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
  });
});
