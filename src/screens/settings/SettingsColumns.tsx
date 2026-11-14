/**
 * The Settings list, and Settings in two columns where the iPhone Duo's chrome is in place and the content
 * is wide enough for them: the list column (320 pt) on the left with the
 * open page selected, the page (at least 375 pt) on the right, each under its own title row. The rule
 * reads the window's content width, not its orientation (`twoColumnWindow` in layout.ts): in practice
 * the unfolded Duo in landscape. Which page is open comes from the stack (columnRules.ts); picking a
 * row shows its page in the page screen above Settings, Back leaves Settings, and a page opened from a
 * page (Keyboard's editors, Chat's read-aloud voice, Interface's terminal palettes, also when Interface is
 * only the page shown beside the bare list) has a Back of its own in the right column. Picking a
 * row keeps the list where it is. Every other window keeps one column, the screens exactly as before.
 */

import { CommonActions, StackActions, useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SETTINGS_LIST_WIDTH, type HorizontalInsets } from '../../components/common/verticalBar/layout';
import { ContentTitleRow } from '../../components/common/verticalBar/StackHeader';
import { useStackScreenRail } from '../../components/common/verticalBar/stackRail';
import {
  useScrollToBarEdges,
  useTwoColumns,
  useVerticalBarSpace,
} from '../../components/common/verticalBar/VerticalBarArea';
import ErrorBoundary from '../../components/common/ErrorBoundary';
import { SettingsCopy } from '../../copy';
import type { RootStackParamList } from '../../navigation/types';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance } from '../../theme/useAppearance';
import { useUpdateNotice } from '../../updates/updateNotice';
import { isDemoMachine } from '../../demo/identity';
import { useMachinesStore } from '../../machines/store';
import { SETTINGS_PAGE_ORDER, SETTINGS_PAGES, type SettingsPageId } from './pages';
import { LinkRow, SettingsPageEdgesContext, useSettingsStyles } from './SettingsControls';
import { settingsColumnsFor, type ColumnRoute } from './columnRules';
import { SettingsSearchField, SettingsSearchResults, useSettingsSearching } from './search/SettingsSearch';
import { StarRequestRows } from './StarRequestRows';
import type { SettingsSearchFocus } from './search/SettingsSearchAnchor';

/** The Updates row with its "update ready" summary, which reads the update state and can throw. */
function UpdatesNoticeRow({ onPress, selected }: { onPress: () => void; selected: boolean | undefined }) {
  const notice = useUpdateNotice();
  return (
    <LinkRow
      title={SETTINGS_PAGES.updates.title}
      description={notice ?? SETTINGS_PAGES.updates.description}
      descriptionAccent={notice !== null}
      selected={selected}
      onPress={onPress}
    />
  );
}

/**
 * The Settings search, then one row per Settings page, each with its one-line summary; `selected` marks the page open
 * beside it. While the search has words the rows give way to what it finds; `focus` is where a found row opens its page.
 */
export function SettingsPageList({
  selected,
  onOpen,
}: {
  selected?: SettingsPageId;
  onOpen: (page: SettingsPageId, focus?: SettingsSearchFocus) => void;
}) {
  // Rows report a selection only beside an open page; the one-column list has none.
  const rowSelected = (page: SettingsPageId): boolean | undefined =>
    selected === undefined ? undefined : page === selected;
  const demoOn = useMachinesStore((state) => state.machines.some((machine) => isDemoMachine(machine)));
  const pages = useMemo(
    (): readonly SettingsPageId[] => (demoOn ? [...SETTINGS_PAGE_ORDER, 'demo'] : SETTINGS_PAGE_ORDER),
    [demoOn],
  );
  const searching = useSettingsSearching();
  return (
    <>
      <SettingsSearchField />
      {searching ? <SettingsSearchResults pages={pages} onOpen={onOpen} /> : null}
      {searching ? null : pages.map((page) => {
        const open = () => onOpen(page);
        if (page === 'updates') {
          // A throwing summary falls back to the plain row, so the list and the Updates page stay reachable.
          return (
            <ErrorBoundary
              key={page}
              name="settings:home:updates-notice"
              renderFallback={() => (
                <LinkRow
                  title={SETTINGS_PAGES[page].title}
                  description={SETTINGS_PAGES[page].description}
                  selected={rowSelected(page)}
                  onPress={open}
                />
              )}
            >
              <UpdatesNoticeRow selected={rowSelected(page)} onPress={open} />
            </ErrorBoundary>
          );
        }
        return (
          <LinkRow
            key={page}
            title={SETTINGS_PAGES[page].title}
            description={SETTINGS_PAGES[page].description}
            selected={rowSelected(page)}
            onPress={open}
          />
        );
      })}
      {searching ? null : <StarRequestRows />}
    </>
  );
}

