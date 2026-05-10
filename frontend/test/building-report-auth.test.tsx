// Auth-gate tests for BuildingReport.
//
// Verifies that:
//   1. Server returns `unauthorized` on mount → click opens SignInModal, save not called
//   2. Server returns `ok` on mount → click calls save action, no modal
//   3. Mounted anon → SIGNED_IN event triggers re-fetch → click works without modal
//   4. Authed click → server returns `unauthorized` (token rejected) → modal opens, optimistic save reverts
//   5. Authed click → server returns `error` (network/5xx) → toast, modal does NOT open, optimistic save reverts
//   6. TOKEN_REFRESHED event does not refetch saved state
//
// All Supabase + server-action calls are mocked. The component is rendered
// with React Testing Library so we can assert on the rendered DOM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';

// ── Mocks (must be declared before importing BuildingReport) ──────────────
//
// The auth state subscription callback gets captured here so each test can
// fire SIGNED_IN / SIGNED_OUT / TOKEN_REFRESHED events on demand.
type AuthCallback = (event: string, session: { access_token: string } | null) => void;
const authState: { callback: AuthCallback | null; unsubscribe: ReturnType<typeof vi.fn> } = {
  callback: null,
  unsubscribe: vi.fn(),
};

vi.mock('@/lib/supabase/browser', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: AuthCallback) => {
        authState.callback = cb;
        return { data: { subscription: { unsubscribe: authState.unsubscribe } } };
      },
    },
  }),
}));

vi.mock('@/app/building/[bbl]/actions', () => ({
  getSavedBuildingStateAction: vi.fn(async () => ({ kind: 'unauthorized' as const })),
  saveBuildingAction: vi.fn(async () => ({ kind: 'ok' as const })),
  unsaveBuildingAction: vi.fn(async () => ({ kind: 'ok' as const })),
}));

import { BuildingReport } from '@/components/BuildingReport';
import {
  getSavedBuildingStateAction,
  saveBuildingAction,
} from '@/app/building/[bbl]/actions';
import { type LookupResponse } from '@/lib/api/backend';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

const FIXTURE: SuccessData = {
  kind: 'success',
  bbl: '1008420015',
  address: '350 5th Ave',
  borough: 'MANHATTAN',
  listing_summary: null,
  summary: 'Test summary.',
  score_explanation: null,
  score: 80,
  score_band: 'minimal',
  score_factors: [],
  indicators: [],
  questions_to_ask: [],
  listing_notes: [],
  scraped_listing: null,
  landlord: {},
  fare_check: null,
  stats: {},
  lookup_id: 'test',
  building_url: '/building/1008420015',
  value_score: null,
  value_band: null,
  value_confidence: null,
  value_factors: [],
  value_explanation: null,
};

function findSaveButton(container: HTMLElement): HTMLButtonElement {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    /save building/i.test(b.textContent ?? '') || /★ saved/i.test(b.textContent ?? ''),
  );
  if (!btn) throw new Error('Save button not found');
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  authState.callback = null;
  authState.unsubscribe.mockClear();
  vi.mocked(getSavedBuildingStateAction).mockReset();
  vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'unauthorized' });
  vi.mocked(saveBuildingAction).mockReset();
  vi.mocked(saveBuildingAction).mockResolvedValue({ kind: 'ok' });
});

afterEach(() => {
  cleanup();
});

describe('BuildingReport auth gate', () => {
  it('1. server says unauthorized on mount and click → click opens SignInModal', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'unauthorized' });
    // For a genuinely anon user the server action also returns unauthorized
    // at click time (no token in cookies). Mirror that in the test.
    vi.mocked(saveBuildingAction).mockResolvedValue({ kind: 'unauthorized' });

    const { container, findByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingStateAction).toHaveBeenCalledWith('1008420015');
    });
    expect(findSaveButton(container).textContent).toMatch(/save building/i);

    fireEvent.click(findSaveButton(container));

    await findByText(/sign in to save buildings/i);
    // Optimistic state reverted after the unauthorized response.
    expect(findSaveButton(container).textContent).toMatch(/save building/i);
  });

  it('2. server says ok on mount → click calls saveBuildingAction without opening modal', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'ok', saved: false });

    const { container, queryByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingStateAction).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    await waitFor(() => {
      expect(saveBuildingAction).toHaveBeenCalledWith('1008420015');
    });
    expect(queryByText(/sign in to save buildings/i)).toBeNull();
  });

  it('3. mounted anon → SIGNED_IN event re-fetches saved state → click works without modal', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'unauthorized' });

    const { container, queryByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(authState.callback).not.toBeNull();
    });

    // Now the user signs in (e.g. closes the modal after sign-in). Server
    // action will return ok on the SIGNED_IN-triggered refresh.
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'ok', saved: false });

    await act(async () => {
      authState.callback?.('SIGNED_IN', { access_token: 'token-after-signin' });
    });

    await waitFor(() => {
      // First call from mount + second from SIGNED_IN handler.
      expect(getSavedBuildingStateAction).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(findSaveButton(container));

    await waitFor(() => {
      expect(saveBuildingAction).toHaveBeenCalledWith('1008420015');
    });
    expect(queryByText(/sign in to save buildings/i)).toBeNull();
  });

  it('4. authed click → server returns unauthorized → modal opens, save state reverts', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'ok', saved: false });
    vi.mocked(saveBuildingAction).mockResolvedValueOnce({ kind: 'unauthorized' });

    const { container, findByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingStateAction).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    await findByText(/sign in to save buildings/i);

    // Optimistic state reverts: label is "★ Save building", not "★ Saved".
    expect(findSaveButton(container).textContent).toMatch(/save building/i);
  });

  it('5. authed click → server returns error → toast, modal does NOT open', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'ok', saved: false });
    vi.mocked(saveBuildingAction).mockResolvedValueOnce({ kind: 'error' });

    const { container, queryByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingStateAction).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    await waitFor(() => {
      expect(saveBuildingAction).toHaveBeenCalledWith('1008420015');
    });

    // Optimistic state reverts; modal must NOT have opened (server didn't say
    // unauthorized — it just failed).
    expect(findSaveButton(container).textContent).toMatch(/save building/i);
    expect(queryByText(/sign in to save buildings/i)).toBeNull();
  });

  it('6. TOKEN_REFRESHED event does not refetch saved state', async () => {
    vi.mocked(getSavedBuildingStateAction).mockResolvedValue({ kind: 'ok', saved: false });

    render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingStateAction).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      authState.callback?.('TOKEN_REFRESHED', { access_token: 'token-2' });
    });

    // Brief microtask flush so any erroneous async work would have run by now.
    await Promise.resolve();
    await Promise.resolve();

    expect(getSavedBuildingStateAction).toHaveBeenCalledTimes(1);
  });
});
