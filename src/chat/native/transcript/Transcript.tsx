/**
 * The transcript list. An inverted `FlatList` keeps the newest turn pinned to the bottom while the
 * reader is there and leaves their place alone when they have scrolled up (desktop's follow-tail
 * list, `scroll_bottom.rs`); older turns page in on their own near the top (`pagination.rs`), and
 * the Scroll to bottom pill comes up once the reader has left the bottom. Rows are keyed by
 * `transcriptItemKey`, and the host keeps unchanged items' identity across splices, so a frame
 * re-renders only the rows that moved.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { useSettingsStore } from '../../../settings/store';
import { transcriptItemKey, type TranscriptItem } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { EmptyTranscript } from '../cards';
import {
  ChatImagesProvider,
  RowDetailsProvider,
  TranscriptEnvProvider,
  TranscriptFlagsProvider,
  transcriptFlags,
  type TranscriptEnv,
} from './context';
import { arr, num, obj, str } from './json';
import { useTranscriptTheme } from './theme';
import { TranscriptItemView } from './TranscriptItemRow';

/**
 * `scroll-bottom.json`: the pill's look and how far from the bottom it appears.
 *
 * CDXC:Mobile 2026-09-12 DECISION:
 * User: do not show the Ctrl+Shift+Down shortcut on the mobile Scroll to bottom button.
 */
const SCROLL_BOTTOM = { label: 'Scroll to bottom', edgeThreshold: 10, height: 24, fontSize: 11, paddingX: 10, bottom: 4 };
/**
 * The composer's scroll collapse (`composer_scroll.rs`): at or under this many points from the end
 * the reader is at the bottom (`COMPOSER_BOTTOM_THRESHOLD_PX` in the core).
 */
const COMPOSER_BOTTOM_THRESHOLD = 10;
/**
 * About how much shorter the collapsed composer is than the open one (its pills and toolbar row
 * plus their gap): a scroll that stays within this much of the end is not a collapse gesture,
 * because collapsing there uncovers no rows (desktop's `collapse_travel` guard).
 */
const COMPOSER_COLLAPSE_TRAVEL = 56;
/** Space above the first row, and below the last (`transcript-layout.json`). */
const TOP_PADDING = 32;
const END_PADDING = 16;
const ROW_MAX_WIDTH = 768;

const EMPTY_DETAILS = {};
const EMPTY_IMAGES = {};

export type NativeTranscriptProps = {
  chat: RustChat;
  /** The rows to draw; the main transcript by default. */
  items?: readonly TranscriptItem[];
  /** False for a subagent's rows: no rewind, and the normal display mode. */
  main?: boolean;
};

type Row = { item: TranscriptItem; index: number };

export { useTranscriptTheme } from './theme';

