import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { ShareCard } from '@/components/ShareCard';

const shareMock = vi.fn();
const writeTextMock = vi.fn();

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  shareMock.mockReset().mockResolvedValue(undefined);
  writeTextMock.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', {
    share: shareMock,
    clipboard: { writeText: writeTextMock },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('ShareCard', () => {
  it('renders with "Share this report" initially', () => {
    render(<ShareCard url="https://x.test" title="t" />);
    expect(screen.getByRole('button', { name: 'Share this report' })).toBeTruthy();
  });

  it('calls navigator.share with the expected payload when supported', async () => {
    render(
      <ShareCard url="https://x.test/path" title="My title" text="My text" />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flushMicrotasks();
    });
    expect(shareMock).toHaveBeenCalledWith({
      url: 'https://x.test/path',
      title: 'My title',
      text: 'My text',
    });
    expect(writeTextMock).not.toHaveBeenCalled();
  });

  it('falls back to clipboard when navigator.share is missing and shows "Link copied!"', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    });
    render(<ShareCard url="https://copy.test" title="t" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flushMicrotasks();
    });
    expect(writeTextMock).toHaveBeenCalledWith('https://copy.test');
    expect(screen.getByRole('button').textContent).toBe('Link copied!');
  });

  it('reverts the label to "Share this report" after 2 seconds', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', {
      clipboard: { writeText: writeTextMock },
    });
    render(<ShareCard url="https://copy.test" title="t" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flushMicrotasks();
    });
    expect(screen.getByRole('button').textContent).toBe('Link copied!');
    await act(async () => {
      vi.advanceTimersByTime(2000);
      await flushMicrotasks();
    });
    expect(screen.getByRole('button').textContent).toBe('Share this report');
  });

  it('shows error state when neither share nor clipboard is available', async () => {
    vi.stubGlobal('navigator', {});
    render(<ShareCard url="https://x.test" title="t" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flushMicrotasks();
    });
    expect(screen.getByRole('button').textContent).toBe(
      "Couldn't share — try again",
    );
  });

  it('swallows AbortError silently (no error state)', async () => {
    vi.useFakeTimers();
    const abortErr = new Error('cancelled');
    abortErr.name = 'AbortError';
    shareMock.mockRejectedValueOnce(abortErr);
    render(<ShareCard url="https://x.test" title="t" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
      await flushMicrotasks();
    });
    expect(shareMock).toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2500);
      await flushMicrotasks();
    });
    expect(screen.getByRole('button').textContent).toBe('Share this report');
  });
});