function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === 'string' && Object.hasOwn(SETTINGS_PAGES, value);
}

function isListedPage(page: SettingsPageId): boolean {
  if (page === 'demo') return useMachinesStore.getState().machines.some((machine) => isDemoMachine(machine));
  return SETTINGS_PAGE_ORDER.includes(page);
}

function columnRoute(route: { readonly name: string; readonly params?: object }): ColumnRoute {
  const page =
    route.name === 'SettingsPage' && route.params !== undefined ? Reflect.get(route.params, 'page') : undefined;
  return isSettingsPageId(page) ? { name: route.name, page } : { name: route.name };
}

/** Where the list starts on this screen: where it stood when a row opened the screen's page, else the top. */
function carriedListOffset(params: object | undefined): number {
  const offset = params === undefined ? undefined : Reflect.get(params, 'listOffset');
  return typeof offset === 'number' && Number.isFinite(offset) ? offset : 0;
}

/**
 * The list column's scroll view. It starts at `start` when it mounts (a changed `contentOffset` would
 * scroll it, so later values are not passed on), and a row tap hands on where the list stands.
 */
function SettingsListScroll({
  start,
  selected,
  onOpen,
  style,
  contentContainerStyle,
}: {
  start: number;
  selected: SettingsPageId;
  onOpen: (page: SettingsPageId, listOffset: number, focus?: SettingsSearchFocus) => void;
  style: StyleProp<ViewStyle>;
  contentContainerStyle: StyleProp<ViewStyle>;
}) {
  const [contentOffset] = useState(() => ({ x: 0, y: start }));
  const offset = useRef(start);
  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y;
  }, []);
  const openHere = useCallback(
    (page: SettingsPageId, focus?: SettingsSearchFocus) => onOpen(page, offset.current, focus),
    [onOpen],
  );
  return (
    <ScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      contentOffset={contentOffset}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      scrollEventThrottle={16}
      onScroll={onScroll}
    >
      <SettingsPageList selected={selected} onOpen={openHere} />
    </ScrollView>
  );
}

/**
 * A Settings screen: in two columns the list beside `children` (the open page, under `title`), else
 * `single` (the Settings list itself) or `children` as before. Also gives the screen's side bar its
 * Back and keeps it clear of the keyboard (the pages and editors have text fields).
 */
