// Address autocomplete dropdown.
// Pure presentational — the parent (LookupForm) owns all state and behavior.
// We render a listbox with one option per suggestion, ARIA-correct so screen
// readers see the standard combobox pattern.
//
// Selection uses onMouseDown + e.preventDefault() (NOT onClick). This pattern:
//   - Fires before the input's blur event, so the input keeps focus
//   - Works on both mouse and touch (touchend synthesizes mousedown)
//   - Mirrors what Google Maps and React Aria do for combobox listboxes
// Without it, the click would race with the input losing focus and the
// dropdown would close before the option's click handler fired.

'use client';

import type { MouseEvent } from 'react';

import type { AddressSuggestion } from '@/lib/api/geosearch';

type Props = {
  suggestions: AddressSuggestion[];
  activeIndex: number;
  onPick: (s: AddressSuggestion) => void;
  onHover: (index: number) => void;
};

export function AddressSuggestions({
  suggestions,
  activeIndex,
  onPick,
  onHover,
}: Props) {
  return (
    <ul
      id="address-suggestions"
      role="listbox"
      className="suggestions"
    >
      {suggestions.map((s, i) => {
        const selected = i === activeIndex;
        return (
          <li
            key={`${s.bbl}:${i}`}
            id={`addr-opt-${i}`}
            role="option"
            aria-selected={selected}
            className={`opt${selected ? ' active' : ''}`}
            onMouseDown={(e: MouseEvent<HTMLLIElement>) => {
              // Stop the input from losing focus + the click from firing
              // on whatever element happens to be under the cursor when
              // the dropdown unmounts.
              e.preventDefault();
              onPick(s);
            }}
            onMouseEnter={() => onHover(i)}
          >
            <span className="primary">{s.primary}</span>
            <span className="secondary">{s.secondary}</span>
          </li>
        );
      })}
    </ul>
  );
}
