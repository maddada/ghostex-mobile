/**
 * Holding a tab and dragging it (`TerminalTabsBar`'s tabs start it): the tab lifts and follows the finger over the
 * whole screen, the other tabs of a bar slide to make room where it would land, and letting go puts it there
 * (`model.ts` says where). On a wide window with one bar the chat's right half is a drop zone that opens the tab beside
 * the rest; with two bars a tab drags from one to the other, or onto the other side's chat. A light tap on lift and
 * on a drop that moves the tab. A held tab near a scrolling bar's end scrolls that bar, faster the nearer, so a tab
 * reaches any place in a strip too long to show (`edgeScrollSpeed`).
 *
 * The screen owns one drag (`useTabDrag`), hands it to its tab bars and chat areas (they register their views, which
 * the drag measures when a tab lifts), and draws `TabDragOverlay` over them: the lifted tab and the drop zones.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type RefObject } from 'react';
import { StyleSheet, Text, View, type ViewInstance } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';

import type { TabSide } from '../../../terminal/tabSplit';
import { colorWithOpacity, GhostexPalette } from '../../../theme/palette';
import { terminalChrome } from '../../../theme/terminalColours';
import { PanesIcon } from '../icons';
import { stripFadeColor, TAB_SPACING } from '../tabStrip';
import {
  dropMoves,
  dropTarget,
  edgeScrollSpeed,
  scrolledBar,
  splitZone,
  tabShifts,
  type BarFrames,
  type BarId,
  type DropTarget,
  type DropZones,
  type Rect,
} from './model';

/** A bar's views, which the drag measures when a tab lifts. */
export type BarHandle = {
  readonly track: RefObject<ViewInstance | null>;
  /** Its tabs' views by session key. */
  readonly slots: Map<string, ViewInstance>;
  /** Its tabs' session keys in order. */
  readonly keys: () => readonly string[];
  /**
   * A scrolling strip scrolls on by `dx` points (negative: back toward its start), within its ends, and says how far it
   * went; absent for a bar whose tabs all show.
   */
  readonly scrollBy?: (dx: number) => number;
};

/** A chat area a tab drops on: the only chat (`chat`), or one side's. */
export type ChatZoneId = 'chat' | TabSide;

export type HeldTab = { readonly key: string; readonly from: BarId; readonly title: string };

export type TabDropRequest =
  | { readonly kind: 'bar'; readonly key: string; readonly bar: BarId; readonly index: number }
  | { readonly kind: 'split'; readonly key: string }
  | { readonly kind: 'side'; readonly key: string; readonly side: TabSide };

type Measured = {
  readonly bars: BarFrames[];
  readonly zones: DropZones;
  readonly lifted: Rect;
};

/** What the tab bars and the chat areas use of the screen's drag. */
export type TabDrag = {
  registerBar: (id: BarId, handle: BarHandle) => () => void;
  registerChat: (id: ChatZoneId, view: ViewInstance | null) => void;
  /** A tab held long enough to lift, the finger at window point (`x`, `y`). */
  begin: (tab: HeldTab, x: number, y: number) => void;
  move: (x: number, y: number) => void;
  /** The finger lifted from held tab `key` (`canceled`: the system took the touch, nothing moves). */
  end: (key: string, x: number, y: number, canceled: boolean) => void;
  held: HeldTab | null;
  /** How far each tab of bar `id` slides now, or null while no tab is held. */
  shiftsFor: (id: BarId) => ReadonlyMap<string, number> | null;
};

/** The drag and what its overlay draws. */
export type TabDragController = TabDrag & {
  readonly measured: Measured | null;
  readonly target: DropTarget | null;
  readonly finger: { readonly x: SharedValue<number>; readonly y: SharedValue<number> };
  readonly grab: { readonly x: SharedValue<number>; readonly y: SharedValue<number> };
};

export type TabDragOptions = {
  /** Whether a drop on the chat's right half may open tab `key` beside the rest (a wide window with one bar). */
  canSplit: (key: string) => boolean;
  onDrop: (request: TabDropRequest) => void;
};

function measure(view: ViewInstance | null | undefined): Promise<Rect | null> {
  if (view === null || view === undefined) return Promise.resolve(null);
  return new Promise((resolve) => view.measureInWindow((x, y, width, height) => resolve({ x, y, width, height })));
}