export function SettingsColumnsFrame({
  title,
  single,
  trailing,
  children,
}: {
  title: string;
  single?: ReactNode;
  /** The page's header button (its `headerRight`), drawn in its own title row in two columns. */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const routeKey = route.key;
  const routes = useNavigationState((state) => state.routes);
  const twoColumns = useTwoColumns();
  const columns = useMemo(() => {
    const index = routes.findIndex((route) => route.key === routeKey);
    return twoColumns ? settingsColumnsFor(routes.map(columnRoute), index, isListedPage) : null;
  }, [routes, routeKey, twoColumns]);
  const settingsIndex = columns?.settingsIndex;

  // The side bar's Back leaves Settings, however deep the right column is.
  const leave = useCallback(() => {
    if (settingsIndex === undefined) return;
    const index = navigation.getState().routes.findIndex((route) => route.key === routeKey);
    navigation.dispatch(StackActions.pop(index - settingsIndex + 1));
  }, [navigation, routeKey, settingsIndex]);

  // A row opens its page beside the list, in place of the page open there.
  const open = useCallback(
    (page: SettingsPageId, listOffset: number, focus?: SettingsSearchFocus) => {
      if (settingsIndex === undefined) return;
      const state = navigation.getState();
      // The routes up to Settings as they are (their keys keep those screens mounted), then the page. Only
      // routes and index: the rest of the old state (its key, `stale`, the route names) is the navigator's.
      const kept = state.routes.slice(0, settingsIndex + 1).map(({ key, name, params }) => ({ key, name, params }));
      // The page screen above Settings keeps its key, so the navigator keeps that screen and only its page
      // changes; its list, when it is the one on screen, stays where it is. A page opened from it closes.
      // The first page opened from the bare list, and a page screen a page opened from it covered, draw a
      // list of their own, which starts where the list on screen stood (`listOffset`).
      const opened = state.routes[settingsIndex + 1];
      const pageRoute = {
        key: opened?.name === 'SettingsPage' ? opened.key : undefined,
        name: 'SettingsPage' as const,
        params: { page, listOffset, focus },
      };
      navigation.dispatch(CommonActions.reset({ index: kept.length, routes: [...kept, pageRoute] }));
    },
    [navigation, settingsIndex],
  );

  const split = columns !== null;
  // A Settings screen with another one above it is out of sight (two columns change screens without an
  // animation), so it leaves the list to the screen on top: the stack holds one list, not one per screen.
  const covered = routes.at(-1)?.key !== routeKey;
  useStackScreenRail(
    useMemo(
      () => ({ entries: [], reserveKeyboard: true, titleInContent: split, onBack: split ? leave : undefined }),
      [leave, split],
    ),
  );

  const appearance = useAppearance();
  const settingsStyles = useSettingsStyles();
  const bar = useVerticalBarSpace();
  const { bottom } = useSafeAreaInsets();
  // In two columns the list's scroll view reaches over a side bar on its side, the page's over one on
  // the other.
  const listInsets = useMemo<HorizontalInsets>(() => ({ left: bar.left, right: 0 }), [bar.left]);
  const pageEdges = useMemo<HorizontalInsets>(() => ({ left: 0, right: bar.right }), [bar.right]);
  const listEdges = useScrollToBarEdges(settingsStyles.list, listInsets);
  // One tree in both layouts, so turning the phone keeps the page's state (a draft, its scroll, focus):
  // two columns add the list before the page and a title row over it, never a new parent.
  return (
    <View style={split ? [styles.columns, { backgroundColor: appearance.background }] : styles.page}>
      {columns === null || covered ? null : (
        <View style={[styles.list, { borderRightColor: appearance.border }]}>
          <ContentTitleRow title={SettingsCopy.title} tint={appearance.foreground} />
          <SettingsListScroll
            start={carriedListOffset(route.params)}
            selected={columns.selected}
            onOpen={open}
            style={listEdges.scroll}
            contentContainerStyle={[settingsStyles.list, listEdges.content, { paddingBottom: bottom }]}
          />
        </View>
      )}
      <View style={styles.page}>
        {columns === null ? null : (
          <ContentTitleRow
            title={title}
            tint={appearance.foreground}
            onBack={columns.subPage ? () => navigation.goBack() : undefined}
            trailing={trailing}
          />
        )}
        <SettingsPageEdgesContext.Provider value={split ? pageEdges : null}>
          {columns === null && single !== undefined ? single : children}
        </SettingsPageEdgesContext.Provider>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  columns: {
    flex: 1,
    flexDirection: 'row',
  },
  list: {
    width: SETTINGS_LIST_WIDTH,
    borderRightWidth: GhostexStrokeWidth,
  },
  page: {
    flex: 1,
  },
});
