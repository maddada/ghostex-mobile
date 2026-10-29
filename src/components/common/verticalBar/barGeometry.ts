/**
 * What the side bar keeps across launches, persisted to AsyncStorage like the settings
 * (`settings/store.ts`):
 * - the keyboard height it reserves per window size (layout.ts `keyboardHeightFor`): the tallest seen
 *   there, never less (owner A1, 2026-10-27), so the rail rearranges only when a keyboard first appears
 *   in a window size or a taller one does, and never moves back;
 * - the last bar layout the system reported per window size and side bar edge (layout.ts
 *   `chromeLayout`), so when React Native reports a new window size first the chrome can take the
 *   system's layout for it instead of waiting; a report that contradicts a kept one drops the others
 *   (`layoutsAfterReport`: the status items moved since they were taken).
 * Nothing is written before the stored geometry is read: what is measured meanwhile is kept in memory,
 * merged with what was stored, and written as one (FL-STA-04), so a launch never overwrites the stored
 * maximum with less. A failed read starts from nothing and a failed write keeps what this launch
 * measured; both are logged to the app log (Logs sheet), the geometry is measured again either way.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { BarLayout } from '../../../../modules/ghostex-native/src/GhostexNative.types';
import { logAppEvent } from '../../../app/appLog';
import {
  grownKeyboardHeights,
  layoutsAfterReport,
  mergedKeyboardHeights,
  sanitizeBarLayouts,
  sanitizeKeyboardHeights,
  type KeyboardHeights,
  type StoredBarLayouts,
} from './layout';

const BAR_GEOMETRY_STORAGE_KEY = 'verticalBar.geometry.v1';

type Persisted = { keyboardHeights: KeyboardHeights; layouts: StoredBarLayouts };

type BarGeometryState = Persisted & {
  hydrated: boolean;
  hydrate: () => Promise<void>;
  /** Keeps `height` (points, rounded) for windows of `sizeKey` when taller than the one kept; else writes nothing. */
  recordKeyboardHeight: (sizeKey: string, height: number) => void;
  /** Keeps `layout` under its window size and side bar edge (`layoutsAfterReport`); an unchanged one writes nothing. */
  recordLayout: (layout: BarLayout) => void;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The stored geometry, sanitized: what is not a height or a layout under its own key is dropped. */
function parsePersisted(raw: string): Persisted {
  const parsed: unknown = JSON.parse(raw);
  const field = (name: string): unknown =>
    typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, name) : undefined;
  return {
    keyboardHeights: sanitizeKeyboardHeights(field('keyboardHeights')),
    layouts: sanitizeBarLayouts(field('layouts')),
  };
}

export const useBarGeometryStore = create<BarGeometryState>()((set, get) => {
  // Measured before the stored geometry was read: written once it is merged with what was stored.
  let unsaved = false;
  const persist = (): void => {
    if (!get().hydrated) {
      unsaved = true;
      return;
    }
    unsaved = false;
    const { keyboardHeights, layouts } = get();
    const persisted: Persisted = { keyboardHeights, layouts };
    void AsyncStorage.setItem(BAR_GEOMETRY_STORAGE_KEY, JSON.stringify(persisted)).catch((error: unknown) =>
      logAppEvent(`Saving the side bar geometry failed: ${errorText(error)}`),
    );
  };

  return {
    hydrated: false,
    keyboardHeights: {},
    layouts: {},

    hydrate: async () => {
      if (get().hydrated) return;
      let stored: Persisted = { keyboardHeights: {}, layouts: {} };
      let read = false;
      try {
        const raw = await AsyncStorage.getItem(BAR_GEOMETRY_STORAGE_KEY);
        if (raw !== null) stored = parsePersisted(raw);
        read = true;
      } catch (error) {
        logAppEvent(`Reading the stored side bar geometry failed, measuring again: ${errorText(error)}`);
      }
      // What arrived while reading is newer than what was stored: a size's keyboard height keeps the
      // taller, and each layout reported meanwhile is taken as a report against the stored ones.
      set({
        hydrated: true,
        keyboardHeights: mergedKeyboardHeights(stored.keyboardHeights, get().keyboardHeights),
        layouts: Object.values(get().layouts).reduce<StoredBarLayouts>(
          (layouts, layout) => layoutsAfterReport(layouts, layout) ?? layouts,
          stored.layouts,
        ),
      });
      // A failed read leaves what may still be stored alone; the next measurement writes.
      if (read && unsaved) persist();
    },

    recordKeyboardHeight: (sizeKey, height) => {
      const keyboardHeights = grownKeyboardHeights(get().keyboardHeights, sizeKey, height);
      if (keyboardHeights === null) return;
      set({ keyboardHeights });
      persist();
    },

    recordLayout: (layout) => {
      const layouts = layoutsAfterReport(get().layouts, layout);
      if (layouts === null) return;
      set({ layouts });
      persist();
    },
  };
});
