// Locks in the fallback UI path the dashboard redirect-loop fix relies on:
// when the backend returns 401 (or getSession() returns null), the page
// coerces { kind: 'unauthorized' } → { kind: 'error' } and passes that down.
// If the 'error' branch in SavedBuildingsList ever stops rendering the
// "Couldn't load" card, the dashboard would silently fall through to the
// "No saved buildings yet" empty state, hiding the real failure mode from
// users and from us.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// SavedBuildingsList imports unsaveBuildingAction from './actions', which is
// a 'use server' module. We don't exercise the action here (no Unsave clicks
// in these tests), so a no-op mock is enough to unblock the import.
vi.mock('@/app/dashboard/actions', () => ({
  unsaveBuildingAction: vi.fn(),
}));

import { SavedBuildingsList } from '@/app/dashboard/SavedBuildingsList';
import type { SavedBuilding } from '@/lib/api/backend';

afterEach(() => {
  cleanup();
});

const ITEM: SavedBuilding = {
  bbl: '1008420015',
  address: '350 5th Ave',
  borough: 'MANHATTAN',
  saved_at: '2026-05-01T12:00:00Z',
  score: 80,
  score_band: 'minimal',
};

describe('SavedBuildingsList', () => {
  it('renders the error card when given kind: "error" (the dashboard loop-fix fallback)', () => {
    const { getByText } = render(<SavedBuildingsList initial={{ kind: 'error' }} />);
    expect(getByText(/couldn.t load your saved buildings/i)).toBeTruthy();
  });

  it('renders the empty state when authed with no saved items', () => {
    const { getByText } = render(
      <SavedBuildingsList initial={{ kind: 'ok', items: [] }} />,
    );
    expect(getByText(/no saved buildings yet/i)).toBeTruthy();
  });

  it('renders the list when authed with items', () => {
    const { getByText, queryByText } = render(
      <SavedBuildingsList initial={{ kind: 'ok', items: [ITEM] }} />,
    );
    expect(getByText('350 5th Ave')).toBeTruthy();
    // Must NOT show the empty or error state when items are present
    expect(queryByText(/no saved buildings yet/i)).toBeNull();
    expect(queryByText(/couldn.t load your saved buildings/i)).toBeNull();
  });
});