function sameTarget(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'bar') return b.kind === 'bar' && a.bar === b.bar && a.index === b.index;
  if (a.kind === 'side') return b.kind === 'side' && a.side === b.side;
  return b.kind === a.kind;
}

/** The screen's tab drag. */
export function useTabDrag({ canSplit, onDrop }: TabDragOptions): TabDragController {
  const bars = useRef(new Map<BarId, BarHandle>());
  const chats = useRef(new Map<ChatZoneId, ViewInstance>());
  const [held, setHeld] = useState<HeldTab | null>(null);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  // The latest of each for the gesture's callbacks, which outlive a render.
  const live = useRef<{
    held: HeldTab | null;
    measured: Measured | null;
    target: DropTarget | null;
    x: number;
    y: number;
  }>({ held: null, measured: null, target: null, x: 0, y: 0 });
  // How far each scrolling bar scrolled since the drag measured it, and the frame loop that scrolls them.
  const scrolled = useRef(new Map<BarId, number>());
  const frame = useRef<number | null>(null);
  const options = useRef({ canSplit, onDrop });
  options.current = { canSplit, onDrop };
  // The lifted tab follows the finger on the UI thread: where the finger is, less where on the tab it was held.
  const fingerX = useSharedValue(0);
  const fingerY = useSharedValue(0);
  const grabX = useSharedValue(0);
  const grabY = useSharedValue(0);

  const retarget = useCallback((x: number, y: number): void => {
    const state = live.current;
    if (state.held === null || state.measured === null) return;
    const { zones } = state.measured;
    const bars = zones.bars.map((bar) => scrolledBar(bar, scrolled.current.get(bar.id) ?? 0));
    const next = dropTarget({ ...zones, bars }, state.held.key, state.held.from, x, y);
    if (sameTarget(next, state.target)) return;
    state.target = next;
    setTarget(next);
  }, []);

  // While the finger holding a tab is near a scrolling bar's end, that bar scrolls a little every frame, and where the
  // tab would land follows the tabs passing under the finger.
  const stopScrolling = useCallback((): void => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);
  const scrollStep = useCallback((): void => {
    frame.current = null;
    const state = live.current;
    if (state.held === null || state.measured === null) return;
    let scrolling = false;
    let moved = false;
    for (const bar of state.measured.bars) {
      const scrollBy = bars.current.get(bar.id)?.scrollBy;
      const speed = scrollBy === undefined ? 0 : edgeScrollSpeed(bar.track, state.x, state.y);
      if (speed === 0 || scrollBy === undefined) continue;
      scrolling = true;
      const went = scrollBy(speed);
      if (went !== 0) {
        scrolled.current.set(bar.id, (scrolled.current.get(bar.id) ?? 0) + went);
        moved = true;
      }
    }
    if (moved) retarget(state.x, state.y);
    // At a strip's end nothing moves any more: the loop rests until the finger moves again.
    if (scrolling && moved) frame.current = requestAnimationFrame(scrollStep);
  }, [retarget]);
  const keepScrolling = useCallback((): void => {
    if (frame.current === null) frame.current = requestAnimationFrame(scrollStep);
  }, [scrollStep]);

  const registerBar = useCallback((id: BarId, handle: BarHandle) => {
    bars.current.set(id, handle);
    return () => {
      if (bars.current.get(id) === handle) bars.current.delete(id);
    };
  }, []);

  const registerChat = useCallback((id: ChatZoneId, view: ViewInstance | null) => {
    if (view === null) chats.current.delete(id);
    else chats.current.set(id, view);
  }, []);

  const begin = useCallback(
    (tab: HeldTab, x: number, y: number): void => {
      fingerX.value = x;
      fingerY.value = y;
      live.current = { held: tab, measured: null, target: null, x, y };
      scrolled.current.clear();
      stopScrolling();
      setHeld(tab);
      setTarget(null);
      setMeasured(null);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      void (async () => {
        const frames: BarFrames[] = [];
        for (const [id, handle] of bars.current) {
          const track = await measure(handle.track.current);
          if (track === null) continue;
          const slots: { key: string; rect: Rect }[] = [];
          for (const key of handle.keys()) {
            const rect = await measure(handle.slots.get(key));
            if (rect !== null) slots.push({ key, rect });
          }
          frames.push({ id, track, slots });
        }
        const chat = await measure(chats.current.get('chat'));
        const sides: { side: TabSide; rect: Rect }[] = [];
        for (const side of ['left', 'right'] as const) {
          const rect = await measure(chats.current.get(side));
          if (rect !== null) sides.push({ side, rect });
        }
        if (live.current.held !== tab) return;
        const lifted = frames.find((bar) => bar.id === tab.from)?.slots.find((slot) => slot.key === tab.key)?.rect;
        if (lifted === undefined) return;
        grabX.value = x - lifted.x;
        grabY.value = y - lifted.y;
        const next: Measured = {
          bars: frames,
          zones: { bars: frames, splitChat: chat !== null && options.current.canSplit(tab.key) ? chat : null, sides },
          lifted,
        };
        live.current.measured = next;
        setMeasured(next);
        retarget(live.current.x, live.current.y);
        keepScrolling();
      })();
    },
    [fingerX, fingerY, grabX, grabY, retarget, stopScrolling, keepScrolling],
  );

  const move = useCallback(
    (x: number, y: number): void => {
      fingerX.value = x;
      fingerY.value = y;
      live.current.x = x;
      live.current.y = y;
      retarget(x, y);
      keepScrolling();
    },
    [fingerX, fingerY, retarget, keepScrolling],
  );

  const end = useCallback(
    (key: string, x: number, y: number, canceled: boolean): void => {
      const state = live.current;
      const tab = state.held;
      if (tab === null || tab.key !== key) return;
      stopScrolling();
      if (!canceled) retarget(x, y);
      const landing = canceled ? null : state.target;
      const moves = state.measured !== null && dropMoves(landing, state.measured.bars, tab.key, tab.from);
      live.current = { held: null, measured: null, target: null, x, y };
      setHeld(null);
      setMeasured(null);
      setTarget(null);
      if (!moves || landing === null) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
      const { onDrop: drop } = options.current;
      if (landing.kind === 'bar') drop({ kind: 'bar', key: tab.key, bar: landing.bar, index: landing.index });
      else if (landing.kind === 'split') drop({ kind: 'split', key: tab.key });
      else drop({ kind: 'side', key: tab.key, side: landing.side });
    },
    [retarget, stopScrolling],
  );

  const shifts = useMemo(() => {
    const result = new Map<BarId, Map<string, number>>();
    if (held === null || measured === null) return result;
    for (const bar of measured.bars) {
      result.set(bar.id, tabShifts(bar, held.key, target, TAB_SPACING, measured.lifted.width));
    }
    return result;
  }, [held, measured, target]);
  useEffect(() => stopScrolling, [stopScrolling]);
  const shiftsFor = useCallback(
    (id: BarId): ReadonlyMap<string, number> | null => (held === null ? null : (shifts.get(id) ?? new Map())),
    [held, shifts],
  );

  return useMemo<TabDragController>(
    () => ({
      registerBar,
      registerChat,
      begin,
      move,
      end,
      held,
      shiftsFor,
      measured,
      target,
      finger: { x: fingerX, y: fingerY },
      grab: { x: grabX, y: grabY },
    }),
    [registerBar, registerChat, begin, move, end, held, shiftsFor, measured, target, fingerX, fingerY, grabX, grabY],
  );
}

