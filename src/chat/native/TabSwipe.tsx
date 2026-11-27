/**
 * A sideways swipe on the chat's transcript goes to the previous or next tab, in the tab strip's order.
 *
 * CDXC:SessionChat 2026-11-28 DECISION:
 * Supersedes the 2026-11-12 WHY and 2026-11-14 30-degree PanResponder rule: user reported swiping sideways
 * between tabs felt rough and often scrolled vertically instead. Now driven on the UI thread via
 * `HorizontalSwipeView` (react-native-gesture-handler + Reanimated worklets): any drag more sideways than
 * vertical (within 45 degrees of horizontal) claims the gesture before the vertical `FlatList` starts
 * scrolling, follows the finger 1:1 at 60fps, switches on a fast flick or past halfway, and snaps back
 * otherwise. Still never starts from a screen edge (`EDGE_MARGIN`), yields to inner horizontal scrolls
 * (`NestedHorizontalScroll`: code blocks, tables, image strips, file diffs), and backs off during text
 * selection / message-menu holds (`HOLD_MS`).
 */

import { useCallback, useRef, type ReactNode } from 'react';

import {
  HorizontalSwipeView,
  SWIPE_EDGE_MARGIN,
  type EntranceToken,
} from '../../components/common/HorizontalSwipe';

/** A press held this long without travelling is a hold (selection, the message menu), never a swipe. */
const HOLD_MS = 380;

/** The page a swipe just left: the next chat shown within this window slides in from the other side. */
const entranceBus: { current: EntranceToken | null } = { current: null };

export type TabSwipe = {
  /** Whether there is a tab that way (-1 previous, 1 next), asked when the drag starts. */
  canSwipe: (delta: -1 | 1) => boolean;
  /** Goes to that tab (after the page starts sliding out). */
  onSwipe: (delta: -1 | 1) => void;
};

export function TabSwipeView({
  swipe,
  shown = true,
  children,
}: {
  swipe: TabSwipe | null;
  /**
   * Whether this chat is the selected tab's. A chat kept warm for a recent tab (`WarmChats.tsx`) stays mounted while
   * another is shown, so it slides in when it is shown again rather than when it mounts.
   */
  shown?: boolean;
  children: ReactNode;
}) {
  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;

  const canPrev = swipe?.canSwipe(-1) ?? false;
  const canNext = swipe?.canSwipe(1) ?? false;

  const resolveBounds = useCallback(() => {
    const current = swipeRef.current;
    return {
      canPrev: current?.canSwipe(-1) ?? false,
      canNext: current?.canSwipe(1) ?? false,
    };
  }, []);

  const onCommit = useCallback((delta: -1 | 1) => {
    const current = swipeRef.current;
    if (current === null || !current.canSwipe(delta)) return false;
    current.onSwipe(delta);
    return true;
  }, []);

  return (
    <HorizontalSwipeView
      enabled={swipe !== null && shown}
      canPrev={canPrev}
      canNext={canNext}
      resolveBounds={resolveBounds}
      onCommit={onCommit}
      entranceBus={entranceBus}
      shown={shown}
      edgeMargin={SWIPE_EDGE_MARGIN}
      holdMs={HOLD_MS}
    >
      {children}
    </HorizontalSwipeView>
  );
}
