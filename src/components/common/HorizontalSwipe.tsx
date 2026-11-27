/**
 * Shared UI-thread horizontal swipe container and nested-scroll helpers for full-height lists/transcripts.
 *
 * A drag that is more sideways than vertical (within 45 degrees of horizontal, past {@link SWIPE_ACTIVATE_SLOP})
 * activates on the UI thread via `react-native-gesture-handler` + `react-native-reanimated`, tracks the finger
 * 1:1 at 60fps (with rubber-band resistance past either end), switches on release past halfway or on a short
 * fast flick, and otherwise springs back to the current page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { StyleSheet, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import {
  GestureDetector,
  GestureStateManager,
  ScrollView as GestureScrollView,
  usePanGesture,
  type PanGesture,
} from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

/** Strip at each screen edge left to the system back gesture and terminal edge zones. */
export const SWIPE_EDGE_MARGIN = 28;
/** Travel (pt) before locking direction: clear of a tap, and gives inner horizontal scrolls / row swipes time to claim first. */
export const SWIPE_ACTIVATE_SLOP = 12;
const ACTIVATE_SLOP_SQ = SWIPE_ACTIVATE_SLOP * SWIPE_ACTIVATE_SLOP;
/** Travel (pt) under this counts as stationary for hold detection. */
const TAP_SLOP = 8;
/** Minimum flick speed (pt/s) and travel (pt) that switches even short of halfway. */
export const SWIPE_FLICK_VELOCITY = 450;
export const SWIPE_FLICK_MIN_DISTANCE = 24;
/** Rubber-band give (pt) and stiffness at the first/last page. */
const EDGE_GIVE = 36;
const EDGE_RESISTANCE = 0.2;
/** Subtle dimming share at full-width drag so the page stays crisp while moving. */
const DRAG_DIM = 0.12;
const ENTRANCE_OPACITY = 0.25;
const PAGE_OUT_MS = 140;
const PAGE_IN_MS = 180;
const SNAP_OPACITY_MS = 120;
const PAGE_EASING = Easing.out(Easing.cubic);
const SNAP_SPRING = { damping: 24, stiffness: 280, mass: 0.8 };
const ENTRANCE_WINDOW_MS = 1200;

export type EntranceToken = { from: -1 | 1; at: number };

const HorizontalSwipeContext = createContext<PanGesture | null>(null);

/** The enclosing horizontal swipe pan gesture, for vertical lists (`requireToFail`) and inner horizontal areas. */
export function useHorizontalSwipeGesture(): PanGesture | null {
  return useContext(HorizontalSwipeContext);
}

/**
 * A horizontal `ScrollView` inside a swipable transcript (code block, table, image strip, file diff):
 * once its native scroll activates, it fails the outer tab swipe on the UI thread so wide content scrolls
 * freely while non-overflowing content still lets tab swipes through.
 */
export function NestedHorizontalScroll({ onActivate, ...props }: ComponentProps<typeof GestureScrollView>) {
  const parentPan = useHorizontalSwipeGesture();
  const parentTag = parentPan?.handlerTag ?? 0;
  return (
    <GestureScrollView
      {...props}
      horizontal
      onActivate={(event) => {
        'worklet';
        if (parentTag > 0) GestureStateManager.fail(parentTag);
        onActivate?.(event);
      }}
    />
  );
}

/**
 * A vertical nested `ScrollView` inside a swipable transcript or list: waits for the outer horizontal swipe's
 * direction check (`requireToFail`) so a mostly sideways drag over a scrollable card still switches pages.
 */
export function NestedVerticalScroll(props: ComponentProps<typeof GestureScrollView>) {
  const swipePan = useHorizontalSwipeGesture();
  return <GestureScrollView {...props} requireToFail={swipePan ?? undefined} />;
}

