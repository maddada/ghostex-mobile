/**
 * A horizontal swipe on the Sessions list switches Space, one at a time, in the Space row's order
 * (SpaceTabs.tsx `spaceRowOrder`): a swipe left shows the next Space, a swipe right the previous
 * one, and at either end it gives a little and springs back. The switch is the tile's own tap
 * (`onSelect`), so the row shows it while the list follows the finger 1:1 and slides the next
 * Space in from the opposite side.
 *
 * CDXC:Spaces 2026-11-28 DECISION:
 * Supersedes the 2026-11-17 24pt/27-degree snap-only gesture: shares `HorizontalSwipeView` with
 * `TabSwipe` so any drag more sideways than vertical (within 45 degrees of horizontal) activates on
 * the UI thread, tracks the finger 1:1 at 60fps, switches on a fast flick or past halfway, and
 * springs back otherwise, leaving the screen edges (`SWIPE_EDGE_MARGIN`) to the system back gesture.
 * The list waits for it (`requireToFail` in session-list.tsx), so a vertical drag still scrolls once
 * the swipe has seen it is more vertical than sideways.
 */

import { useCallback, useRef, type ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';

import { HorizontalSwipeView, SWIPE_EDGE_MARGIN } from '../common/HorizontalSwipe';

export default function SpaceSwipe({
  order,
  selectedId,
  onSelect,
  enabled,
  style,
  onLayout,
  children,
}: {
  /** Space ids in the row's order. */
  order: readonly string[];
  selectedId: string;
  onSelect: (spaceId: string) => void;
  /** Off where the list has no Space row (no Spaces, the Unified list, an extension's mode). */
  enabled: boolean;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const latest = useRef({ order, selectedId, onSelect });
  latest.current = { order, selectedId, onSelect };

  const index = order.indexOf(selectedId);
  const canPrev = index > 0;
  const canNext = index >= 0 && index < order.length - 1;

  const onCommit = useCallback((delta: -1 | 1): boolean => {
    const { order: ids, selectedId: current, onSelect: select } = latest.current;
    const currentIndex = ids.indexOf(current);
    const next = currentIndex < 0 ? undefined : ids[currentIndex + delta];
    if (next === undefined) return false;
    select(next);
    return true;
  }, []);

  return (
    <HorizontalSwipeView
      enabled={enabled && order.length > 1}
      canPrev={canPrev}
      canNext={canNext}
      onCommit={onCommit}
      entranceKey={selectedId}
      edgeMargin={SWIPE_EDGE_MARGIN}
      holdMs={0}
      entranceShiftFraction={0.28}
      entranceMaxShift={120}
      style={style}
      onLayout={onLayout}
    >
      {children}
    </HorizontalSwipeView>
  );
}
