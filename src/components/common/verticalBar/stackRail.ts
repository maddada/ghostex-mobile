/**
 * The header buttons a stack screen puts into the iPhone Duo's side bar next to Back (StackHeader).
 * The screen keeps its `headerRight` for the header on top and in the status band, and gives the same
 * buttons as rail entries here; the header publishes Back plus these to the rail.
 */

import { useRoute } from '@react-navigation/native';
import { useLayoutEffect } from 'react';
import { create } from 'zustand';

import type { RailEntry } from './railSlot';

/**
 * A screen's rail entries and whether a keyboard can appear while its rail shows (owner D3, 2026-10-26);
 * optionally what its Back does (when it leaves more than this screen) and whether the screen draws its
 * title row in the side bar's poses itself (Settings in two columns, F2).
 */
export type ScreenRail = {
  readonly entries: readonly RailEntry[];
  readonly reserveKeyboard: boolean;
  readonly onBack?: () => void;
  readonly titleInContent?: boolean;
};

type StackRailState = {
  byRoute: Readonly<Record<string, ScreenRail>>;
  put: (routeKey: string, rail: ScreenRail | null) => void;
};

export const useStackRailStore = create<StackRailState>()((set, get) => ({
  byRoute: {},
  put: (routeKey, rail) => {
    const { [routeKey]: current, ...others } = get().byRoute;
    if (current === rail) return;
    set({ byRoute: rail === null ? others : { ...others, [routeKey]: rail } });
  },
}));

/** Gives this stack screen's header buttons (memoized on their inputs) to its header's rail. */
export function useStackScreenRail(rail: ScreenRail): void {
  const routeKey = useRoute().key;
  const put = useStackRailStore((state) => state.put);
  useLayoutEffect(() => {
    put(routeKey, rail);
  }, [put, routeKey, rail]);
  useLayoutEffect(() => () => put(routeKey, null), [put, routeKey]);
}