/** The chat's area as a drop zone for held tabs: the only chat (`chat`) or one side's. Draws nothing. */
export function ChatDropZone({ drag, id }: { drag: TabDrag | null; id: ChatZoneId }) {
  const registerChat = drag?.registerChat;
  const ref = useRef<ViewInstance>(null);
  useEffect(() => {
    if (registerChat === undefined) return undefined;
    registerChat(id, ref.current);
    return () => registerChat(id, null);
  }, [registerChat, id]);
  return <View ref={ref} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />;
}

function relative(rect: Rect, origin: Rect): Rect {
  return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
}

/**
 * Over the screen while a tab is held: the drop zones and the lifted tab. Stands over the whole screen view (as its
 * last child, filling it), takes no touches, and draws nothing while no tab is held.
 */
export function TabDragOverlay({
  drag,
  headerColor,
}: {
  drag: TabDragController;
  /** The header colour the tabs stand on (`#rrggbb`): the lifted tab takes its look. */
  headerColor: string;
}) {
  const ref = useRef<ViewInstance>(null);
  const [origin, setOrigin] = useState<Rect | null>(null);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const { held, measured, target, finger, grab } = drag;
  // Where the overlay stands in the window, for the window points the drag measures.
  useEffect(() => {
    if (held === null) return;
    void measure(ref.current).then((rect) => {
      if (rect === null) return;
      originX.value = rect.x;
      originY.value = rect.y;
      setOrigin(rect);
    });
  }, [held, originX, originY]);
  const liftedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: finger.x.value - grab.x.value - originX.value },
      { translateY: finger.y.value - grab.y.value - originY.value },
      { scale: LIFT_SCALE },
    ],
  }));
  const ready = held !== null && measured !== null && origin !== null;
  return (
    <View ref={ref} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill}>
      {ready ? (
        <>
          {measured.zones.splitChat !== null ? (
            <DropZone
              rect={relative(splitZone(measured.zones.splitChat), origin)}
              label="Open side by side"
              active={target?.kind === 'split'}
              headerColor={headerColor}
            />
          ) : null}
          {measured.zones.sides
            .filter(({ side }) => side !== held.from && target?.kind === 'side' && target.side === side)
            .map(({ side, rect }) => (
              <DropZone
                key={side}
                rect={relative(rect, origin)}
                label="Move to this side"
                active
                headerColor={headerColor}
              />
            ))}
          <LiftedTab title={held.title} size={measured.lifted} headerColor={headerColor} style={liftedStyle} />
        </>
      ) : null}
    </View>
  );
}

