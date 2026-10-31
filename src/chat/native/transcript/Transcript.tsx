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
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewInstance,
} from 'react-native';

import { NO_BAR_INSETS } from '../../../components/common/verticalBar/layout';
import { useScrollToBarEdges } from '../../../components/common/verticalBar/VerticalBarArea';
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
  useNativeChatUi,
  useTranscriptEnv,
  type TranscriptEnv,
} from './context';
import { arr, num, obj, str } from './json';
import { useTranscriptTheme } from './theme';
import { TranscriptItemView } from './TranscriptItemRow';
import { QuestionFormsProvider } from './QuestionForm';
import { RowFindContext, type RowFind } from './searchHighlight';
import {
  QUESTION_PILL,
  QuestionAnchorsProvider,
  QuestionFlashProvider,
  questionAnchorKey,
  type QuestionAnchors,
  type QuestionFlash,
} from './OpenQuestions';
import { useTranscriptBottomStore } from './bottomStore';
import { TranscriptFieldRevealContext, useTranscriptFieldReveal } from './fieldReveal';
import { ROW_GAP } from './cardSpacing';

/**
 * `scroll-bottom.json`: the pill's look and how far from the bottom it appears.
 *
 * CDXC:Mobile 2026-09-12 DECISION:
 * User: do not show the Ctrl+Shift+Down shortcut on the mobile Scroll to bottom button.
 */
const SCROLL_BOTTOM = {
  label: 'Scroll to bottom',
  edgeThreshold: 10,
  height: 24,
  fontSize: 11,
  paddingX: 10,
  bottom: 4,
  errorTone: {
    dark: { background: '#1c1617', border: 'rgba(248,113,113,0.18)', text: '#e8a5a5' },
    light: { background: '#fdf8f8', border: 'rgba(220,38,38,0.15)', text: '#b43a3a' },
  },
};
/**
 * At or under this many points from the end the reader is at the bottom and a collapsed composer
 * opens again (`COMPOSER_BOTTOM_THRESHOLD_PX` in the core, `composer_scroll.rs`).
 */
const COMPOSER_BOTTOM_THRESHOLD = 10;
/**
 * Space above the first row. The last row ends with the gap every row has, so nothing stands
 * between it and the working card but that gap (the 2026-10-18 DECISION in
 * packages/gx-chat-core/src/extras/working_card.rs; desktop `transcript.rs`).
 */
const TOP_PADDING = 32;
const ROW_MAX_WIDTH = 768;

