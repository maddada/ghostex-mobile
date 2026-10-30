/**
 * The Unified list's filter menu and its button label, as the desktop's Unified header builds them
 * (apps/desktop/src/app/native_sidebar/unified/header.rs `filter_menu_items`, `filter_label`).
 */

import type { UnifiedFilter, UnifiedFilterOption, UnifiedFilterOptions } from './build';

export type UnifiedFilterKind = 'repos' | 'machines' | 'spaces';

export type UnifiedFilterMenuRow =
  | { kind: 'all'; checked: boolean }
  | { kind: 'separator'; key: string }
  | { kind: 'heading'; label: string }
  | { kind: 'pick'; filterKind: UnifiedFilterKind; key: string; label: string; detail: string | null; checked: boolean };

/**
 * All sessions, then Machines, Spaces and Projects: the two short lists first, so they are not lost
 * below a long list of projects. A section shows once it has two choices, or a pick.
 */
export function unifiedFilterMenu(options: UnifiedFilterOptions, filter: UnifiedFilter): UnifiedFilterMenuRow[] {
  const rows: UnifiedFilterMenuRow[] = [
    {
      kind: 'all',
      checked: filter.repos.length === 0 && filter.machines.length === 0 && filter.spaces.length === 0,
    },
  ];
  const section = (title: string, filterKind: UnifiedFilterKind, offered: UnifiedFilterOption[]) => {
    const picked = filter[filterKind];
    if (offered.length < 2 && picked.length === 0) return;
    rows.push({ kind: 'separator', key: `${filterKind}-separator` });
    rows.push({ kind: 'heading', label: title });
    for (const option of offered) {
      rows.push({
        kind: 'pick',
        filterKind,
        key: option.key,
        label: option.label,
        detail: option.detail,
        checked: picked.includes(option.key),
      });
    }
  };
  section('Machines', 'machines', options.machines);
  section('Spaces', 'spaces', options.spaces);
  section('Projects', 'repos', options.repos);
  return rows;
}

/** A pick toggles its choice in or out of the filter; All sessions clears it. */
export function toggleUnifiedFilter(filter: UnifiedFilter, filterKind: UnifiedFilterKind, key: string): UnifiedFilter {
  const picked = filter[filterKind];
  return {
    ...filter,
    [filterKind]: picked.includes(key) ? picked.filter((entry) => entry !== key) : [...picked, key],
  };
}

/** What the filter button says: everything, or the first pick and how many more. */
export function unifiedFilterLabel(options: UnifiedFilterOptions, filter: UnifiedFilter): string {
  const picked = [
    ...options.repos.filter((option) => filter.repos.includes(option.key)),
    ...options.machines.filter((option) => filter.machines.includes(option.key)),
    ...options.spaces.filter((option) => filter.spaces.includes(option.key)),
  ].map((option) => option.label);
  if (picked.length === 0) return 'All sessions';
  if (picked.length === 1) return picked[0];
  return `${picked[0]} +${picked.length - 1}`;
}
