/**
 * A sideways swipe on the chat's transcript goes to the previous or next tab, in the tab strip's order.
 *
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User: "i want swiping left and right on the chat transcript itself when no text is selected to go between the
 * tabs." Only the transcript takes it (not the chat box or the cards), and only a quick, clearly sideways drag: the
 * transcript follows the finger a little, then pages out and the next chat slides in; at the first or last tab it
 * gives a little and springs back. Never:
 * - from a screen edge (a margin at each edge is left to the system's Back swipe and the terminal's own edges),
 * - a vertical scroll (a mostly vertical drag is never claimed, and the list taking it cancels this one),
 * - a sideways scroll inside a code block, a table or a wide card (their native scroll view takes the drag at its own
 *   small slop and cancels this one, on Android and on iOS),
 * - while text is selected: a hold (where selecting words starts) arms nothing, and the next touch after a hold
 *   never swipes, so a selection's touches stay its own.
 *
 * CDXC:SessionChat 2026-11-12 WHY: React Native's responder (as `EdgeSwipeZones`), not a gesture-handler pan: a JS
 * responder is cancelled by any native scroll view that starts scrolling, which is exactly the "never steal a
 * scroll" rule; a gesture-handler pan at the root would win against those native scroll views instead.
 */

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  useWindowDimensions,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';

/** The strip at each screen edge where a swipe never starts. */
const EDGE_MARGIN = 28;
/** Sideways travel before the transcript takes the drag, and how much more sideways than vertical it must be. */
const CLAIM_DISTANCE = 18;
const CLAIM_RATIO = 2;
/** A press held this long without travelling is a hold (selection, the message menu), never a swipe. */
const HOLD_MS = 380;
/** Travel under this is a tap or a hold, not a drag. */
const TAP_SLOP = 8;
/** How far the transcript follows the finger (a share), and the travel or flick that pages. */
const FOLLOW = 0.55;
const PAGE_DISTANCE = 64;
const PAGE_VELOCITY = 0.45;
const PAGE_MIN_DISTANCE = 28;
/** At the first or last tab: the most it gives, and how stiffly. */
const EDGE_GIVE = 36;
const EDGE_RESISTANCE = 0.2;
const PAGE_OUT_MS = 130;
const PAGE_IN_MS = 170;
/** How far (a share of the width) the pages travel out and in. */
const PAGE_SHIFT = 0.28;

/**
 * A raw touch event's point and time. React Native puts them on the event itself; react-native-web (the previews)
 * passes the DOM's event, whose point is on its touches and whose time is `timeStamp`, the responder events' clock.
 */
function touchPoint(event: GestureResponderEvent): { x: number; y: number; at: number } {
  const native = event.nativeEvent as GestureResponderEvent['nativeEvent'] & { timeStamp?: number };
  const first = native.changedTouches?.[0] ?? native.touches?.[0];
  return {
    x: native.pageX ?? first?.pageX ?? 0,
    y: native.pageY ?? first?.pageY ?? 0,
    at: native.timestamp ?? native.timeStamp ?? event.timeStamp,
  };
}

/** The page a swipe just left: the next chat shown within this time slides in from the other side. */
let entrance: { from: 1 | -1; at: number } | null = null;
const ENTRANCE_WINDOW_MS = 1200;

