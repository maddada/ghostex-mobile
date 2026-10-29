/**
 * The stack screens' header on the iPhone Duo (as Sessions and Terminal do it).
 * The system header stays on every other iPhone (`useStackHeaderOptions` adds this one only for the
 * band and the rail). With the app's root view controller disabling the system's vertical bar the Duo
 * has the band in every pose where the top bar region lies in the status band, and the system header otherwise (e.g. folded with the camera at the bottom):
 * - band: Back, the title and the header buttons stand in the status band beside the status items; the
 *   band is painted with the header's background. Buttons that do not fit beside Back and a title
 *   `BAND_TITLE_MIN` wide move last first into a "…" menu; Back and
 *   the "…" stay. A screen whose title heads its content (Settings in two columns) keeps only Back;
 * - rail: Back and the screen's rail entries (`useStackScreenRail`) stand in the side bar below the
 *   status items, with the same "…" overflow. Unreachable while the app disables the vertical bar; kept
 *   for a system that reports a side bar.
 * Only chrome moves: every button keeps its label and action.
 */

import { useIsFocused } from '@react-navigation/native';
import type { NativeStackHeaderProps, NativeStackNavigationOptions } from '@react-navigation/native-stack';
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DuoChromeCopy } from '../../../copy';
import { GhostexPalette } from '../../../theme/palette';
import ContextMenu, { type MenuAnchor } from '../../sessions/ContextMenu';
import { ChevronLeftIcon, EllipsisIcon } from '../../terminal/icons';
import { CONTENT_ROW_HEIGHT, bandRowFrame, type BandButtons } from './layout';
import type { RailButtons, RailEntry } from './railSlot';
import { useStackRailStore } from './stackRail';
import {
  barBackgroundToEdges,
  railMenuItems,
  useContentTop,
  useHeaderPlacement,
  RoundBarButton,
  useBandOverflow,
  useLiveMenuAnchor,
  useRailButtons,
  useRailOverflow,
  useVerticalBarSpace,
} from './VerticalBarArea';

/** The header row's height, as the system's. */
const ROW_HEIGHT = CONTENT_ROW_HEIGHT;

/** The status band row's side padding and the space between its items. */
const BAND_PADDING = 8;
const BAND_GAP = 4;
/** The Back button's width in the row. */
const BACK_WIDTH = 36;
/** The narrowest the band row leaves the title (about seven characters; longer ones end in an ellipsis). */
const BAND_TITLE_MIN = 64;
/** A screen's header buttons in the band row: round buttons of this size, `BAND_GAP` apart. */
const BAND_BUTTONS: BandButtons = { size: 40, gap: BAND_GAP };
const BAND_GLYPH = 20;

function headerBackground(options: NativeStackNavigationOptions): string {
  const background = StyleSheet.flatten(options.headerStyle)?.backgroundColor;
  return typeof background === 'string' ? background : GhostexPalette.BACKGROUND;
}