/** The providers every transcript row reads: how the list draws, the document's row flags, details and images. */
export function TranscriptScope({ chat, main, children }: { chat: RustChat; main: boolean; children: ReactNode }) {
  const theme = useTranscriptTheme();
  const verboseSetting = useSettingsStore((store) => store.settings.sessionChatVerboseMode);
  const filePreviews = useSettingsStore((store) => store.settings.sessionChatFileEditPreviews);
  const state = chat.state;
  const document = state?.document ?? null;
  // A subagent's transcript uses the normal display, whatever the main chat's mode (desktop DECISION).
  const verbose = main ? (document?.verboseOverride ?? verboseSetting) : false;
  const env = useMemo<TranscriptEnv>(
    () => ({ dispatch: chat.dispatch, theme, verbose, filePreviews: main && filePreviews, main }),
    [chat.dispatch, filePreviews, main, theme, verbose]
  );
  // The document is parsed afresh per frame, so the flags are keyed by their content.
  const flagsSignature =
    document === null
      ? ''
      : JSON.stringify([
          document.finalIds,
          document.savedPrompts,
          document.rewindAvailable,
          document.rewindEnabled,
          obj(document.composerActions)?.stash,
          document.deferredWork,
        ]);
  const flags = useMemo(() => transcriptFlags(document), [flagsSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TranscriptEnvProvider value={env}>
      <TranscriptFlagsProvider value={flags}>
        <RowDetailsProvider value={state?.rowDetails ?? EMPTY_DETAILS}>
          <ChatImagesProvider value={state?.images ?? EMPTY_IMAGES}>{children}</ChatImagesProvider>
        </RowDetailsProvider>
      </TranscriptFlagsProvider>
    </TranscriptEnvProvider>
  );
}

/**
 * The subagent viewer's row renderer (`NativeChatOverlays`' `renderTranscriptItem`): the same rows
 * as the main list, in the normal display mode and without rewind.
 */
export function useSubagentRowRenderer(chat: RustChat): (item: TranscriptItem, index: number) => ReactNode {
  return useCallback(
    (item: TranscriptItem) => (
      <TranscriptScope chat={chat} main={false}>
        <View style={styles.subagentRow}>
          <TranscriptItemView item={item} />
        </View>
      </TranscriptScope>
    ),
    [chat]
  );
}

export function NativeTranscript({ chat, items, main = true }: NativeTranscriptProps) {
  const theme = useTranscriptTheme();
  const state = chat.state;
  const document = state?.document ?? null;
  const rows = items ?? state?.items ?? [];
  const { dispatch } = chat;

  const listRef = useRef<FlatList<Row>>(null);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const data = useMemo(() => {
    const reversed: Row[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) reversed.push({ item: rows[index]!, index });
    return reversed;
  }, [rows]);

  // Transcript search: tint the rows that matched, and bring the selected one into view once per
  // explicit navigation (`search.rs`).
  const search = main ? obj(document?.transcriptSearch) : null;
  const searchKey = JSON.stringify(search?.items ?? null);
  const searchItems = useMemo(
    () => new Set(arr(search?.items).filter((value): value is number => typeof value === 'number')),
    [searchKey] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activeItem = num(search, 'activeItem');
  const searchRevision = num(search, 'revision');
  const searchOpen = search !== null;
  const scrolledRevision = useRef<number | null>(null);
  useEffect(() => {
    if (!searchOpen) {
      scrolledRevision.current = null;
      return;
    }
    if (activeItem === null || searchRevision === scrolledRevision.current) return;
    scrolledRevision.current = searchRevision;
    const position = rows.length - 1 - activeItem;
    if (position >= 0 && position < rows.length) {
      listRef.current?.scrollToIndex({ index: position, viewPosition: 0.5, animated: true });
    }
  }, [activeItem, rows.length, searchOpen, searchRevision]);

  const hasMore = main && document?.hasMore === true;
  const loadingEarlier = document?.loadingEarlier === true;
  const loadEarlier = useCallback(() => {
    if (hasMore && !loadingEarlier) dispatch({ type: 'loadEarlier' });
  }, [dispatch, hasMore, loadingEarlier]);

  // The composer collapses while the reader scrolls the transcript and opens again at the end
  // (`composer_scroll.rs`). Desktop reports wheel events; a phone reports the finger's drag and the
  // fling after it. The core owns the gesture's threshold and timing (`composerScroll`).
  const collapseEligible =
    main &&
    document?.composerCollapseEligible === true &&
    !(document.questionCard?.visible === true && str(document.prompt, 'kind') === 'question');
  const collapse = useRef({ eligible: false, collapsed: false, userScrolling: false, offset: 0 });
  collapse.current.eligible = collapseEligible;
  collapse.current.collapsed = main && document?.composerCollapsed === true;
  const startUserScroll = useCallback(() => {
    collapse.current.userScrolling = true;
  }, []);
  const endUserScroll = useCallback(() => {
    collapse.current.userScrolling = false;
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
      // Inverted: the offset is the distance from the bottom.
      const offset = contentOffset.y;
      setAwayFromBottom(offset > SCROLL_BOTTOM.edgeThreshold);
      const state = collapse.current;
      const previous = state.offset;
      state.offset = offset;
      if (!main) return;
      // Following the newest turn again opens a collapsed box (desktop's scroll handler).
      if (state.collapsed) {
        if (offset <= COMPOSER_BOTTOM_THRESHOLD) dispatch({ type: 'composerExpand' });
        return;
      }
      const delta = offset - previous;
      if (!state.userScrolling || !state.eligible || delta === 0) return;
      const distanceToEnd = Math.max(0, previous);
      if (Math.max(0, distanceToEnd + delta) < COMPOSER_COLLAPSE_TRAVEL) return;
      const distanceToTop = Math.max(0, contentSize.height - layoutMeasurement.height - previous);
      dispatch({
        type: 'composerScroll',
        delta,
        distanceToEnd,
        canScroll: delta > 0 ? distanceToTop > 0 : distanceToEnd > 0,
        eligible: true,
      });
    },
    [dispatch, main]
  );

  const jumpToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    dispatch({ type: 'composerExpand' });
  }, [dispatch]);

  // Settings > Chat's custom transcript width (desktop's `transcript_width`): the rows take that
  // share of the pane instead of the composer's 768pt column.
  const customWidth = useSettingsStore((store) => store.settings.sessionChatCustomTranscriptWidthEnabled);
  const widthPercent = useSettingsStore((store) => store.settings.sessionChatTranscriptWidthPercent);
  const rowWidth = main && customWidth ? widthPercent : null;

  const lastIndex = rows.length - 1;
  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<Row>) => (
      <TranscriptRowFrame
        item={row.item}
        first={row.index === 0}
        last={row.index === lastIndex}
        tint={searchItems.has(row.index) ? (activeItem === row.index ? theme.searchActive : theme.searchHit) : null}
        widthPercent={rowWidth}
      />
    ),
    [activeItem, lastIndex, rowWidth, searchItems, theme]
  );

  const keyExtractor = useCallback((row: Row) => transcriptItemKey(row.item), []);

  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.5, animated: true }), 120);
  }, []);

  let body: ReactNode;
  if (rows.length === 0) {
    body =
      main && hasMore ? (
        // React's one manual case: a transcript with no rows yet.
        <View style={styles.empty}>
          <Pressable onPress={loadEarlier} style={[styles.button, { borderColor: theme.border }]} accessibilityRole='button'>
            <Text style={[styles.buttonText, { color: theme.primary }]}>{loadingEarlier ? 'Loading earlier turns…' : 'Load earlier turns'}</Text>
          </Pressable>
        </View>
      ) : main ? (
        // The loading hold, the new-session welcome and the empty state are the cards area's.
        <EmptyTranscript chat={chat} document={document} />
      ) : null;
  } else {
    body = (
      <FlatList
        ref={listRef}
        inverted
        data={data}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        extraData={renderItem}
        onScroll={onScroll}
        onScrollBeginDrag={startUserScroll}
        onScrollEndDrag={endUserScroll}
        onMomentumScrollBegin={startUserScroll}
        onMomentumScrollEnd={endUserScroll}
        scrollEventThrottle={32}
        onEndReached={loadEarlier}
        onEndReachedThreshold={0.6}
        onScrollToIndexFailed={onScrollToIndexFailed}
        maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: SCROLL_BOTTOM.edgeThreshold }}
        keyboardDismissMode='interactive'
        keyboardShouldPersistTaps='handled'
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={11}
        ListFooterComponent={
          loadingEarlier ? (
            <View style={styles.pageSpinner}>
              <ActivityIndicator size='small' color={theme.muted} />
            </View>
          ) : null
        }
        style={styles.list}
      />
    );
  }

  return (
    <TranscriptScope chat={chat} main={main}>
      <View style={[styles.root, { backgroundColor: theme.background }]} accessibilityLabel='Conversation'>
        {body}
        {awayFromBottom && rows.length > 0 ? (
          <View style={styles.pillRow} pointerEvents='box-none'>
            <Pressable
              onPress={jumpToBottom}
              accessibilityRole='button'
              accessibilityLabel={SCROLL_BOTTOM.label}
              style={[
                styles.pill,
                {
                  backgroundColor: theme.light ? '#fefefe' : '#151515',
                  borderColor: theme.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
                },
              ]}
            >
              <Text style={[styles.pillText, { color: theme.primary }]}>{SCROLL_BOTTOM.label}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </TranscriptScope>
  );
}

const TranscriptRowFrame = memo(function TranscriptRowFrame({
  item,
  first,
  last,
  tint,
  widthPercent,
}: {
  item: TranscriptItem;
  first: boolean;
  last: boolean;
  tint: string | null;
  /** The custom transcript width, as a share of the pane; null keeps the 768pt column. */
  widthPercent: number | null;
}) {
  return (
    <View style={[styles.rowOuter, first && styles.rowFirst, last && styles.rowLast]}>
      <View
        style={[
          styles.rowInner,
          widthPercent !== null && { width: `${widthPercent}%`, maxWidth: '100%' },
          tint !== null && { backgroundColor: tint, borderRadius: 8 },
        ]}
      >
        <TranscriptItemView item={item} />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  rowOuter: { width: '100%', alignItems: 'center' },
  rowFirst: { paddingTop: TOP_PADDING },
  rowLast: { paddingBottom: END_PADDING },
  rowInner: { width: '100%', maxWidth: ROW_MAX_WIDTH, paddingHorizontal: 16, paddingBottom: 16 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  subagentRow: { paddingHorizontal: 4, paddingBottom: 16 },
  button: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  buttonText: { fontSize: 14 },
  pageSpinner: { paddingVertical: 12, alignItems: 'center' },
  pillRow: { position: 'absolute', left: 0, right: 0, bottom: SCROLL_BOTTOM.bottom, alignItems: 'center' },
  pill: {
    height: SCROLL_BOTTOM.height,
    paddingHorizontal: SCROLL_BOTTOM.paddingX,
    borderRadius: SCROLL_BOTTOM.height / 2,
    borderWidth: 1,
    justifyContent: 'center',
  },
  pillText: { fontSize: SCROLL_BOTTOM.fontSize, fontWeight: '500' },
});