/**
 * Where a drop opens the tab: an accent outline and wash, stronger under the finger, never a dark fill. Its label
 * stands near the top, clear of the finger, on the tab track's tone in the header's ink so it reads on a light or a
 * dark chat.
 */
function DropZone({
  rect,
  label,
  active,
  headerColor,
}: {
  rect: Rect;
  label: string;
  active: boolean;
  headerColor: string;
}) {
  const accent = GhostexPalette.ACCENT;
  const chrome = terminalChrome(headerColor);
  return (
    <View
      testID={active ? 'tab-drop-zone-active' : 'tab-drop-zone'}
      style={[
        styles.zone,
        {
          left: rect.x + ZONE_INSET,
          top: rect.y + ZONE_INSET,
          width: Math.max(0, rect.width - ZONE_INSET * 2),
          height: Math.max(0, rect.height - ZONE_INSET * 2),
          borderColor: colorWithOpacity(accent, active ? 90 : 45),
          backgroundColor: colorWithOpacity(accent, active ? 16 : 6),
        },
      ]}
    >
      <View
        style={[
          styles.zoneLabel,
          {
            backgroundColor: stripFadeColor(headerColor, chrome.ink),
            borderColor: colorWithOpacity(accent, active ? 80 : 45),
          },
        ]}
      >
        <PanesIcon across size={16} color={chrome.foreground} />
        <Text style={[styles.zoneText, { color: chrome.foreground }]}>{label}</Text>
      </View>
    </View>
  );
}

/** The held tab over everything, as it looks in the bar when selected, a touch larger. */
function LiftedTab({
  title,
  size,
  headerColor,
  style,
}: {
  title: string;
  size: Rect;
  headerColor: string;
  style: ComponentProps<typeof Animated.View>['style'];
}) {
  const chrome = terminalChrome(headerColor);
  return (
    <Animated.View
      testID="tab-lifted"
      style={[
        styles.lifted,
        {
          width: size.width,
          height: size.height,
          borderRadius: size.height / 2,
          // The track's colour over the header, opaque so the chat under it does not show through, with the selected
          // tab's ink wash on it.
          backgroundColor: stripFadeColor(headerColor, chrome.ink),
          borderColor: colorWithOpacity(chrome.ink, 22),
        },
        style,
      ]}
    >
      <View
        style={[
          styles.liftedWash,
          { borderRadius: size.height / 2, backgroundColor: colorWithOpacity(chrome.ink, 18) },
        ]}
      >
        <Text style={[styles.liftedTitle, { color: chrome.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>
    </Animated.View>
  );
}

const ZONE_INSET = 8;
/** How much larger the held tab is than in its bar: lifted off it. */
const LIFT_SCALE = 1.05;

const styles = StyleSheet.create({
  zone: {
    position: 'absolute',
    borderWidth: 1.5,
    borderRadius: 18,
    alignItems: 'center',
    paddingTop: 28,
  },
  zoneLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  zoneText: {
    fontSize: 14,
    fontWeight: '600',
  },
  lifted: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderWidth: 1,
    overflow: 'hidden',
  },
  liftedWash: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  liftedTitle: {
    fontSize: 14,
  },
});
