/**
 * The Settings list, and Settings in two columns where the iPhone Duo's chrome is in place and the content
 * is wide enough for them: the list column (320 pt) on the left with the
 * open page selected, the page (at least 375 pt) on the right, each under its own title row. The rule
 * reads the window's content width, not its orientation (`twoColumnWindow` in layout.ts): in practice
 * the unfolded Duo in landscape. Which page is open comes from the stack (settingsColumns.ts); picking a
 * row replaces the page above Settings, Back leaves Settings, and a page opened from a page (Keyboard's
 * editors, Chat's read-aloud voice) has a Back of its own in the right column. Every other window keeps
 * one column, the screens exactly as before.
 */

import { CommonActions, StackActions, useNavigation, useNavigationState, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
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
import { SETTINGS_PAGE_ORDER, SETTINGS_PAGES, type SettingsPageId } from './pages';
import { LinkRow, SettingsPageEdgesContext, useSettingsStyles } from './SettingsControls';
import { settingsColumnsFor, type ColumnRoute } from './columnRules';

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

/** One row per Settings page, each with its one-line summary; `selected` marks the page open beside it. */
export function SettingsPageList({
  selected,
  onOpen,
}: {
  selected?: SettingsPageId;
  onOpen: (page: SettingsPageId) => void;
}) {
  // Rows report a selection only beside an open page; the one-column list has none.
  const rowSelected = (page: SettingsPageId): boolean | undefined =>
    selected === undefined ? undefined : page === selected;
  return (
    <>
      {SETTINGS_PAGE_ORDER.map((page) => {
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
    </>
  );
}

function isSettingsPageId(value: unknown): value is SettingsPageId {
  return typeof value === 'string' && Object.hasOwn(SETTINGS_PAGES, value);
}

function columnRoute(route: { readonly name: string; readonly params?: object }): ColumnRoute {
  const page =
    route.name === 'SettingsPage' && route.params !== undefined ? Reflect.get(route.params, 'page') : undefined;
  return isSettingsPageId(page) ? { name: route.name, page } : { name: route.name };
}

/**
 * A Settings screen: in two columns the list beside `children` (the open page, under `title`), else
 * `single` (the Settings list itself) or `children` as before. Also gives the screen's side bar its
 * Back and keeps it clear of the keyboard (the pages and editors have text fields).
 */
export function SettingsColumnsFrame({
  title,
  single,
  children,
}: {
  title: string;
  single?: ReactNode;
  children: ReactNode;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const routeKey = useRoute().key;
  const routes = useNavigationState((state) => state.routes);
  const twoColumns = useTwoColumns();
  const columns = useMemo(() => {
    const index = routes.findIndex((route) => route.key === routeKey);
    return twoColumns ? settingsColumnsFor(routes.map(columnRoute), index) : null;
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
    (page: SettingsPageId) => {
      if (settingsIndex === undefined) return;
      const state = navigation.getState();
      // The routes up to Settings as they are (their keys keep those screens mounted), then the page. Only
      // routes and index: the rest of the old state (its key, `stale`, the route names) is the navigator's.
      const kept = state.routes.slice(0, settingsIndex + 1).map(({ key, name, params }) => ({ key, name, params }));
      navigation.dispatch(
        CommonActions.reset({ index: kept.length, routes: [...kept, { name: 'SettingsPage', params: { page } }] }),
      );
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
          <ScrollView
            style={listEdges.scroll}
            contentContainerStyle={[settingsStyles.list, listEdges.content, { paddingBottom: bottom }]}
          >
            <SettingsPageList selected={columns.selected} onOpen={open} />
          </ScrollView>
        </View>
      )}
      <View style={styles.page}>
        {columns === null ? null : (
          <ContentTitleRow
            title={title}
            tint={appearance.foreground}
            onBack={columns.subPage ? () => navigation.goBack() : undefined}
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