export type TabSwipe = {
  /** Whether there is a tab that way (-1 previous, 1 next), asked when the drag starts. */
  canSwipe: (delta: -1 | 1) => boolean;
  /** Goes to that tab (after the page has slid out). */
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
  const { width } = useWindowDimensions();
  const translateX = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  // The touch now: where and when it started, whether it travelled, and whether it may swipe at all.
  const touch = useRef({ x: 0, y: 0, at: 0, travelled: false, eligible: false, afterHold: false });
  // A hold just happened: words may be selected, so the next touch is theirs.
  const heldLast = useRef(false);
  // The way the claimed drag may page (null: no tab there, it only gives).
  const target = useRef<-1 | 1 | null>(null);
  const swipeRef = useRef(swipe);
  swipeRef.current = swipe;
  const widthRef = useRef(width);
  widthRef.current = width;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const heldInPlace = (timestamp: number): boolean =>
    !touch.current.travelled && timestamp - touch.current.at >= HOLD_MS;

  // The page this swipe slid out; it is put back when this chat is shown again, or at once if the tab did not change.
  const pagedOut = useRef(false);
  // The chat a swipe brought here slides in from the side the swipe came from. In the commit that shows it, not after:
  // a warm chat slid out on an earlier visit would otherwise stay blank until the screen's next render is done.
  useLayoutEffect(() => {
    if (!shown) return;
    if (pagedOut.current) {
      pagedOut.current = false;
      translateX.setValue(0);
      opacity.setValue(1);
    }
    const coming = entrance;
    entrance = null;
    if (coming === null || Date.now() - coming.at > ENTRANCE_WINDOW_MS) return;
    translateX.setValue(coming.from * widthRef.current * PAGE_SHIFT);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, { toValue: 0, duration: PAGE_IN_MS, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: PAGE_IN_MS, useNativeDriver: true }),
    ]).start();
  }, [opacity, translateX, shown]);

  const handlers = useMemo(() => {
    const settle = (): void => {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 4, speed: 18 }).start();
    };
    const responder = PanResponder.create({
      // Claimed in the capture phase, so a press inside the transcript (a card's button) gives way to a clear swipe.
      onMoveShouldSetPanResponderCapture: (event: GestureResponderEvent, gesture: PanResponderGestureState) => {
        const now = touch.current;
        if (swipeRef.current === null || !now.eligible) return false;
        if (event.nativeEvent.timestamp - now.at > HOLD_MS) return false;
        if (Math.abs(gesture.dx) < CLAIM_DISTANCE || Math.abs(gesture.dx) < CLAIM_RATIO * Math.abs(gesture.dy)) {
          return false;
        }
        const delta: -1 | 1 = gesture.dx < 0 ? 1 : -1;
        target.current = swipeRef.current.canSwipe(delta) ? delta : null;
        return true;
      },
      onPanResponderMove: (_event, gesture) => {
        if (target.current !== null) translateX.setValue(gesture.dx * FOLLOW);
        else translateX.setValue(Math.sign(gesture.dx) * Math.min(EDGE_GIVE, Math.abs(gesture.dx) * EDGE_RESISTANCE));
      },
      onPanResponderRelease: (_event, gesture) => {
        const delta = target.current;
        target.current = null;
        const paging =
          delta !== null &&
          (gesture.dx < 0 ? delta === 1 : delta === -1) &&
          (Math.abs(gesture.dx) >= PAGE_DISTANCE ||
            (Math.abs(gesture.vx) >= PAGE_VELOCITY && Math.abs(gesture.dx) >= PAGE_MIN_DISTANCE));
        if (!paging || delta === null) {
          settle();
          return;
        }
        // Out the way the finger went while the next chat comes; it slides in from the other side.
        entrance = { from: delta, at: Date.now() };
        pagedOut.current = true;
        Animated.parallel([
          Animated.timing(translateX, {
            toValue: -delta * widthRef.current * PAGE_SHIFT,
            duration: PAGE_OUT_MS,
            useNativeDriver: true,
          }),
          Animated.timing(opacity, { toValue: 0, duration: PAGE_OUT_MS, useNativeDriver: true }),
        ]).start(() => {
          // Still the selected tab (the tab did not change): back in place. A chat kept warm stays slid out until it
          // is shown again (above), so it never flashes back before the next one covers it.
          if (!pagedOut.current || !shownRef.current) return;
          pagedOut.current = false;
          translateX.setValue(0);
          opacity.setValue(1);
        });
        // The tab changes as the page starts to go, not after: the slide runs on the native side meanwhile, so the
        // screen's render of the next chat overlaps it instead of following it (CDXC:SessionChat 2026-11-12, warm
        // tabs: switching is to be instant).
        swipeRef.current?.onSwipe(delta);
      },
      onPanResponderTerminate: () => {
        target.current = null;
        settle();
      },
      // A native scroll view or the system may take the drag back; it springs home then.
      onPanResponderTerminationRequest: () => true,
    });
    return responder.panHandlers;
  }, [opacity, translateX]);

  return (
    <Animated.View
      style={[styles.fill, { opacity, transform: [{ translateX }] }]}
      {...handlers}
      onTouchStart={(event) => {
        const { x: pageX, y: pageY, at: timestamp } = touchPoint(event);
        const afterHold = heldLast.current;
        heldLast.current = false;
        touch.current = {
          x: pageX,
          y: pageY,
          at: timestamp,
          travelled: false,
          afterHold,
          eligible:
            event.nativeEvent.touches.length <= 1 &&
            !afterHold &&
            pageX >= EDGE_MARGIN &&
            pageX <= widthRef.current - EDGE_MARGIN,
        };
      }}
      onTouchMove={(event) => {
        const { x: pageX, y: pageY } = touchPoint(event);
        if (Math.abs(pageX - touch.current.x) > TAP_SLOP || Math.abs(pageY - touch.current.y) > TAP_SLOP) {
          touch.current.travelled = true;
        }
        if (event.nativeEvent.touches.length > 1) touch.current.eligible = false;
      }}
      // A press held in place is a hold: the words under it may now be selected, so the next touch is theirs. A
      // touch a list or a code block took (cancelled) keeps a selection's guard for the touch after it.
      onTouchEnd={(event) => {
        heldLast.current = heldInPlace(touchPoint(event).at);
      }}
      onTouchCancel={(event) => {
        heldLast.current = heldInPlace(touchPoint(event).at) || touch.current.afterHold;
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