export function StackHeader({ navigation, route, options, back }: NativeStackHeaderProps) {
  const placement = useHeaderPlacement();
  const insets = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const focused = useIsFocused();
  const screenRail = useStackRailStore((state) => state.byRoute[route.key]);
  const background = headerBackground(options);
  const tint = options.headerTintColor ?? GhostexPalette.FOREGROUND;
  const title = typeof options.title === 'string' ? options.title : route.name;
  const canGoBack = back !== undefined && options.headerBackVisible !== false;

  // The "…" menu while open: the button it opened from and the entries it held then. It stays open
  // with them across every pose change, standing at its button while the side bar shows it and centred
  // otherwise, until it is closed or used.
  const [openMenu, setOpenMenu] = useState<{ anchor?: MenuAnchor; keys: readonly string[] } | null>(null);
  // The entries the "…" holds now, for its press (`useRailOverflow` is known only after the buttons are).
  const heldKeys = useRef<readonly string[]>([]);
  const onBack = screenRail?.onBack;
  const moreButtonRef = useRef<ViewInstance | null>(null);

  const railButtons = useMemo<RailButtons>(() => {
    const backEntry: RailEntry = {
      key: 'back',
      label: DuoChromeCopy.back,
      icon: (size) => <ChevronLeftIcon size={size} color={tint} />,
      onPress: () => (onBack === undefined ? navigation.goBack() : onBack()),
    };
    const moreEntry: RailEntry = {
      key: 'more',
      label: DuoChromeCopy.more,
      icon: (size) => <EllipsisIcon size={size} color={tint} />,
      onPress: (anchor) => setOpenMenu({ anchor, keys: heldKeys.current }),
    };
    return {
      entries: [...(canGoBack ? [backEntry] : []), ...(screenRail?.entries ?? []), moreEntry],
      pinned: canGoBack ? 1 : 0,
      moreMenu: 'whenNeeded',
      reserveKeyboard: screenRail?.reserveKeyboard ?? false,
    };
  }, [canGoBack, navigation, onBack, screenRail, tint]);
  // More than the "…", which shows only for buttons that do not fit.
  const inRail = placement.kind === 'rail' && focused && railButtons.entries.length > 1;
  useRailButtons(railButtons, background, inRail);
  const railOverflow = useRailOverflow(railButtons, inRail);
  // The status band's row: Back, the title and the screen's buttons. Where they do not all fit
  // beside a title `BAND_TITLE_MIN` wide, the buttons that do not move into the "…" menu, last first.
  const inBand = placement.kind === 'band';
  const bandButtons = useMemo<RailButtons>(
    () => ({
      entries: [...(screenRail?.entries ?? []), railButtons.entries[railButtons.entries.length - 1]],
      pinned: 0,
      moreMenu: 'whenNeeded',
      reserveKeyboard: railButtons.reserveKeyboard,
    }),
    [railButtons, screenRail],
  );
  const bandRoom = inBand
    ? placement.frame.width - 2 * BAND_PADDING - (canGoBack ? BACK_WIDTH + BAND_GAP : 0) - BAND_TITLE_MIN - BAND_GAP
    : 0;
  const bandOverflow = useBandOverflow(bandButtons, bandRoom, BAND_BUTTONS, inBand);
  const overflow = inBand ? bandOverflow.menu : railOverflow;
  useLayoutEffect(() => {
    heldKeys.current = overflow.map((entry) => entry.key);
  }, [overflow]);
  const menuEntries = useMemo(
    () => (openMenu === null ? [] : (screenRail?.entries ?? []).filter((entry) => openMenu.keys.includes(entry.key))),
    [openMenu, screenRail],
  );
  const menuAnchor = useLiveMenuAnchor(
    openMenu === null ? null : { key: 'more', pressed: overflow.length > 0 ? openMenu.anchor : undefined },
    // The band's own "…", while the row shows one; without it the menu is centred.
    inBand && bandOverflow.shows('more') ? moreButtonRef : undefined,
  );
  const menu =
    menuEntries.length > 0 ? (
      <ContextMenu
        visible
        title={title}
        items={railMenuItems(menuEntries, () => setOpenMenu(null))}
        onClose={() => setOpenMenu(null)}
        anchor={menuAnchor}
      />
    ) : null;

  const right: ReactNode = options.headerRight?.({ tintColor: tint, canGoBack: back !== undefined }) ?? null;
  const titleText = (
    <Text style={[styles.title, { color: tint }]} numberOfLines={1} accessibilityRole="header">
      {title}
    </Text>
  );

  let header: ReactNode = null;
  if (placement.kind === 'band') {
    // The "…" shows only while the buttons do not all fit: then the row's own buttons stand in the header's
    // place, round as in the side bar. A screen whose title heads its content (Settings in two columns)
    // keeps only Back here, and Back leaves what the screen says (`onBack`).
    const contentTitles = screenRail?.titleInContent === true;
    const overflowing = bandOverflow.shows('more');
    header = (
      <View style={{ height: insets.top, backgroundColor: background }}>
        <View style={[styles.row, styles.bandRow, bandRowFrame(placement.frame, ROW_HEIGHT)]}>
          {canGoBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={DuoChromeCopy.back}
              hitSlop={8}
              style={styles.backButton}
              onPress={() => (onBack === undefined ? navigation.goBack() : onBack())}
            >
              <ChevronLeftIcon size={22} color={tint} />
            </Pressable>
          ) : null}
          {contentTitles ? <View style={styles.bandSpacer} /> : titleText}
          {contentTitles
            ? null
            : overflowing
              ? bandButtons.entries
                  .filter((entry) => bandOverflow.shows(entry.key))
                  .map((entry) =>
                    entry.key === 'more' ? (
                      <View key={entry.key} ref={moreButtonRef} collapsable={false}>
                        <RoundBarButton entry={entry} size={BAND_BUTTONS.size} glyphSize={BAND_GLYPH} />
                      </View>
                    ) : (
                      <RoundBarButton key={entry.key} entry={entry} size={BAND_BUTTONS.size} glyphSize={BAND_GLYPH} />
                    ),
                  )
              : right}
        </View>
      </View>
    );
  } else if (placement.kind !== 'rail' || screenRail?.titleInContent !== true) {
    // Rail (and, should the placement change under it, top): the title row heads the content, its
    // background running on under the side bar; buttons with rail entries stand in the side bar,
    // any others keep their place at the row's end. Settings in two columns draws a title row over each
    // column itself.
    header = (
      <View style={[{ backgroundColor: background }, barBackgroundToEdges(bar, 0)]}>
        <ContentTitleRow title={title} tint={tint} trailing={screenRail === undefined ? right : null} />
      </View>
    );
  }
  // The menu keeps one place in the tree in every pose, so turning the phone keeps it as it is.
  return (
    <>
      {header}
      {menu}
    </>
  );
}