export type HorizontalSwipeViewProps = {
  enabled: boolean;
  canPrev: boolean;
  canNext: boolean;
  /** Called before activation / on gesture begin so dynamic stores (e.g. tab order) can refresh `canPrev` / `canNext`. */
  resolveBounds?: () => { canPrev: boolean; canNext: boolean };
  /** Called when a drag commits (-1 previous, 1 next). Return `false` if the switch did not happen. */
  onCommit: (delta: -1 | 1) => boolean | void;
  /** Value whose change triggers the incoming slide when `entranceBus` has a recent swipe (e.g. `selectedSpaceId`). */
  entranceKey?: string | boolean;
  /** Shared entrance bus across multiple mounted pages (used by `TabSwipeView` with `WarmChats`). */
  entranceBus?: MutableRefObject<EntranceToken | null>;
  /** Whether this view is the currently visible page (parked warm chats stay slid out until shown again). */
  shown?: boolean;
  /** Edge margin (pt) where swipes never start. */
  edgeMargin?: number;
  /** Press hold duration (ms) without travel that blocks swiping for this and the next touch (0 disables). */
  holdMs?: number;
  /** Share of container width the incoming page slides from, capped at `entranceMaxShift`. */
  entranceShiftFraction?: number;
  entranceMaxShift?: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: (event: LayoutChangeEvent) => void;
  children: ReactNode;
};

