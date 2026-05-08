// Phase 3 gate tests for BuildingReport's auth flow.
//
// Verifies that:
//   1. Anon click → SignInModal, no save call
//   2. Authed click → save call, no modal
//   3. Anon mount → SIGNED_IN event after mount → click works without modal
//   4. Authed click → 401 from backend → modal opens, optimistic save reverts
//   5. TOKEN_REFRESHED event does not refetch saved state (regression guard
//      against the hourly-spam case the SIGNED_IN/SIGNED_OUT filter prevents)
//
// All network and Supabase calls are mocked; the component is rendered with
// React Testing Library so we can assert on the rendered DOM.

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

const sessionState: { current: { access_token: string } | null } = { current: null };

vi.mock('@/lib/auth/session', () => ({
  getCurrentSession: vi.fn(async () => sessionState.current),
}));

vi.mock('@/lib/api/backend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/backend')>();
  return {
    ...actual,
    getSavedBuildingState: vi.fn(async () => ({ saved: false })),
    saveBuilding: vi.fn(async () => ({ saved: true as const, saved_at: '2026-05-08T00:00:00Z' })),
    unsaveBuilding: vi.fn(async () => ({ saved: false as const })),
  };
});

import { BuildingReport } from '@/components/BuildingReport';
import {
  getSavedBuildingState,
  saveBuilding,
  SavedBuildingsAuthError,
  type LookupResponse,
} from '@/lib/api/backend';

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
  sessionState.current = null;
  vi.mocked(getSavedBuildingState).mockClear();
  vi.mocked(getSavedBuildingState).mockResolvedValue({ saved: false });
  vi.mocked(saveBuilding).mockClear();
  vi.mocked(saveBuilding).mockResolvedValue({
    saved: true,
    saved_at: '2026-05-08T00:00:00Z',
  });
});

afterEach(() => {
  cleanup();
});

describe('BuildingReport auth gate', () => {
  it('1. mounted anon → click opens SignInModal, save is not called', async () => {
    sessionState.current = null;
    const { container, findByText } = render(<BuildingReport data={FIXTURE} />);

    // Wait for the mount-time getCurrentSession() effect to settle.
    await waitFor(() => {
      // Anon: button label stays "★ Save building"
      expect(findSaveButton(container).textContent).toMatch(/save building/i);
    });

    fireEvent.click(findSaveButton(container));

    // Modal title comes from SignInModal copy for reason='save'
    await findByText(/sign in to save buildings/i);
    expect(saveBuilding).not.toHaveBeenCalled();
  });

  it('2. mounted with session → click calls saveBuilding without opening modal', async () => {
    sessionState.current = { access_token: 'token-abc' };
    const { container, queryByText } = render(<BuildingReport data={FIXTURE} />);

    // Wait for getSavedBuildingState fetch (only fires when authed) so we
    // know the auth-detection effect has completed.
    await waitFor(() => {
      expect(getSavedBuildingState).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    await waitFor(() => {
      expect(saveBuilding).toHaveBeenCalledWith('1008420015');
    });
    expect(queryByText(/sign in to save buildings/i)).toBeNull();
  });

  it('3. mounted anon → SIGNED_IN event → click no longer opens modal', async () => {
    sessionState.current = null;
    const { container, queryByText } = render(<BuildingReport data={FIXTURE} />);

    // Initial mount completes anon
    await waitFor(() => {
      expect(authState.callback).not.toBeNull();
    });

    // Update the mock so the SIGNED_IN handler's saved-state fetch sees authed=true
    sessionState.current = { access_token: 'token-after-signin' };

    await act(async () => {
      authState.callback?.('SIGNED_IN', { access_token: 'token-after-signin' });
    });

    // After SIGNED_IN, the listener calls getSavedBuildingState
    await waitFor(() => {
      expect(getSavedBuildingState).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    await waitFor(() => {
      expect(saveBuilding).toHaveBeenCalledWith('1008420015');
    });
    expect(queryByText(/sign in to save buildings/i)).toBeNull();
  });

  it('4. authed click → 401 from backend → modal opens, save state reverts', async () => {
    sessionState.current = { access_token: 'token-expiring' };
    vi.mocked(saveBuilding).mockRejectedValueOnce(new SavedBuildingsAuthError());

    const { container, findByText } = render(<BuildingReport data={FIXTURE} />);

    await waitFor(() => {
      expect(getSavedBuildingState).toHaveBeenCalledWith('1008420015');
    });

    fireEvent.click(findSaveButton(container));

    // Modal should open as the auth-error fallback path
    await findByText(/sign in to save buildings/i);

    // Optimistic state should revert: button label is "★ Save building",
    // not "★ Saved", because the save failed.
    expect(findSaveButton(container).textContent).toMatch(/save building/i);
  });

  it('5. TOKEN_REFRESHED event does not refetch saved state', async () => {
    sessionState.current = { access_token: 'token-1' };
    render(<BuildingReport data={FIXTURE} />);

    // Wait for the mount-time fetch
    await waitFor(() => {
      expect(getSavedBuildingState).toHaveBeenCalledTimes(1);
    });

    // Simulate the hourly TOKEN_REFRESHED event — should be ignored
    await act(async () => {
      authState.callback?.('TOKEN_REFRESHED', { access_token: 'token-2' });
    });

    // Brief microtask flush so any erroneous async work would have run by now
    await Promise.resolve();
    await Promise.resolve();

    expect(getSavedBuildingState).toHaveBeenCalledTimes(1);
  });
});