const EMPTY_DETAILS = {};
const EMPTY_IMAGES = {};
const EMPTY_FORMS = {};

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
  const simpleSetting = useSettingsStore((store) => store.settings.sessionChatSimpleMode);
  const filePreviews = useSettingsStore((store) => store.settings.sessionChatFileEditPreviews);
  const mutedThinking = useSettingsStore((store) => store.settings.sessionChatMutedThinking);
  const state = chat.state;
  const document = state?.document ?? null;
  // A subagent's transcript uses the normal display, whatever the main chat's mode (desktop DECISION).
  const verbose = main ? (document?.verboseOverride ?? verboseSetting) : false;
  const simple = main && simpleSetting;
  const workOpen = main && (verbose || !simple);
  const env = useMemo<TranscriptEnv>(
    () => ({
      dispatch: chat.dispatch,
      theme,
      verbose,
      simple,
      workOpen,
      filePreviews: main && filePreviews,
      mutedThinking,
      main,
    }),
    [chat.dispatch, filePreviews, main, mutedThinking, simple, theme, verbose, workOpen],
  );
  // The document is parsed afresh per frame, so the flags are keyed by their content.
  const flagsSignature =
    document === null
      ? ''
      : JSON.stringify([
          document.finalIds,
          document.answeredPages,
          document.withdrawnPages,
          document.laterQuestions,
          document.openQuestions?.sections,
          document.savedPrompts,
          document.rewindAvailable,
          document.rewindEnabled,
          obj(document.composerActions)?.stash,
          obj(document.queue)?.capabilities,
          document.queueTakeBackIds,
          document.queueTakeBackBusy,
          document.deferredWork,
          document.markedHeadingStrength,
          document.chatTextStrength,
          document.readAloud?.available,
          document.readAloud?.speakingId,
        ]);
  const flags = useMemo(() => transcriptFlags(document), [flagsSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only the forms read this, and it changes with every pick, so it rides apart from the flags.
  const formsSignature = JSON.stringify(document?.questionForms ?? null);
  const forms = useMemo(() => document?.questionForms ?? EMPTY_FORMS, [formsSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <TranscriptEnvProvider value={env}>
      <TranscriptFlagsProvider value={flags}>
        <RowDetailsProvider value={state?.rowDetails ?? EMPTY_DETAILS}>
          <ChatImagesProvider value={state?.images ?? EMPTY_IMAGES}>
            <QuestionFormsProvider value={forms}>{children}</QuestionFormsProvider>
          </ChatImagesProvider>
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
    [chat],
  );
}

/** How often, and how many times, a question jump looks for its drawn question before giving up. */
const QUESTION_SETTLE_MS = 80;
const QUESTION_SETTLE_TRIES = 15;

export function NativeTranscript({ chat, items, main = true }: NativeTranscriptProps) {
  const theme = useTranscriptTheme();
  const state = chat.state;
  const document = state?.document ?? null;
  const rows = items ?? state?.items ?? [];
  const { dispatch } = chat;

  const listRef = useRef<FlatList<Row>>(null);
  // The chat view's list reaches under the iPhone Duo's side bar, its rows keep clear of it;
  // a transcript inside a card (a subagent's) keeps to the card.
  const listEdges = useScrollToBarEdges(undefined, main ? null : NO_BAR_INSETS);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const data = useMemo(() => {
    const reversed: Row[] = [];
    for (let index = rows.length - 1; index >= 0; index -= 1) reversed.push({ item: rows[index]!, index });
    return reversed;
  }, [rows]);

  // Transcript search: highlight the words that matched in the rows that hold them, and bring the
  // selected one into view once per explicit navigation (`search.rs`).
  const search = main ? obj(document?.transcriptSearch) : null;
  const searchKey = JSON.stringify(search?.items ?? null);
  const searchItems = useMemo(
    () => new Set(arr(search?.items).filter((value): value is number => typeof value === 'number')),
    [searchKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const activeItem = num(search, 'activeItem');
  const activeInRow = num(search, 'activeInRow');
  const activeLabelKey = str(obj(search?.activeLabel), 'key');
  const activeLabelOccurrence = num(obj(search?.activeLabel), 'occurrence');
  const searchNeedle = str(search, 'query').trim().toLowerCase();
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

  // Files and links: a row's jump scrolls to the message (or the turn holding it) once per click
  // (`composer/files_links.rs`); the core bumps `revision` each time.
  const filesJump = main ? (document?.filesLinks?.jump ?? null) : null;
  const filesJumpItem = filesJump?.item ?? null;
  const filesJumpRevision = filesJump?.revision ?? null;
  const filesJumped = useRef<number | null>(null);
  useEffect(() => {
    if (filesJumpRevision === null || filesJumpItem === null) {
      filesJumped.current = null;
      return;
    }
    if (filesJumpRevision === filesJumped.current) return;
    filesJumped.current = filesJumpRevision;
    const position = rows.length - 1 - filesJumpItem;
    if (position >= 0 && position < rows.length) {
      listRef.current?.scrollToIndex({ index: position, viewPosition: 0.5, animated: true });
    }
  }, [filesJumpItem, filesJumpRevision, rows.length]);

  // The Previous question pill and Q-tag links: scroll to the reply holding the question once per
  // jump with its end at the bottom of the screen, then, when that leaves the question's top above
  // the screen, bring the question's top a margin below the top (the rule on gx-chat-core's
  // `OpenQuestionJump`; desktop's `settle_question_row` lands the same way), and outline it for a
  // moment. A Q-tag jump lands on the form question it names. A jump made before this list existed
  // is not replayed.
  const openQuestions = main ? (document?.openQuestions ?? null) : null;
  const questionJump = openQuestions?.jump ?? null;
  const questionJumpRevision = questionJump?.revision ?? 0;
  const questionJumped = useRef<number | null>(null);
  const [questionFlash, setQuestionFlash] = useState<QuestionFlash | null>(null);
  const questionAnchors = useMemo<QuestionAnchors>(() => new Map(), []);
  const rootRef = useRef<ViewInstance>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A question jump's row that was too far to scroll to at once lands the same way on its retry.
  const questionRetry = useRef(false);
  useEffect(
    () => () => {
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (questionJumped.current === null) {
      questionJumped.current = questionJumpRevision;
      return;
    }
    if (questionJump === null || questionJumpRevision === questionJumped.current) return;
    questionJumped.current = questionJumpRevision;
    const position = rows.length - 1 - questionJump.item;
    const question = questionJump.question ?? null;
    if (position >= 0 && position < rows.length) {
      // Not animated, so the row's place can be measured as soon as it is drawn; rows above it
      // that were never measured do not matter, since the question is measured where it landed.
      questionRetry.current = true;
      listRef.current?.scrollToIndex({ index: position, viewPosition: 0, animated: false });
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      const target = questionJump.target;
      let tries = 0;
      const settle = () => {
        settleTimer.current = null;
        questionRetry.current = false;
        tries += 1;
        const anchor =
          (question !== null ? questionAnchors.get(questionAnchorKey(target, question)) : undefined) ??
          questionAnchors.get(target);
        const root = rootRef.current;
        if (anchor === undefined || root === null) {
          if (tries < QUESTION_SETTLE_TRIES) settleTimer.current = setTimeout(settle, QUESTION_SETTLE_MS);
          return;
        }
        root.measureInWindow((_x, listTop, _width, listHeight) => {
          anchor.measureInWindow((_ax, anchorTop) => {
            const goal = listTop + QUESTION_PILL.jumpMargin;
            if (anchorTop > listTop + listHeight && tries < QUESTION_SETTLE_TRIES) {
              // The list has not landed on the row yet.
              settleTimer.current = setTimeout(settle, QUESTION_SETTLE_MS);
              return;
            }
            if (anchorTop >= goal - 1) return;
            // Inverted: a larger offset moves the rows down the screen.
            listRef.current?.scrollToOffset({ offset: listOffset.current + (goal - anchorTop), animated: false });
          });
        });
      };
      settleTimer.current = setTimeout(settle, QUESTION_SETTLE_MS);
    }
    setQuestionFlash({ target: questionJump.target, question, key: questionJumpRevision });
    const timer = setTimeout(() => setQuestionFlash(null), QUESTION_PILL.flashMs);
    return () => clearTimeout(timer);
  }, [questionAnchors, questionJump, questionJumpRevision, rows.length]);

  const interruptToast = main ? (document?.interruptToast ?? null) : null;
  const errorTone = theme.light ? SCROLL_BOTTOM.errorTone.light : SCROLL_BOTTOM.errorTone.dark;
  const hasMore = main && document?.hasMore === true;
  const loadingEarlier = document?.loadingEarlier === true;
  const loadEarlier = useCallback(() => {
    if (hasMore && !loadingEarlier) dispatch({ type: 'loadEarlier' });
  }, [dispatch, hasMore, loadingEarlier]);

  // CDXC:SessionChat 2026-10-17 DECISION:
  // User: "Please disable the composer becoming smaller/bigger on scrolling when I'm on the phone app for now. it's not working that well on phone." Scrolling the transcript on the phone never sends `composerScroll`, so the chat box keeps its full size; `useComposerMotion` stays for when it comes back. Desktop and the web build still collapse on scroll.
  const collapsed = main && document?.composerCollapsed === true;
  const listOffset = useRef(0);
  const revealFocusedField = useTranscriptFieldReveal(listRef, listOffset);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset } = event.nativeEvent;
      // Inverted: the offset is the distance from the bottom.
      const offset = contentOffset.y;
      setAwayFromBottom(offset > SCROLL_BOTTOM.edgeThreshold);
      listOffset.current = offset;
      if (!main) return;
      // Following the newest turn again opens a collapsed box (desktop's scroll handler).
      if (collapsed && offset <= COMPOSER_BOTTOM_THRESHOLD) dispatch({ type: 'composerExpand' });
    },
    [collapsed, dispatch, main],
  );

  const jumpToBottom = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    dispatch({ type: 'composerExpand' });
  }, [dispatch]);

  // The scroll-to-bottom pill lives on the working card (`cards/WorkingCard.tsx`), outside this list.
  const showJump = main && awayFromBottom && rows.length > 0;
  useEffect(() => {
    if (!main) return;
    useTranscriptBottomStore.setState({ awayFromBottom: showJump, jumpToBottom });
  }, [jumpToBottom, main, showJump]);
  useEffect(() => {
    if (!main) return;
    return () => useTranscriptBottomStore.setState({ awayFromBottom: false, jumpToBottom: null });
  }, [main]);

  // Settings > Chat's custom transcript width (desktop's `transcript_width`): the rows take that
  // share of the pane instead of the composer's 768pt column.
  const customWidth = useSettingsStore((store) => store.settings.sessionChatCustomTranscriptWidthEnabled);
  const widthPercent = useSettingsStore((store) => store.settings.sessionChatTranscriptWidthPercent);
  const rowWidth = main && customWidth ? widthPercent : null;

  const renderItem = useCallback(
    ({ item: row }: ListRenderItemInfo<Row>) => (
      <TranscriptRowFrame
        item={row.item}
        first={row.index === 0}
        findNeedle={searchItems.has(row.index) ? searchNeedle : ''}
        findActive={activeItem === row.index ? activeInRow : null}
        findActiveLabel={activeItem === row.index && activeLabelKey.length > 0 ? activeLabelKey : null}
        findActiveLabelOccurrence={activeLabelOccurrence ?? 0}
        widthPercent={rowWidth}
      />
    ),
    [activeInRow, activeItem, activeLabelKey, activeLabelOccurrence, rowWidth, searchItems, searchNeedle],
  );

  const keyExtractor = useCallback((row: Row) => transcriptItemKey(row.item), []);

  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    const question = questionRetry.current;
    questionRetry.current = false;
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(
      () =>
        listRef.current?.scrollToIndex(
          question
            ? { index: info.index, viewPosition: 0, animated: false }
            : { index: info.index, viewPosition: 0.5, animated: true },
        ),
      120,
    );
  }, []);

  let body: ReactNode;
  if (rows.length === 0) {
    const empty =
      main && hasMore ? (
        // React's one manual case: a transcript with no rows yet.
        <View style={styles.empty}>
          <Pressable
            onPress={loadEarlier}
            style={({ pressed }) => [
              styles.button,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonText, { color: theme.primary }]}>
              {loadingEarlier ? 'Loading earlier turns…' : 'Load earlier turns'}
            </Text>
          </Pressable>
        </View>
      ) : main ? (
        // The loading hold, the new-session welcome and the empty state are the cards area's.
        <EmptyTranscript chat={chat} document={document} />
      ) : null;
    /*
     * CDXC:SessionChat 2026-10-26 WHY:
     * In chat view, tapping the free area or swiping down closes the keyboard. With rows the
     * list already does both (a tap no control handles, `keyboardShouldPersistTaps="handled"`; the interactive drag);
     * the empty state gets them from a scroll view that only exists for that, where any drag closes the keyboard
     * (`on-drag`: there is nothing to drag along).
     */
    body =
      empty === null ? null : (
        <ScrollView
          style={[styles.list, listEdges.scroll]}
          contentContainerStyle={[styles.emptyScroll, listEdges.content]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          alwaysBounceVertical
        >
          {empty}
        </ScrollView>
      );
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
        scrollEventThrottle={32}
        onEndReached={loadEarlier}
        onEndReachedThreshold={0.6}
        onScrollToIndexFailed={onScrollToIndexFailed}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: SCROLL_BOTTOM.edgeThreshold,
        }}
        keyboardDismissMode="interactive"
        // Android's scroll-into-view for a focused field is mirrored in an inverted list; the
        // question form's fields reveal themselves instead (`fieldReveal.ts`).
        scrollsChildToFocus={false}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={11}
        ListFooterComponent={
          loadingEarlier ? (
            <View style={styles.pageSpinner}>
              <ActivityIndicator size="small" color={theme.muted} />
            </View>
          ) : undefined
        }
        style={[styles.list, listEdges.scroll]}
        contentContainerStyle={listEdges.content}
      />
    );
  }

  return (
    <TranscriptScope chat={chat} main={main}>
      {main && searchOpen ? <SearchFoldsReport dispatch={dispatch} /> : null}
      <QuestionFlashProvider value={questionFlash}>
        <QuestionAnchorsProvider value={questionAnchors}>
          <TranscriptFieldRevealContext.Provider value={revealFocusedField}>
            <View
              ref={rootRef}
              style={[styles.root, { backgroundColor: theme.background }]}
              accessibilityLabel="Conversation"
            >
              {body}
              {interruptToast ? (
                /*
                 * CDXC:SessionChat 2026-10-15 DECISION:
                 * User (2026-10-01): the interrupt toasts take the Scroll to bottom pill's spot and look; "Agent was interrupted" is red. Visual only, so it takes no touches. User (2026-10-15): the Previous question and Scroll to bottom pills stop floating and become icon pills at the left of the working row's pills (`ChatPills.tsx`), so the toasts keep this floating spot on their own; since 2026-10-17 those pills ride on the working card (`cards/WorkingCard.tsx`), which since 2026-10-18 sits in its own row below the transcript, so this spot stays just above it.
                 */
                <View style={styles.pillRow} pointerEvents="none">
                  <View
                    accessibilityRole="text"
                    accessibilityLiveRegion="polite"
                    style={[
                      styles.pill,
                      interruptToast.tone === 'error'
                        ? {
                            backgroundColor: errorTone.background,
                            borderColor: errorTone.border,
                          }
                        : {
                            backgroundColor: theme.light ? '#fefefe' : '#151515',
                            borderColor: theme.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)',
                          },
                    ]}
                  >
                    <Text
                      style={[
                        styles.pillText,
                        { color: interruptToast.tone === 'error' ? errorTone.text : theme.primary },
                      ]}
                    >
                      {interruptToast.text}
                    </Text>
                  </View>
                </View>
              ) : null}
            </View>
          </TranscriptFieldRevealContext.Provider>
        </QuestionAnchorsProvider>
      </QuestionFlashProvider>
    </TranscriptScope>
  );
}

