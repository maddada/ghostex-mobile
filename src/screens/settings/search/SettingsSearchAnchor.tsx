/**
 * Where a Settings search result lands: the page's rows register themselves here (by their Settings section, kind
 * and label), and the page opened from a result scrolls to the one it names and flashes it briefly.
 *
 * A row is found by the words it shows, so the shared rows (`SettingsControls`) anchor themselves with no change to
 * the pages; a hand-built row wraps itself in `SettingsSearchAnchor`. A row that is not on screen (a choice that only
 * shows once another is made, a section still loading) falls back to the top of its Settings section.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Animated, StyleSheet, View, type ScrollViewInstance, type ViewInstance } from 'react-native';

import { colorWithOpacity, GhostexRadii } from '../../../theme/palette';
import { useAppearance } from '../../../theme/useAppearance';

export type SettingsSearchAnchorKind = 'row' | 'header';

export type SettingsSearchTarget = { readonly kind: SettingsSearchAnchorKind; readonly label: string };

/**
 * A result's place on its page, carried in the `SettingsPage` route's params. `section` is the `SettingsSection` name
 * ('' for a page without sections); `target` null lands on the section's top. `at` tells two taps of one result apart.
 */
export type SettingsSearchFocus = {
  readonly section: string;
  readonly target: SettingsSearchTarget | null;
  readonly at: number;
};

type Anchor = {
  readonly section: string;
  readonly kind: SettingsSearchAnchorKind;
  readonly label: string;
  readonly view: RefObject<ViewInstance | null>;
  readonly flash: () => void;
};

/** The anchors of one Settings page's scroll view. */
export class SettingsSearchAnchors {
  readonly anchors = new Set<Anchor>();
  onAdd: (() => void) | null = null;

  add(anchor: Anchor): () => void {
    this.anchors.add(anchor);
    this.onAdd?.();
    return () => {
      this.anchors.delete(anchor);
    };
  }
}

const AnchorsContext = createContext<SettingsSearchAnchors | null>(null);

/** The `SettingsSection` a row sits in (its name), so rows with the same words in two sections stay apart. */
export const SettingsSearchSectionContext = createContext('');

type FocusContextValue = {
  readonly focus: SettingsSearchFocus;
  /** The focus already landed (`exact`: on its own row, not the section's top), across the page's layouts. */
  readonly landed: { current: { at: number; exact: boolean } | null };
};

const FocusContext = createContext<FocusContextValue | null>(null);