export function HorizontalSwipeView({
  enabled,
  canPrev,
  canNext,
  resolveBounds,
  onCommit,
  entranceKey,
  entranceBus,
  shown = true,
  edgeMargin = SWIPE_EDGE_MARGIN,
  holdMs = 0,
  entranceShiftFraction = 0.32,
  entranceMaxShift = 160,
  style,
  onLayout,
  children,
}: HorizontalSwipeViewProps) {
  const { width: windowWidth } = useWindowDimensions();
  const reduceMotion = useReducedMotion();

  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);
  const containerWidth = useSharedValue(0);
  const windowWidthSV = useSharedValue(windowWidth);
  const canPrevSV = useSharedValue(canPrev);
  const canNextSV = useSharedValue(canNext);
  const reduceMotionSV = useSharedValue(reduceMotion);
  // Shared values are written after render, never during it (Reanimated warns about that and a render can be thrown away).
  useLayoutEffect(() => {
    windowWidthSV.value = windowWidth;
    canPrevSV.value = canPrev;
    canNextSV.value = canNext;
    reduceMotionSV.value = reduceMotion;
  }, [windowWidth, canPrev, canNext, reduceMotion, windowWidthSV, canPrevSV, canNextSV, reduceMotionSV]);

  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const touchStartAt = useSharedValue(0);
  const touchLastX = useSharedValue(0);
  const touchTravelled = useSharedValue(false);
  const touchAfterHold = useSharedValue(false);
  const heldLast = useSharedValue(false);
  const touchDecided = useSharedValue(false);
  const activateDx = useSharedValue(0);
  const dragStartOffset = useSharedValue(0);
  const isActive = useSharedValue(false);

  const localEntranceBus = useRef<EntranceToken | null>(null);
  const busRef = entranceBus ?? localEntranceBus;
  const pagedOutRef = useRef(false);
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const containerWidthRef = useRef(0);
  const windowWidthRef = useRef(windowWidth);
  windowWidthRef.current = windowWidth;
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const latestRef = useRef({ resolveBounds, onCommit });
  latestRef.current = { resolveBounds, onCommit };

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

  const refreshBounds = useCallback(() => {
    const resolved = latestRef.current.resolveBounds?.();
    if (resolved !== undefined) {
      canPrevSV.value = resolved.canPrev;
      canNextSV.value = resolved.canNext;
    }
  }, [canNextSV, canPrevSV]);

  const commit = useCallback(
    (delta: -1 | 1) => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
      busRef.current = { from: delta, at: Date.now() };
      pagedOutRef.current = true;
      const result = latestRef.current.onCommit(delta);
      if (result === false) {
        busRef.current = null;
        pagedOutRef.current = false;
        cancelAnimation(translateX);
        cancelAnimation(opacity);
        translateX.value = 0;
        opacity.value = 1;
        return;
      }
      // If the page stayed shown without switching (e.g. external guard rejected the switch), restore it cleanly.
      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;
        if (!pagedOutRef.current || !shownRef.current) return;
        pagedOutRef.current = false;
        if (busRef.current !== null && Date.now() - busRef.current.at <= ENTRANCE_WINDOW_MS) {
          busRef.current = null;
        }
        cancelAnimation(translateX);
        cancelAnimation(opacity);
        translateX.value = 0;
        opacity.value = 1;
      }, PAGE_OUT_MS + 60);
    },
    [busRef, opacity, translateX],
  );

  useLayoutEffect(() => {
    if (!shown) return;
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    if (pagedOutRef.current) {
      pagedOutRef.current = false;
      cancelAnimation(translateX);
      cancelAnimation(opacity);
      translateX.value = 0;
      opacity.value = 1;
    }
    const coming = busRef.current;
    busRef.current = null;
    if (coming === null || Date.now() - coming.at > ENTRANCE_WINDOW_MS) return;
    if (reduceMotion) {
      cancelAnimation(translateX);
      cancelAnimation(opacity);
      translateX.value = 0;
      opacity.value = 1;
      return;
    }
    const width = containerWidthRef.current > 0 ? containerWidthRef.current : windowWidthRef.current;
    const shift = Math.min(width * entranceShiftFraction, entranceMaxShift);
    cancelAnimation(translateX);
    cancelAnimation(opacity);
    translateX.value = coming.from * shift;
    opacity.value = ENTRANCE_OPACITY;
    translateX.value = withTiming(0, { duration: PAGE_IN_MS, easing: PAGE_EASING });
    opacity.value = withTiming(1, { duration: PAGE_IN_MS });
  }, [shown, entranceKey, busRef, entranceMaxShift, entranceShiftFraction, reduceMotion, opacity, translateX]);

  const swipeEnabled = enabled && (canPrev || canNext);
  const pan = usePanGesture({
    enabled: swipeEnabled,
    manualActivation: true,
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet';
      if (event.numberOfTouches > 1) {
        touchDecided.value = true;
        if (!isActive.value) GestureStateManager.fail(event.handlerTag);
        return;
      }
      const touch = event.changedTouches[0] ?? event.allTouches[0];
      if (touch === undefined) return;
      const afterHold = holdMs > 0 ? heldLast.value : false;
      heldLast.value = false;
      touchStartX.value = touch.absoluteX;
      touchStartY.value = touch.absoluteY;
      touchLastX.value = touch.absoluteX;
      touchStartAt.value = Date.now();
      touchTravelled.value = false;
      touchAfterHold.value = afterHold;
      const inEdge = touch.absoluteX < edgeMargin || touch.absoluteX > windowWidthSV.value - edgeMargin;
      if (afterHold || inEdge) {
        touchDecided.value = true;
        GestureStateManager.fail(event.handlerTag);
      } else {
        touchDecided.value = false;
      }
    },
    onTouchesMove: (event) => {
      'worklet';
      if (event.numberOfTouches > 1) {
        if (!touchDecided.value) {
          touchDecided.value = true;
          GestureStateManager.fail(event.handlerTag);
        }
        return;
      }
      const touch = event.changedTouches[0] ?? event.allTouches[0];
      if (touch === undefined) return;
      touchLastX.value = touch.absoluteX;
      const dx = touch.absoluteX - touchStartX.value;
      const dy = touch.absoluteY - touchStartY.value;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (holdMs > 0 && !touchTravelled.value && Date.now() - touchStartAt.value > holdMs) {
        // A hold (words may now be selected): failing ends this touch's events here, so its up never arrives to mark
        // it; mark it now, so the next touch (a selection handle's drag) is the selection's too.
        touchDecided.value = true;
        heldLast.value = true;
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      if (!touchTravelled.value && (absDx > TAP_SLOP || absDy > TAP_SLOP)) {
        touchTravelled.value = true;
      }
      if (touchDecided.value) return;
      if (absDx * absDx + absDy * absDy < ACTIVATE_SLOP_SQ) return;
      touchDecided.value = true;
      if (absDx > absDy) {
        GestureStateManager.activate(event.handlerTag);
      } else {
        GestureStateManager.fail(event.handlerTag);
      }
    },
    onTouchesUp: () => {
      'worklet';
      if (holdMs > 0) {
        heldLast.value = !touchTravelled.value && Date.now() - touchStartAt.value >= holdMs;
      }
    },
    onTouchesCancel: () => {
      'worklet';
      if (holdMs > 0) {
        heldLast.value = (!touchTravelled.value && Date.now() - touchStartAt.value >= holdMs) || touchAfterHold.value;
      }
    },
    onBegin: () => {
      'worklet';
      if (resolveBounds !== undefined) runOnJS(refreshBounds)();
    },
    onActivate: (event) => {
      'worklet';
      cancelAnimation(translateX);
      cancelAnimation(opacity);
      isActive.value = true;
      activateDx.value = event.translationX;
      dragStartOffset.value = translateX.value;
    },
    onUpdate: (event) => {
      'worklet';
      const drag = event.translationX - activateDx.value;
      const offset = dragStartOffset.value + drag;
      const width = containerWidth.value > 0 ? containerWidth.value : windowWidthSV.value;
      const delta: -1 | 1 = offset < 0 ? 1 : -1;
      const canStep = delta === 1 ? canNextSV.value : canPrevSV.value;
      if (canStep) {
        translateX.value = offset;
        opacity.value = 1 - DRAG_DIM * Math.min(1, Math.abs(offset) / Math.max(1, width));
      } else {
        translateX.value = Math.sign(offset) * Math.min(EDGE_GIVE, Math.abs(offset) * EDGE_RESISTANCE);
        opacity.value = 1;
      }
    },
    onDeactivate: (event) => {
      'worklet';
      isActive.value = false;
      const drag = event.translationX - activateDx.value;
      const offset = dragStartOffset.value + drag;
      const totalDx = touchLastX.value - touchStartX.value;
      const width = containerWidth.value > 0 ? containerWidth.value : windowWidthSV.value;
      const delta: -1 | 1 = drag !== 0 ? (drag < 0 ? 1 : -1) : offset < 0 ? 1 : -1;
      const canStep = delta === 1 ? canNextSV.value : canPrevSV.value;
      const halfway = Math.abs(offset) >= width * 0.5;
      const flick =
        Math.abs(event.velocityX) >= SWIPE_FLICK_VELOCITY &&
        Math.abs(totalDx) >= SWIPE_FLICK_MIN_DISTANCE &&
        Math.sign(event.velocityX) === Math.sign(drag);
      if (!event.canceled && canStep && (halfway || flick)) {
        if (reduceMotionSV.value) {
          translateX.value = 0;
          opacity.value = 1;
        } else {
          translateX.value = withTiming(-delta * width, { duration: PAGE_OUT_MS, easing: PAGE_EASING });
          opacity.value = withTiming(0, { duration: PAGE_OUT_MS });
        }
        runOnJS(commit)(delta);
        return;
      }
      if (reduceMotionSV.value) {
        translateX.value = 0;
        opacity.value = 1;
      } else {
        translateX.value = withSpring(0, SNAP_SPRING);
        opacity.value = withTiming(1, { duration: SNAP_OPACITY_MS });
      }
    },
    onFinalize: () => {
      'worklet';
      isActive.value = false;
      touchDecided.value = false;
    },
  });

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const nextWidth = event.nativeEvent.layout.width;
      containerWidthRef.current = nextWidth;
      containerWidth.value = nextWidth;
      onLayout?.(event);
    },
    [containerWidth, onLayout],
  );

  return (
    <HorizontalSwipeContext.Provider value={swipeEnabled ? pan : null}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.fill, style, animatedStyle]} onLayout={handleLayout}>
          {children}
        </Animated.View>
      </GestureDetector>
    </HorizontalSwipeContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