/**
 * Reports the open and closed folds to the core while the find bar is open, so it searches only
 * what the reader can see (core `transcript_search.rs`; desktop `sync_search_folds` in `search.rs`).
 */
function SearchFoldsReport({ dispatch }: { dispatch: RustChat['dispatch'] }) {
  const { disclosures } = useNativeChatUi();
  const { simple, workOpen } = useTranscriptEnv();
  useEffect(() => {
    let sent = '';
    const report = () => {
      const folds = { ...disclosures.folds(), simple, workOpen };
      const signature = JSON.stringify(folds);
      if (signature === sent) return;
      sent = signature;
      dispatch({ type: 'searchFolds', ...folds });
    };
    report();
    return disclosures.subscribeAll(report);
  }, [disclosures, dispatch, simple, workOpen]);
  return null;
}

const TranscriptRowFrame = memo(function TranscriptRowFrame({
  item,
  first,
  findNeedle,
  findActive,
  findActiveLabel,
  findActiveLabelOccurrence,
  widthPercent,
}: {
  item: TranscriptItem;
  first: boolean;
  /** Transcript search's query, lowercase, when this row holds a match; empty otherwise. */
  findNeedle: string;
  /** Which occurrence of this row's Markdown is the selected one (`activeInRow`), when it is here. */
  findActive: number | null;
  /** The label (by key) the selected occurrence is in, when it is in one of this row's labels (`activeLabel`). */
  findActiveLabel: string | null;
  findActiveLabelOccurrence: number;
  /** The custom transcript width, as a share of the pane; null keeps the 768pt column. */
  widthPercent: number | null;
}) {
  const theme = useTranscriptTheme();
  // A fresh counter each time the row renders: its text numbers the occurrences in reading order
  // (`searchHighlight.tsx`).
  const find: RowFind | null =
    findNeedle.length === 0
      ? null
      : {
          needle: findNeedle,
          background: theme.searchMatch,
          activeBackground: theme.searchMatchActive,
          active: findActive,
          activeLabel:
            findActiveLabel === null ? null : { key: findActiveLabel, occurrence: findActiveLabelOccurrence },
          counter: { next: 0 },
        };
  return (
    <View style={[styles.rowOuter, first && styles.rowFirst]}>
      <View style={[styles.rowInner, widthPercent !== null && { width: `${widthPercent}%`, maxWidth: '100%' }]}>
        <RowFindContext.Provider value={find}>
          <TranscriptItemView item={item} />
        </RowFindContext.Provider>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  rowOuter: { width: '100%', alignItems: 'center' },
  rowFirst: { paddingTop: TOP_PADDING },
  rowInner: { width: '100%', maxWidth: ROW_MAX_WIDTH, paddingHorizontal: 16, paddingBottom: ROW_GAP },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  emptyScroll: { flexGrow: 1 },
  subagentRow: { paddingHorizontal: 4, paddingBottom: 16 },
  button: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
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
