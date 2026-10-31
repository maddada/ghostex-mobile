/**
 * What the phone's Unified list keeps across a restart: the filter's picks, which shelves are open
 * and which project groups are folded (gx-core `unified_sidebar/saved.rs`, on the phone's own
 * storage). What is typed in the search field is deliberately not kept.
 */

import { EMPTY_UNIFIED_FILTER, type UnifiedFilter } from './build';

export const UNIFIED_SAVED_STATE_KEY = 'sessions.unified.v1';

export type UnifiedSavedState = {
  filter: UnifiedFilter;
  /** Shelves toggled away from how they start; inside a project as `<repo key>|<shelf>`. */
  toggledShelves: string[];
  foldedGroups: string[];
  /** The machine a new session last used per repository (the tray's machine chips). */
  lastMachines: Record<string, string>;
};

export const EMPTY_UNIFIED_SAVED: UnifiedSavedState = {
  filter: EMPTY_UNIFIED_FILTER,
  toggledShelves: [],
  foldedGroups: [],
  lastMachines: {},
};

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Nothing saved, or something unreadable, starts over. */
export function parseUnifiedSaved(raw: string | null): UnifiedSavedState {
  if (raw === null) return EMPTY_UNIFIED_SAVED;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return EMPTY_UNIFIED_SAVED;
  }
  if (typeof value !== 'object' || value === null) return EMPTY_UNIFIED_SAVED;
  const saved = value as Record<string, unknown>;
  const lastMachines: Record<string, string> = {};
  if (typeof saved.lastMachines === 'object' && saved.lastMachines !== null) {
    for (const [repo, machine] of Object.entries(saved.lastMachines)) {
      if (typeof machine === 'string') lastMachines[repo] = machine;
    }
  }
  return {
    filter: {
      repos: strings(saved.repos),
      machines: strings(saved.machines),
      spaces: strings(saved.spaces),
      query: '',
    },
    toggledShelves: strings(saved.toggledShelves),
    foldedGroups: strings(saved.foldedGroups),
    lastMachines,
  };
}

export function serializeUnifiedSaved(state: UnifiedSavedState): string {
  return JSON.stringify({
    repos: state.filter.repos,
    machines: state.filter.machines,
    spaces: state.filter.spaces,
    toggledShelves: state.toggledShelves,
    foldedGroups: state.foldedGroups,
    lastMachines: state.lastMachines,
  });
}