/**
 * A screen's title row at the top of its content in the side bar's poses: a standard
 * bar's height below the system's top layout margin, the title 17 pt semibold at the content margin;
 * with a Back of its own where it heads a page opened inside a column (Settings in two columns).
 */
export function ContentTitleRow({
  title,
  tint,
  onBack,
  trailing,
}: {
  title: string;
  tint: string;
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  const contentTop = useContentTop();
  // Below a header in the status band the row already starts clear of the status items.
  const bandHeader = useHeaderPlacement().kind === 'band';
  return (
    <View style={{ paddingTop: bandHeader ? 0 : contentTop }}>
      <View style={[styles.row, styles.railRow, onBack === undefined ? null : styles.railRowWithBack]}>
        {onBack === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={DuoChromeCopy.back}
            hitSlop={8}
            style={styles.backButton}
            onPress={onBack}
          >
            <ChevronLeftIcon size={22} color={tint} />
          </Pressable>
        )}
        <Text style={[styles.title, { color: tint }]} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
        {trailing}
      </View>
    </View>
  );
}

/** Stable, so the stack's options do not change identity with every render. */
function renderStackHeader(props: NativeStackHeaderProps) {
  return <StackHeader {...props} />;
}

/**
 * The stack's header options for this window: the iPhone Duo header in the band or the rail, none
 * (the system header) everywhere else.
 */
export function useStackHeaderOptions(): NativeStackNavigationOptions {
  const kind = useHeaderPlacement().kind;
  return useMemo(() => (kind === 'top' ? {} : { header: renderStackHeader }), [kind]);
}

const styles = StyleSheet.create({
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
  },
  bandRow: {
    position: 'absolute',
    paddingHorizontal: 8,
    gap: 4,
  },
  railRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  /** The Back's own width takes the leading margin's place, so the chevron sits where the title would. */
  railRowWithBack: {
    paddingLeft: 4,
  },
  backButton: {
    width: 36,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Where the title would be: keeps the status band's row as wide as its Back. */
  bandSpacer: {
    flex: 1,
  },
  title: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
});
