// Verifies the Loading component's two modes:
//   - Controlled: `phase` prop drives the TARGET step; the visible step
//     advances toward it with a minimum dwell so cache-hit lookups don't
//     flash through.
//   - Uncontrolled: internal timer fallback (drop-in compat with old callers).

import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

import { Loading } from '@/components/Loading';

afterEach(() => {
  cleanup();
});

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
    for (let i = 1; i < 6; i += 1) {
      expect(classes[i]).not.toContain('active');
      expect(classes[i]).not.toContain('done');
    }
  });

  it('initially holds on step 0 even when phase jumps ahead (min dwell)', () => {
    // The user wanted phases to NOT skip — even if the parent renders us
    // already at phase=geo, we should briefly show step 0 first.
    const { container } = render(<Loading phase="geo" />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
    expect(classes[0]).not.toContain('done');
    expect(classes[1]).not.toContain('active');
  });

  it('eventually advances to the target step after the dwell', async () => {
    const { container } = render(<Loading phase="geo" />);
    // The first dwell is 380 ms; allow up to 1500 ms for the advance.
    await waitFor(
      () => {
        const classes = getStepClasses(container);
        expect(classes[0]).toContain('done');
        expect(classes[1]).toContain('active');
      },
      { timeout: 1500 },
    );
  });

  it('treats null phase as "step 0 active" (just-submitted state)', () => {
    const { container } = render(<Loading phase={null} />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
    expect(classes[1]).not.toContain('active');
    expect(classes[1]).not.toContain('done');
  });

  it('progress bar at 100% when controlled mode reaches the ai step', async () => {
    const { container } = render(<Loading phase="ai" />);
    // Each step has min dwell ~700 ms (first is 380 ms). Advancing 5 steps
    // takes ~3.2 s; allow some headroom.
    await waitFor(
      () => {
        const bar = container.querySelector('.progress-bar') as HTMLElement | null;
        expect(bar?.style.width).toBe('100%');
      },
      { timeout: 6000 },
    );
    const classes = getStepClasses(container);
    for (let i = 0; i < 5; i += 1) {
      expect(classes[i]).toContain('done');
    }
    expect(classes[5]).toContain('active');
    expect(classes[5]).not.toContain('done');
  }, 8000);
});

describe('Loading (uncontrolled timer fallback)', () => {
  it('starts with step 0 active when no phase prop is passed', () => {
    const { container } = render(<Loading />);
    const classes = getStepClasses(container);
    expect(classes[0]).toContain('active');
  });
});
