// Verifies the AddressSuggestions dropdown renders correctly:
//   - One <li role="option"> per suggestion with primary + secondary text
//   - Active row has aria-selected="true" and the .active class
//   - mousedown on a row fires onPick (and preventDefault is called)
//   - Hovering a row fires onHover with its index

import { describe, expect, it, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

import { AddressSuggestions } from '@/components/AddressSuggestions';
import type { AddressSuggestion } from '@/lib/api/geosearch';

afterEach(() => {
  cleanup();
});

const SAMPLE: AddressSuggestion[] = [
  {
    bbl: '1008350041',
    primary: '350 5 Avenue',
    secondary: 'Midtown West, Manhattan',
    display: '350 5 Avenue, Midtown West, Manhattan',
  },
  {
    bbl: '3009810111',
    primary: '350 5 Avenue',
    secondary: 'Park Slope, Brooklyn',
    display: '350 5 Avenue, Park Slope, Brooklyn',
  },
];

describe('<AddressSuggestions>', () => {
  it('renders one option per suggestion with primary + secondary text', () => {
    const { container, getAllByRole } = render(
      <AddressSuggestions
        suggestions={SAMPLE}
        activeIndex={-1}
        onPick={() => {}}
        onHover={() => {}}
      />,
    );
    const options = getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0].textContent).toContain('350 5 Avenue');
    expect(options[0].textContent).toContain('Midtown West, Manhattan');
    expect(options[1].textContent).toContain('Park Slope, Brooklyn');

    // Listbox wrapper has the right role + id
    const list = container.querySelector('#address-suggestions');
    expect(list?.getAttribute('role')).toBe('listbox');
  });

  it('marks the active row with aria-selected and the .active class', () => {
    const { getAllByRole } = render(
      <AddressSuggestions
        suggestions={SAMPLE}
        activeIndex={1}
        onPick={() => {}}
        onHover={() => {}}
      />,
    );
    const options = getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('false');
    expect(options[0].className).not.toContain('active');
    expect(options[1].getAttribute('aria-selected')).toBe('true');
    expect(options[1].className).toContain('active');
  });

  it('fires onPick on mousedown and prevents the default to keep input focus', () => {
    const onPick = vi.fn();
    const { getAllByRole } = render(
      <AddressSuggestions
        suggestions={SAMPLE}
        activeIndex={-1}
        onPick={onPick}
        onHover={() => {}}
      />,
    );
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    fireEvent(getAllByRole('option')[0], event);

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(SAMPLE[0]);
    expect(event.defaultPrevented).toBe(true);
  });

  it('fires onHover with the row index on mouseenter', () => {
    const onHover = vi.fn();
    const { getAllByRole } = render(
      <AddressSuggestions
        suggestions={SAMPLE}
        activeIndex={-1}
        onPick={() => {}}
        onHover={onHover}
      />,
    );
    fireEvent.mouseEnter(getAllByRole('option')[1]);
    expect(onHover).toHaveBeenLastCalledWith(1);
  });
});