/** Gives a Settings page the place a search result opened it at. */
export function SettingsSearchFocusProvider({
  focus,
  children,
}: {
  focus: SettingsSearchFocus | undefined;
  children: ReactNode;
}) {
  const landed = useRef<{ at: number; exact: boolean } | null>(null);
  const value = useMemo(() => (focus === undefined ? null : { focus, landed }), [focus]);
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** Room left above the row it scrolls to, so the row reads under the section header above it. */
const REVEAL_TOP = 72;
/** How long a page waits for the row itself before it settles for the top of its section. */
const FALLBACK_AFTER_MS = 900;
/** How long a page keeps looking for rows that load late (a computer's settings). */
const GIVE_UP_AFTER_MS = 4000;
const POLL_MS = 200;

function measureY(scroll: ScrollViewInstance, anchor: Anchor): Promise<number | null> {
  return new Promise((resolve) => {
    const view = anchor.view.current;
    const getNative = (scroll as { getNativeScrollRef?: () => unknown }).getNativeScrollRef;
    const native = typeof getNative === 'function' ? getNative.call(scroll) : scroll;
    if (view == null || native == null) {
      resolve(null);
      return;
    }
    view.measureLayout(
      native as never,
      (_x, y) => resolve(y),
      () => resolve(null)
    );
  });
}

async function reveal(scroll: ScrollViewInstance | null, anchor: Anchor): Promise<void> {
  if (scroll !== null) {
    const y = await measureY(scroll, anchor);
    if (y !== null) scroll.scrollTo({ y: Math.max(0, y - REVEAL_TOP), animated: true });
  }
  anchor.flash();
}

/** The topmost anchor of `section` on screen, or null. */
async function sectionTop(scroll: ScrollViewInstance | null, anchors: readonly Anchor[]): Promise<Anchor | null> {
  if (anchors.length === 0) return null;
  if (scroll === null) return anchors[0] ?? null;
  const measured = await Promise.all(anchors.map(async (anchor) => ({ anchor, y: await measureY(scroll, anchor) })));
  let best: { anchor: Anchor; y: number } | null = null;
  for (const entry of measured) {
    if (entry.y !== null && (best === null || entry.y < best.y)) best = { anchor: entry.anchor, y: entry.y };
  }
  return best?.anchor ?? anchors[0] ?? null;
}

/**
 * The anchors and scroll view of one Settings page's layout, and the landing on the focus the page was opened with:
 * the row as soon as it shows, else (after a moment) the top of its section, upgraded to the row if it shows later.
 */
export function useSettingsSearchLanding(): {
  anchors: SettingsSearchAnchors;
  scrollRef: RefObject<ScrollViewInstance | null>;
} {
  const anchors = useMemo(() => new SettingsSearchAnchors(), []);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const context = useContext(FocusContext);

  useEffect(() => {
    if (context === null) return undefined;
    const { focus, landed } = context;
    const done = (): boolean => landed.current?.at === focus.at && landed.current.exact;
    if (done()) return undefined;
    let live = true;
    const started = Date.now();
    const inSection = (): Anchor[] => [...anchors.anchors].filter((anchor) => anchor.section === focus.section);
    const tryRow = (): boolean => {
      const target = focus.target;
      if (target === null) return false;
      const row = inSection().find((anchor) => anchor.kind === target.kind && anchor.label === target.label);
      if (row === undefined) return false;
      landed.current = { at: focus.at, exact: true };
      // A frame for the rows to lay out before measuring.
      requestAnimationFrame(() => {
        if (live) void reveal(scrollRef.current, row);
      });
      return true;
    };
    let fallingBack = false;
    const tryFallback = (): void => {
      if (fallingBack || landed.current?.at === focus.at || focus.section === '') return;
      const candidates = inSection();
      if (candidates.length === 0) return;
      fallingBack = true;
      landed.current = { at: focus.at, exact: focus.target === null };
      requestAnimationFrame(() => {
        if (!live) return;
        void sectionTop(scrollRef.current, candidates).then((top) => {
          if (live && top !== null) void reveal(scrollRef.current, top);
        });
      });
    };
    const step = (): void => {
      if (!live || done()) return stop();
      if (tryRow()) return stop();
      const waited = Date.now() - started;
      if (focus.target === null || waited >= FALLBACK_AFTER_MS) tryFallback();
      if (waited >= GIVE_UP_AFTER_MS || (focus.target === null && fallingBack)) stop();
    };
    const timer = setInterval(step, POLL_MS);
    const stop = (): void => {
      clearInterval(timer);
      if (anchors.onAdd === step) anchors.onAdd = null;
    };
    anchors.onAdd = step;
    step();
    return () => {
      live = false;
      stop();
    };
  }, [context, anchors]);

  return { anchors, scrollRef };
}

export function SettingsSearchAnchorsProvider({
  anchors,
  children,
}: {
  anchors: SettingsSearchAnchors;
  children: ReactNode;
}) {
  return <AnchorsContext.Provider value={anchors}>{children}</AnchorsContext.Provider>;
}

/**
 * A row (or a section header) a Settings search result can land on, found by `label`, the words it shows. Outside a
 * Settings page's layout it draws its children alone.
 */
export function SettingsSearchAnchor({
  kind = 'row',
  label,
  children,
}: {
  kind?: SettingsSearchAnchorKind;
  label: string;
  children: ReactNode;
}) {
  const anchors = useContext(AnchorsContext);
  if (anchors === null) return <>{children}</>;
  return (
    <RegisteredAnchor anchors={anchors} kind={kind} label={label}>
      {children}
    </RegisteredAnchor>
  );
}

/** How long the found row stays lit: a quick fade in, a hold, then a slow fade out. */
const FLASH_IN_MS = 180;
const FLASH_HOLD_MS = 1100;
const FLASH_OUT_MS = 700;

function RegisteredAnchor({
  anchors,
  kind,
  label,
  children,
}: {
  anchors: SettingsSearchAnchors;
  kind: SettingsSearchAnchorKind;
  label: string;
  children: ReactNode;
}) {
  const section = useContext(SettingsSearchSectionContext);
  const appearance = useAppearance();
  const view = useRef<ViewInstance | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const [lit, setLit] = useState(false);

  const flash = useCallback(() => {
    setLit(true);
    opacity.stopAnimation();
    opacity.setValue(0);
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: FLASH_IN_MS, useNativeDriver: true }),
      Animated.delay(FLASH_HOLD_MS),
      Animated.timing(opacity, { toValue: 0, duration: FLASH_OUT_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setLit(false);
    });
  }, [opacity]);

  useEffect(() => anchors.add({ section, kind, label, view, flash }), [anchors, section, kind, label, flash]);

  return (
    <View ref={view} collapsable={false}>
      {children}
      {lit ? (
        <Animated.View
          pointerEvents='none'
          style={[
            kind === 'header' ? styles.headerGlow : styles.rowGlow,
            {
              opacity,
              borderColor: appearance.accent,
              // A wash of the accent over the row: the row's own surface still shows through (no fill of its own).
              backgroundColor: colorWithOpacity(appearance.accent, 14),
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: GhostexRadii.row,
    borderWidth: 1.5,
  },
  /** Around a section header's words, not the space above it (`sectionHeader`'s 14 pt top margin). */
  headerGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 9,
    bottom: -3,
    borderRadius: GhostexRadii.row,
    borderWidth: 1.5,
  },
});
