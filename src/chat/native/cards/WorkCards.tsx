/**
 * A coordinator's work item cards under its replies (`workCards` in the chat core's document,
 * `packages/gx-chat-core/src/extras/work_cards.rs`, which holds the user's decision): a card per item
 * the turn changed, with its status, where it stands, who has the ball and how long ago, and a card
 * per ask with its answer buttons; an item's earlier cards and settled asks fold to one quiet line.
 * Port of desktop `native_chat/work_cards.rs`.
 *
 * A tap on an answer sends `coordinatorBoardAnswer`, which the core records with gxserver once and
 * then tells the coordinator ("W3 Q2: Now"). Every button is a neutral fill, never the dark primary
 * one: the card sits on the chat's glass (the user's standing rule, no black fills on glass).
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { ToneButton } from './ToneCard';
import { askColor, tint } from './askCard';
import { AgentMark } from './agentMark';
import { toneColor } from './CoordinatorBoard';
import { QuestionFlashFrame } from '../transcript/OpenQuestions';
import { PROSE_LINE, PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import {
  TranscriptEnvProvider,
  TranscriptFlagsProvider,
  transcriptFlags,
  useTranscriptFlags,
  type TranscriptEnv,
} from '../transcript/context';
import { strengthenedText } from '../transcript/textStrength';
import { LinkWords } from '../transcript/LinkWords';
import { Markdown } from '../transcript/markdown/Markdown';
import { Sheet } from '../composer/Sheet';
import { WorkAnswerLine, WorkMenuButton, WorkMenuList, workMenuRows } from './workItemParts';
import { loadReplyDrafts, pruneReplyDrafts, registerReplyDraftScope, type ReplyDraftScope } from './replyDrafts';

type Dispatch = RustChat['dispatch'];

/**
 * A title's colour: the chat's body text at the user's Text strength, as a reply's prose is drawn.
 *
 * CDXC:Coordinators 2026-11-10 DECISION: User, on the opened Moving list: "the font size must match
 * the font size of the chat here please and same text strength should apply". Titles are the chat's
 * body text, second lines, folds and the Moving row's names its muted text at the same size; chips
 * and the status and age labels stay small (desktop `native_chat/work_cards.rs`).
 */
function useBodyColor(): string {
  const P = useTranscriptTheme();
  const { chatTextStrength } = useTranscriptFlags();
  return strengthenedText(P.prose, chatTextStrength, P.light);
}

/** Each status's colour, the board's (`CoordinatorBoard.tsx` `GROUP_COLOR`, desktop `group_look`). */
const STATUS_COLOR: Record<string, string> = {
  needs: SidebarPalette.ROW_QUESTION,
  blocked: SidebarPalette.ROW_APPROVAL,
  waiting: '#7fa1c4',
  moving: '#c68a06',
  finished: '#2fa865',
};

const CHIP_ICON: Record<string, GlyphName> = {
  thread: 'robot',
  steps: 'checklist',
  item: 'stack',
  question: 'help-circle',
  link: 'link',
  file: 'note',
  wait: 'clock',
  github: 'brand-github',
};

/** The cards in the document, by the reply each sits under and by summary-mode turn. */
export type WorkCardIndex = {
  byAnchor: { [messageId: string]: JsonRecord[] };
  byTurn: { [turnId: string]: JsonRecord[] };
};

export function workCardIndex(document: ChatDocument | null): WorkCardIndex {
  const index: WorkCardIndex = { byAnchor: {}, byTurn: {} };
  for (const card of arr(document?.workCards)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && str(card, 'key').length > 0)) {
    const anchor = str(card, 'anchorId');
    const turn = str(card, 'turnId');
    if (anchor.length > 0) (index.byAnchor[anchor] ??= []).push(card);
    if (turn.length > 0) (index.byTurn[turn] ??= []).push(card);
  }
  return index;
}

/** A status's marker: the board's ring with a dot, disc, pause, check or dashed ring. */
function StatusMarker({ status, size, dim }: { status: string; size: number; dim?: boolean }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const color = STATUS_COLOR[status] ?? P.cardMuted;
  const opacity = dim === true ? 0.8 : 1;
  if (status === 'finished') return <Glyph name="circle-check-filled" size={size} color={color} />;
  if (status === 'dropped') return <Glyph name="x" size={size} color={P.muted} />;
  const box = { width: size, height: size, opacity };
  if (status === 'waiting') {
    return (
      <View style={[styles.pause, box]}>
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
        <View style={[styles.pauseBar, { backgroundColor: color }]} />
      </View>
    );
  }
  if (status === 'blocked' || status === 'moving') {
    return <View style={[box, { borderRadius: size / 2, backgroundColor: color }]} />;
  }
  if (status === 'needs') {
    return (
      <View style={[box, styles.ring, { borderRadius: size / 2, borderColor: color }]}>
        <View style={[styles.ringDot, { backgroundColor: color }]} />
      </View>
    );
  }
  return <View style={[box, styles.ring, { borderRadius: size / 2, borderColor: color, borderStyle: 'dashed' }]} />;
}

/** The cards under one reply or summary-mode turn. */
export function WorkCardStack({ cards, dispatch }: { cards: JsonRecord[]; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  if (cards.length === 0) return null;
  return (
    <View style={styles.stack}>
      {cards.map((card) => (
        // The ? pill's jump lands on an ask's card and outlines it (`OpenQuestions.tsx`).
        <QuestionFlashFrame key={str(card, 'key')} target={str(card, 'key')} light={P.light}>
          {str(card, 'kind') === 'moving' ? (
            <WorkMovingRow card={card} dispatch={dispatch} />
          ) : isTrue(card, 'folded') ? (
            <WorkFoldLine card={card} dispatch={dispatch} />
          ) : (
            <WorkCard card={card} dispatch={dispatch} />
          )}
        </QuestionFlashFrame>
      ))}
    </View>
  );
}

/** The dock's rows stop growing here and scroll inside it (desktop `DOCK_MAX_HEIGHT`). */
const DOCK_MAX_HEIGHT = 420;
/** A row's lead (its mark and the gap after it) and the dock's insets, for the answers' room. */
const DOCK_LEAD = 23;
const DOCK_INSETS = 12 * 2 + 4 * 2 + 8 * 2 + 2;

/** The header bar's height with the surface's borders: what the cap leaves the rows is the rest. */
const DOCK_HEAD_HEIGHT = 36 + 3;
/** The least room the rows keep under the bar when the cap is tight: about one closed row. */
const DOCK_MIN_ROWS = 44;

/**
 * The most height the dock may take, from the space between what sits above the transcript and the
 * chat box: half of it with the keyboard down, 60% with it up (the transcript keeps the rest, at
 * least about a third of it once the working card is counted), and never more than
 * `DOCK_MAX_HEIGHT`. Past the cap the rows scroll inside the dock, as on the desktop. On a small
 * phone (about 640 points tall) that is about 225 with the keyboard down and 110 with it up; on a
 * large one or a foldable unfolded it reaches the 420 ceiling's neighbourhood (about 350) only with
 * the keyboard down.
 *
 * CDXC:Coordinators 2026-11-12 DECISION:
 * User, of an opened docked row that filled the screen above the keyboard and pushed the chat box
 * off it: "The composer should always be visible whenever I have my caret focused on it, so I can
 * type on the phone app."
 */
export function dockHeightCap(space: number, keyboardUp: boolean): number {
  return Math.min(DOCK_MAX_HEIGHT, Math.max(0, space) * (keyboardUp ? 0.6 : 0.5));
}

/** Which dock row is open, per chat, kept outside the component so a new document keeps it. */
const openRows = new WeakMap<object, string>();

/**
 * The dock directly on the chat box (gx-chat-core `work_cards::dock`, which holds the user's
 * decisions; desktop `render_work_dock`): one surface with a header bar, then compact rows, what
 * needs him first, then blocked work and what the newest turn finished. The header counts what
 * needs him, what is blocked and what is in progress, opens the Work sheet, and collapses the dock to
 * itself; a collapsed dock opens by itself when something new needs him (the core's `hidden`). At
 * most `phoneLimit` rows show, then "N more need you", which opens the rest in place. A tap opens a
 * row into its own card, one at a time. It sits outside the transcript, so it carries the
 * transcript's flags (Text strength) and an env for the description's Markdown.
 *
 * CDXC:Coordinators 2026-11-11 DECISION:
 * User, of the phone's dock: "make how the work items list shows up matches please!!" The phone takes
 * the desktop's header (marks and counts, the Work items button, the chevron) in place of its round
 * x, and the desktop's opened row. Unlike the desktop it shows no bar while nothing is docked: the
 * phone keeps its Work pill for that, and its screen has no room to spare.
 */
export function WorkDock({
  document,
  chat,
  projectId,
  sessionId,
  typing = false,
  maxHeight,
}: {
  document: ChatDocument | null;
  chat: RustChat;
  projectId?: string;
  sessionId?: string;
  /** The chat box has the caret with the keyboard up: the dock folds to its bar until a tap opens it. */
  typing?: boolean;
  /** The most height the whole dock may take (`dockHeightCap`); its rows scroll inside past it. */
  maxHeight?: number;
}) {
  const flags = useMemo(() => transcriptFlags(document), [document]);
  // While he types, the dock is folded here, not in the core: the keyboard going down gives back
  // the dock as it was (its opened row still opened). A tap on the bar opens it for this typing.
  const [peek, setPeek] = useState(false);
  useEffect(() => {
    if (!typing) setPeek(false);
  }, [typing]);
  const styles = useStyles();
  const P = useTranscriptTheme();
  const dispatch = chat.dispatch;
  const [openKey, setOpenKey] = useState<string | null>(() => openRows.get(dispatch) ?? null);
  const [all, setAll] = useState(false);
  const env = useMemo<TranscriptEnv>(
    () => ({
      dispatch,
      theme: P,
      simple: false,
      workOpen: false,
      filePreviews: false,
      mutedThinking: false,
      main: false,
    }),
    [dispatch, P],
  );
  const machine = chat.machine;
  const scope = useMemo<ReplyDraftScope | null>(
    () =>
      machine !== null && (projectId ?? '').length > 0 && (sessionId ?? '').length > 0
        ? { machine, projectId: projectId ?? '', sessionId: sessionId ?? '' }
        : null,
    // The machine object changes identity on every store update; only the chat's identity matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [machine?.id, projectId, sessionId],
  );
  // The chat's Reply drafts: read once, and the Work sheet's Reply finds this chat's scope.
  useEffect(() => {
    if (scope === null) return;
    registerReplyDraftScope(dispatch, scope);
    loadReplyDrafts(scope);
  }, [dispatch, scope]);
  const dockValue = document?.workDock;
  const boardValue = document?.coordinatorBoard;
  useEffect(() => {
    if (scope !== null && (dockValue != null || boardValue != null)) pruneReplyDrafts(scope, dockValue, boardValue);
  }, [scope, dockValue, boardValue]);
  const dock = obj(dockValue);
  const rows = arr(dock?.rows)
    .map(obj)
    .filter((row): row is JsonRecord => row !== null);
  if (dock === null || rows.length === 0) return null;
  const hiddenInCore = isTrue(dock, 'hidden');
  const collapsed = hiddenInCore || (typing && !peek);
  const limit = typeof dock.phoneLimit === 'number' ? dock.phoneLimit : 3;
  const hidden = Math.max(0, rows.length - limit);
  const shown = all && hidden > 0 ? rows : rows.slice(0, limit);
  const toggle = (key: string) =>
    setOpenKey((was) => {
      // One row open at a time: opening this one shuts the one that was open.
      const next = was === key ? null : key;
      if (next === null) openRows.delete(dispatch);
      else openRows.set(dispatch, next);
      return next;
    });
  return (
    <TranscriptFlagsProvider value={flags}>
      <TranscriptEnvProvider value={env}>
        <View style={styles.dockSurface}>
          <DockHeader
            rows={rows}
            board={obj(boardValue)}
            open={!collapsed}
            dispatch={dispatch}
            onToggle={() => {
              if (!collapsed) {
                dispatch({ type: 'hideWorkDock' } as never);
                return;
              }
              // Folded for typing: open it for this typing only; folded by him: open it for good.
              if (typing) setPeek(true);
              if (hiddenInCore) dispatch({ type: 'showWorkDock' } as never);
            }}
          />
          {collapsed ? null : (
            <ScrollView
              style={{
                maxHeight:
                  maxHeight === undefined
                    ? DOCK_MAX_HEIGHT
                    : Math.max(DOCK_MIN_ROWS, Math.min(DOCK_MAX_HEIGHT, maxHeight - DOCK_HEAD_HEIGHT)),
              }}
              contentContainerStyle={styles.dockRows}
              nestedScrollEnabled
            >
              {shown.map((row) => (
                <QuestionFlashFrame key={str(row, 'key')} target={str(row, 'key')} light={P.light}>
                  <DockRow
                    row={row}
                    chat={chat}
                    scope={scope}
                    open={openKey === str(row, 'key')}
                    onToggle={() => toggle(str(row, 'key'))}
                  />
                </QuestionFlashFrame>
              ))}
              {hidden > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: all }}
                  hitSlop={8}
                  onPress={() => setAll((was) => !was)}
                >
                  <Text style={styles.dockMore}>
                    {all ? 'Show fewer' : hidden === 1 ? '1 more needs you' : `${hidden} more need you`}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          )}
        </View>
      </TranscriptEnvProvider>
    </TranscriptFlagsProvider>
  );
}

/** The header's counts and their marks, with their words (desktop `work_dock_header`). */
const HEADER_GROUPS: { id: string; status: string; one: string; many: string }[] = [
  { id: 'needs', status: 'needs', one: 'needs you', many: 'need you' },
  { id: 'blocked', status: 'blocked', one: 'blocked', many: 'blocked' },
  { id: 'moving', status: 'moving', one: 'in progress', many: 'in progress' },
];

/**
 * The dock's header: what needs him, what is blocked and what is in progress as marks and counts
 * (the Work panel's own numbers, `pillCounts`), named when they all fit; then the Work items button
 * that opens the Work sheet and the chevron that collapses the dock to this bar. A tap anywhere on
 * it collapses or opens the dock.
 */
function DockHeader({
  rows,
  board,
  open,
  dispatch,
  onToggle,
}: {
  rows: JsonRecord[];
  board: JsonRecord | null;
  open: boolean;
  dispatch: Dispatch;
  onToggle: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { width } = useWindowDimensions();
  const counts = HEADER_GROUPS.map((group) => {
    if (board !== null) {
      const pair = arr(board.pillCounts).find((entry) => Array.isArray(entry) && entry[0] === group.id);
      return { group, count: Array.isArray(pair) && typeof pair[1] === 'number' ? pair[1] : 0 };
    }
    const count =
      group.id === 'needs'
        ? rows.filter((row) => isTrue(row, 'needs')).length
        : group.id === 'blocked'
          ? rows.filter((row) => str(row, 'status') === 'blocked').length
          : 0;
    return { group, count };
  }).filter((entry) => entry.count > 0);
  // Every mark takes its name when the bar has room for all of them, and none does when it has not.
  const room = width - 24 - 12 - 5 - (board !== null ? 32 : 0) - 30 - 16;
  const named =
    counts.reduce(
      (sum, entry) =>
        sum +
        19 +
        String(entry.count).length * 8 +
        4 +
        (entry.count === 1 ? entry.group.one : entry.group.many).length * 7.4,
      0,
    ) +
      12 * Math.max(0, counts.length - 1) <=
    room;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={open ? 'Collapse' : 'Expand'}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.dockHead,
        open ? styles.dockHeadOpen : styles.dockHeadShut,
        pressed && { backgroundColor: P.ink(0.055) },
      ]}
    >
      <View style={styles.dockCounts}>
        {counts.map(({ group, count }) => (
          <View
            key={group.id}
            accessibilityLabel={`${count} ${count === 1 ? group.one : group.many}`}
            style={styles.dockCount}
          >
            <StatusMarker status={group.status} size={13} />
            <Text style={styles.dockCountNumber}>{count}</Text>
            {named ? <Text style={styles.dockCountName}>{count === 1 ? group.one : group.many}</Text> : null}
          </View>
        ))}
      </View>
      {board !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Work items"
          hitSlop={{ top: 10, bottom: 10, left: 6, right: 4 }}
          onPress={() => dispatch({ type: 'showCoordinatorBoardGroup', group: 'needs' } as never)}
          style={({ pressed }) => [styles.dockHeadButton, pressed && { backgroundColor: P.neutralFillPressed }]}
        >
          <Glyph name="layout-board-split" size={14} color={P.cardMuted} />
        </Pressable>
      ) : null}
      <View style={styles.dockHeadButton}>
        <Glyph name={open ? 'chevron-down' : 'chevron-up'} size={14} color={P.muted} />
      </View>
    </Pressable>
  );
}

/**
 * One dock row (desktop `dock_row`). Closed: its mark, its question (two lines at most), its age and
 * the ⋯ that opens its menu, then its answers and Reply on one line. Opened: its own card, a little
 * lighter than the dock, with the title whole, the work it belongs to, its whole description, where
 * it stands, its links, then its answers with Reply after a divider. A page's row never opens: a
 * tap opens the page.
 */
function DockRow({
  row,
  chat,
  scope,
  open,
  onToggle,
}: {
  row: JsonRecord;
  chat: RustChat;
  scope: ReplyDraftScope | null;
  open: boolean;
  onToggle: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const body = useBodyColor();
  const [menu, setMenu] = useState(false);
  const dispatch = chat.dispatch;
  const page = isTrue(row, 'page') && obj(row.open) !== null;
  const opened = open && !page;
  const busy = isTrue(row, 'busy');
  const answers = arr(row.buttons)
    .map(obj)
    .filter((button): button is JsonRecord => button !== null);
  const reply = obj(row.reply);
  const needs = isTrue(row, 'needs');
  const menuRows = workMenuRows(row, str(row, 'mention'), chat.state?.composer.text ?? '');
  const chips = arr(row.chips)
    .map(obj)
    .filter((chip): chip is JsonRecord => chip !== null);
  const description = str(row, 'body');
  const count = str(row, 'count');
  const markStatus = page && str(row, 'status') === 'needs' ? 'page' : str(row, 'status');
  const answerLine =
    answers.length > 0 || (needs && (reply !== null || obj(row.open) !== null)) ? (
      <View style={opened ? styles.dockAnswersOpen : styles.dockAnswers}>
        <WorkAnswerLine
          answers={answers}
          reply={reply}
          replied={str(row, 'replied')}
          open={answers.length === 0 ? obj(row.open) : null}
          busy={busy}
          divider={opened}
          room={-(DOCK_INSETS + DOCK_LEAD)}
          question={str(row, 'title')}
          scope={scope}
          dispatch={dispatch as never}
        />
      </View>
    ) : null;
  return (
    <View style={opened ? styles.dockRowOpen : null}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={page ? undefined : { expanded: opened }}
        onPress={page ? () => dispatch(row.open as never) : onToggle}
        style={({ pressed }) => [styles.dockPress, pressed && !opened && { backgroundColor: P.ink(0.04) }]}
      >
        <View style={styles.dockRow}>
          <View style={styles.dockIcon}>
            {markStatus === 'page' ? (
              <Glyph name="note" size={14} color={STATUS_COLOR.needs} />
            ) : (
              <StatusMarker status={markStatus} size={13} />
            )}
          </View>
          <View style={styles.dockMain}>
            {page && count.length > 0 ? (
              <View style={styles.pageTitle}>
                <Text numberOfLines={1} style={[styles.dockTitle, styles.pageName, { color: body }]}>
                  {str(row, 'title')}
                </Text>
                <Text style={styles.pageCount}>{count}</Text>
              </View>
            ) : opened ? (
              // Opened, its references (`#562`, a Markdown link) open on a tap, as a question's do.
              <LinkWords text={str(row, 'title')} runs={row.titleRuns} color={body} style={styles.dockTitle} />
            ) : (
              <Text numberOfLines={2} style={[styles.dockTitle, { color: body }]}>
                {str(row, 'title')}
              </Text>
            )}
          </View>
          <View style={styles.ageSlot}>
            <Text style={styles.foldTime}>{str(row, 'age')}</Text>
            {menuRows.length > 0 ? <WorkMenuButton active={menu} onPress={() => setMenu(true)} /> : null}
          </View>
        </View>
        {/* Opened, only the title line shares its width with the age and the ⋯; the work item line,
            the description and the lines under them run to the card's right edge, from the title's
            left edge (user, 2026-11-12: "It should take up the full width of this card when I expand"). */}
          {opened ? (
            <View style={styles.dockDetail}>
              {Array.isArray(row.waitedBy) ? (
                <ItemLine row={row} chips={chips} dispatch={dispatch} />
              ) : chips.length > 0 ? (
                <View style={styles.dockLinks}>
                  {chips.map((chip, index) => (
                    <ItemChip key={`link:${index}`} chip={chip} dispatch={dispatch} />
                  ))}
                </View>
              ) : null}
              {description.length > 0 ? (
                <Markdown text={description} color={P.cardMuted} breaks selectable={false} />
              ) : null}
              {arr(row.detail)
                .map((line) => (typeof line === 'string' ? line : ''))
                .filter((line) => line.length > 0)
                .map((line, index) => (
                  <Text key={`line:${index}`} style={styles.movingRowLine}>
                    {line}
                  </Text>
                ))}
            </View>
          ) : null}
      </Pressable>
      {answerLine}
      {menuRows.length > 0 ? (
        <Sheet visible={menu} onClose={() => setMenu(false)} title={str(row, 'title')}>
          <WorkMenuList
            rows={menuRows}
            onPick={(command) => {
              setMenu(false);
              dispatch(command as never);
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

/** A link of a line of work: its thread with its agent's logo, a PR or issue, a file, its steps. */
function ItemChip({ chip, dispatch }: { chip: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const command = obj(chip.command);
  const kind = str(chip, 'kind');
  const state = str(chip, 'state');
  return (
    <Pressable
      accessibilityRole={command !== null ? 'button' : undefined}
      disabled={command === null}
      hitSlop={6}
      onPress={() => (command !== null ? dispatch(command as never) : undefined)}
      style={styles.chip}
    >
      {kind === 'thread' && str(chip, 'agentIcon').length > 0 ? (
        <AgentMark icon={str(chip, 'agentIcon')} size={14} />
      ) : (
        <Glyph name={CHIP_ICON[kind] ?? 'link'} size={14} color={P.muted} />
      )}
      <Text style={[styles.chipText, command !== null ? styles.linkDots : null]}>{str(chip, 'label')}</Text>
      {state.length > 0 ? (
        <Text style={[styles.chipText, { color: toneColor(str(chip, 'tone')) ?? P.muted }]}>{state}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * An opened ask row's line (desktop `item_line`): its own work item's name, then "· <item> waits on
 * this" when one other item waits on its answer, or "· N others wait", which lists them; its other
 * parts (the steps) after. The desktop keeps it one line; on a phone it wraps between its parts.
 */
function ItemLine({ row, chips, dispatch }: { row: JsonRecord; chips: JsonRecord[]; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [listing, setListing] = useState(false);
  const waited = arr(row.waitedBy)
    .map(obj)
    .filter((other): other is JsonRecord => other !== null);
  // `dot`: the "·" that leads it, kept with it so a wrapped line never starts with a lone dot.
  const name = (
    label: string,
    command: JsonRecord | null,
    shrink: number,
    floor: number,
    keyName: string,
    lead = false,
  ) => (
    <Pressable
      key={keyName}
      accessibilityRole={command !== null ? 'button' : undefined}
      disabled={command === null}
      hitSlop={6}
      onPress={() => (command !== null ? dispatch(command as never) : undefined)}
      style={[styles.itemName, { flexShrink: shrink, minWidth: floor }]}
    >
      {lead ? <Text style={styles.itemDot}>{'\u00b7'}</Text> : null}
      <Glyph name="stack" size={14} color={P.muted} />
      <Text numberOfLines={1} style={[styles.itemNameText, command !== null ? styles.linkDots : null]}>
        {label}
      </Text>
    </Pressable>
  );
  const parts: ReactNode[] = [];
  for (const [index, chip] of chips.entries()) {
    if (str(chip, 'kind') === 'item') parts.push(name(str(chip, 'label'), obj(chip.command), 1, 60, `item:${index}`));
  }
  const first = waited[0];
  if (waited.length === 1 && first !== undefined) {
    parts.push(name(str(first, 'title'), obj(first.command), 8, 110, 'waits', parts.length > 0));
    parts.push(
      <Text key="waits-words" style={styles.itemWords}>
        waits on this
      </Text>,
    );
  } else if (waited.length > 1) {
    const lead = parts.length > 0;
    parts.push(
      <View key="others" style={styles.itemName}>
        {lead ? <Text style={styles.itemDot}>{'\u00b7'}</Text> : null}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: listing }}
          hitSlop={6}
          onPress={() => setListing((was) => !was)}
        >
          <Text style={[styles.itemWords, styles.linkDots]}>{waited.length} others wait</Text>
        </Pressable>
      </View>,
    );
  }
  const rest = chips.filter((chip) => str(chip, 'kind') !== 'item');
  return (
    <View style={styles.itemLineColumn}>
      {parts.length > 0 ? <View style={styles.itemLine}>{parts}</View> : null}
      {listing
        ? waited.map((other, index) => name(str(other, 'title'), obj(other.command), 1, 0, `other:${index}`))
        : null}
      {rest.length > 0 ? (
        <View style={styles.dockLinks}>
          {rest.map((chip, index) => (
            <ItemChip key={`rest:${index}`} chip={chip} dispatch={dispatch} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Snooze (1 hour, 6 hours or 24 hours, opened from a quiet "Snooze") and Cancel, on a docked ask,
 * form or page (gx-chat-core `snooze_choices`; desktop `snooze_cancel_row`). Null when neither.
 */
function SnoozeCancelRow({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const choices = arr(card.snooze)
    .map(obj)
    .filter((choice): choice is JsonRecord => choice !== null);
  const cancel = obj(card.cancel);
  if (choices.length === 0 && cancel === null) return null;
  return (
    <View style={styles.snoozeRow}>
      {choices.length > 0 ? (
        <Pressable accessibilityRole="button" hitSlop={6} onPress={() => setOpen((was) => !was)}>
          <Text style={styles.quiet}>{open ? 'Snooze for' : 'Snooze'}</Text>
        </Pressable>
      ) : null}
      {open
        ? choices.map((choice, index) => (
            <Pressable
              key={`snooze:${index}`}
              accessibilityRole="button"
              accessibilityLabel={`Snooze for ${str(choice, 'label')}`}
              onPress={() => {
                setOpen(false);
                dispatch(choice.command as never);
              }}
              style={styles.snoozeChoice}
            >
              <Text style={styles.chipText}>{str(choice, 'label')}</Text>
            </Pressable>
          ))
        : null}
      {cancel !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel it for good and tell the agent"
          hitSlop={6}
          onPress={() => dispatch(cancel as never)}
        >
          <Text style={styles.quiet}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** An unanswered form or page in the dock: its title, how many questions are open, and Open. */
function DockQuestionsCard({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const body = useBodyColor();
  return (
    <View style={styles.card}>
      <View style={styles.questionsCard}>
        <Glyph name="help-circle" size={14} color={SidebarPalette.ROW_QUESTION} />
        <View style={styles.movingText}>
          <Text style={[styles.title, { color: body, minWidth: 0 }]}>{str(card, 'title')}</Text>
          <Text style={styles.chipText}>{str(card, 'line')}</Text>
        </View>
        <ToneButton kind="secondary" label="Open" onPress={() => dispatch(card.command as never)} />
      </View>
      <SnoozeCancelRow card={card} dispatch={dispatch} />
    </View>
  );
}

function WorkCard({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const status = str(card, 'statusLabel');
  const right = [status, str(card, 'age')].filter((part) => part.length > 0).join(' · ');
  const line = str(card, 'line');
  const chips = arr(card.chips)
    .map(obj)
    .filter((chip): chip is JsonRecord => chip !== null);
  const buttons = arr(card.buttons)
    .map(obj)
    .filter((button): button is JsonRecord => button !== null);
  const busy = isTrue(card, 'busy');
  const body = useBodyColor();
  return (
    <View accessible={false} accessibilityLabel={`${str(card, 'title')}, ${status}`} style={styles.card}>
      <View style={styles.top}>
        <View style={styles.marker}>
          <StatusMarker status={str(card, 'status')} size={13} />
        </View>
        <Text style={[styles.title, { color: body }]}>{str(card, 'title')}</Text>
        {right.length > 0 ? <Text style={styles.right}>{right}</Text> : null}
        {/* A finished card in the dock goes away with its × (gx-chat-core `dock`). */}
        {obj(card.dismiss) !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={8}
            onPress={() => dispatch(card.dismiss as never)}
            style={styles.dismiss}
          >
            <Glyph name="x" size={12} color={P.muted} />
          </Pressable>
        ) : null}
      </View>
      {line.length > 0 ? <Text style={styles.line}>{line}</Text> : null}
      {chips.length > 0 || buttons.length > 0 ? (
        <View style={styles.meta}>
          {/* Each part a quiet link at the chat's size: the thread with its agent's logo, a GitHub PR
              or issue with its state in that state's colour, a file, the steps; parts wrap, never
              cut (Q2205 A, desktop `work_card_part`). */}
          {chips.map((chip, index) => {
            const command = obj(chip.command);
            const kind = str(chip, 'kind');
            const state = str(chip, 'state');
            const agent = str(chip, 'agentIcon');
            return (
              <Pressable
                key={`chip:${index}`}
                accessibilityRole={command !== null ? 'button' : undefined}
                accessibilityLabel={state.length > 0 ? `${str(chip, 'label')}, ${state}` : str(chip, 'label')}
                disabled={command === null}
                hitSlop={6}
                onPress={() => (command !== null ? dispatch(command as never) : undefined)}
                style={styles.chip}
              >
                {kind === 'thread' && agent.length > 0 ? (
                  <AgentMark icon={agent} size={14} />
                ) : (
                  <Glyph name={CHIP_ICON[kind] ?? 'clock'} size={14} color={P.muted} />
                )}
                {/* A part that opens something wears the faint dotted underline of a link in the chat
                    (`LinkWords.tsx`): the phone has no hover, so it shows at rest. */}
                <Text style={[styles.chipText, command !== null ? styles.linkDots : null]}>{str(chip, 'label')}</Text>
                {state.length > 0 ? (
                  <Text style={[styles.chipText, { color: toneColor(str(chip, 'tone')) ?? P.muted }]}>{state}</Text>
                ) : null}
              </Pressable>
            );
          })}
          {buttons.length > 0 ? (
            <View style={styles.buttons}>
              {buttons.map((button, index) => (
                <ToneButton
                  key={`answer:${index}`}
                  kind="secondary"
                  label={str(button, 'label')}
                  // The recommended answer carries the question forms' star (`askCard.tsx` `RecommendedMark`).
                  trailing={
                    isTrue(button, 'recommended') ? (
                      <Glyph name="star" size={10} color={tint(askColor(P.light), 0.75)} />
                    ) : undefined
                  }
                  accessibilityLabel={
                    isTrue(button, 'recommended') ? `${str(button, 'label')}, Recommended` : undefined
                  }
                  icon={isTrue(button, 'picked') ? 'check' : undefined}
                  disabled={busy}
                  onPress={() => dispatch(button.command as never)}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={styles.snoozeIndent}>
        <SnoozeCancelRow card={card} dispatch={dispatch} />
      </View>
    </View>
  );
}

/**
 * Everything still running, as one quiet row ("Moving · 7" and their names) that opens to a list; a
 * row of the list goes to that item's newest card (gx-chat-core `moving_row`, desktop
 * `work_moving_row`).
 */
/**
 * The In progress lists the reader opened, by card key, kept outside the component: the row moves
 * to the newest reply (a new parent), and an opened list stays open across live updates, the end
 * of a turn and a new reply until the reader folds it (the user's "this gets collapsed after the
 * turn ends and new text comes in, let's not do that").
 */
const openedLists = new Set<string>();

function WorkMovingRow({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const listKey = str(card, 'key');
  const [open, setOpenState] = useState(() => openedLists.has(listKey));
  const setOpen = (next: (was: boolean) => boolean) =>
    setOpenState((was) => {
      const value = next(was);
      if (value) openedLists.add(listKey);
      else openedLists.delete(listKey);
      return value;
    });
  const rows = arr(card.rows)
    .map(obj)
    .filter((row): row is JsonRecord => row !== null);
  const body = useBodyColor();
  return (
    <View style={styles.moving}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={str(card, 'title')}
        onPress={() => setOpen((was) => !was)}
        style={styles.movingHead}
      >
        <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={12} color={P.muted} />
        {/* The same 14 px as the list's who-has-it marks under it. */}
        <StatusMarker status="moving" size={14} />
        <Text style={[styles.movingTitle, { color: body }]}>{str(card, 'title')}</Text>
        {/* Closed, it says who has what ("1 with you · 1 on GitHub · 5 threads"), what is with the
            user in the question colour (gx-chat-core `who_has`, Q2207 B). */}
        <Text numberOfLines={1} style={styles.movingSummary}>
          {open
            ? ''
            : arr(card.summaryParts)
                .map(obj)
                .filter((part): part is JsonRecord => part !== null)
                .map((part, index) => (
                  <Text key={`part:${index}`}>
                    {index > 0 ? ' · ' : ''}
                    <Text style={{ color: toneColor(str(part, 'tone')) ?? P.cardMuted }}>{str(part, 'text')}</Text>
                  </Text>
                ))}
        </Text>
      </Pressable>
      {open ? (
        // Grouped by who has it under quiet labels, the full text wrapping, no hairlines (Q2207 B;
        // the phone always takes the rows, never the desktop's table).
        <View style={styles.movingList}>
          {rows.map((row, index) => {
            const command = obj(row.command);
            const line = str(row, 'line');
            const who = obj(row.who);
            const group = str(row, 'group');
            const first = index === 0 || str(rows[index - 1], 'group') !== group;
            const count = arr(card.groups)
              .map(obj)
              .find((entry) => entry !== null && str(entry, 'key') === group);
            return (
              <View key={`row:${index}`}>
                {first ? (
                  <Text style={styles.movingGroup}>
                    {str(row, 'groupLabel')} · {count ? String(count.count ?? '') : ''}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${str(row, 'title')}, ${who ? str(who, 'label') : ''}`}
                  disabled={command === null}
                  onPress={() => (command !== null ? dispatch(command as never) : undefined)}
                  style={styles.movingRow}
                >
                  <View style={styles.movingText}>
                    <Text style={[styles.movingRowTitle, { color: body }, command !== null ? styles.linkDots : null]}>
                      {str(row, 'title')}
                    </Text>
                    {/* Who has it, as a quiet line under the title (the user's "just put it under Item's title"). */}
                    <View style={styles.whoLine}>
                      <WhoMark who={who} />
                      <Text numberOfLines={1} style={styles.whoText}>
                        {who ? str(who, 'label') : ''}
                      </Text>
                    </View>
                    {line.length > 0 ? <Text style={styles.movingRowLine}>{line}</Text> : null}
                  </View>
                  <Text style={styles.foldTime}>{str(row, 'age')}</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Who has a line of work: the thread's agent logo, GitHub's mark, the user, the coordinator's hat. */
function WhoMark({ who }: { who: JsonRecord | null }) {
  const P = useTranscriptTheme();
  const kind = who ? str(who, 'kind') : '';
  const agent = who ? str(who, 'agentIcon') : '';
  if (kind === 'thread') return <AgentMark icon={agent || null} size={14} />;
  if (kind === 'github') return <Glyph name="brand-github" size={14} color={P.muted} />;
  if (kind === 'you') return <Glyph name="user" size={14} color={SidebarPalette.ROW_QUESTION} />;
  if (kind === 'coordinator') return <Glyph name="coordinator-captain-hat" size={14} color={P.muted} />;
  return <Glyph name="clock" size={14} color={P.muted} />;
}

/** An item's earlier card, or a settled ask: one quiet line, what that turn did, and when. */
function WorkFoldLine({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const status = str(card, 'foldStatus') || str(card, 'status');
  const command = obj(card.command);
  // A turn's line opens the Work sheet at the first line of work it names.
  return (
    <Pressable
      accessibilityRole={command !== null ? 'button' : undefined}
      disabled={command === null}
      onPress={() => (command !== null ? dispatch(command as never) : undefined)}
      accessibilityLabel={str(card, 'foldText')}
      style={styles.fold}
    >
      <StatusMarker status={status} size={11} dim />
      {/* The question or title gives way; the outcome and time stay whole. */}
      <Text numberOfLines={1} style={styles.foldText}>
        {str(card, 'foldText')}
      </Text>
      {str(card, 'foldOutcome').length > 0 ? (
        <Text numberOfLines={1} style={styles.foldOutcome}>
          {str(card, 'foldOutcome')}
        </Text>
      ) : null}
      <Text style={styles.foldTime}>{str(card, 'time')}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  stack: { gap: 6, marginTop: 8 },
  dock: { gap: 6, paddingHorizontal: 12, paddingBottom: 6 },
  dockCards: { gap: 6 },
  dockLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
  },
  linkDots: { textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: P.muted },
  questionsCard: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  snoozeIndent: { paddingLeft: 22 },
  snoozeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4, paddingTop: 2 },
  snoozeChoice: { paddingHorizontal: 8, borderRadius: 6, backgroundColor: 'rgba(127,127,127,0.12)' },
  quiet: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.muted },
  whoLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  whoText: { flexShrink: 1, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.muted },
  dockSurface: {
    marginHorizontal: 12,
    marginBottom: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
  },
  dockRows: { padding: 4 },
  // The header: the band over the rows while open, as the desktop's (`work_dock_header`).
  dockHead: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingLeft: 12, paddingRight: 6 },
  dockHeadOpen: {
    borderBottomWidth: 1,
    borderBottomColor: P.inputBorder,
    backgroundColor: P.ink(0.035),
    borderTopLeftRadius: 11,
    borderTopRightRadius: 11,
  },
  dockHeadShut: { borderRadius: 11 },
  dockCounts: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, overflow: 'hidden' },
  dockCount: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  dockCountNumber: { fontSize: 13, fontWeight: '500', color: P.foreground, fontVariant: ['tabular-nums'] },
  dockCountName: { marginLeft: -1, fontSize: 13, color: P.cardMuted },
  dockHeadButton: { width: 28, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  dockPress: { gap: 2, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8 },
  dockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  // An opened row is its own card, a little lighter than the dock (desktop `dock_row`).
  dockRowOpen: {
    marginVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    backgroundColor: P.light ? 'rgba(255,255,255,0.6)' : P.ink(0.055),
  },
  dockIcon: { height: PROSE_LINE, justifyContent: 'center' },
  dockMain: { flex: 1, minWidth: 0, gap: 2 },
  dockTitle: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  pageTitle: { flexDirection: 'row', gap: 6, minWidth: 0 },
  pageName: { flexShrink: 1 },
  pageCount: { flexShrink: 0, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.cardMuted },
  ageSlot: { flexDirection: 'row', alignItems: 'center', gap: 4, height: PROSE_LINE },
  dockAnswers: { paddingLeft: 31, paddingRight: 8, paddingBottom: 6 },
  dockAnswersOpen: { paddingLeft: 31, paddingRight: 8, paddingBottom: 8 },
  // Under the title's text, not the mark: the mark and its gap (DOCK_LEAD).
  dockDetail: { gap: 4, marginLeft: DOCK_LEAD },
  dockLinks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
  itemLineColumn: { gap: 4 },
  // On a phone's width the names and "waits on this" wrap rather than cut each other to a few
  // letters (the desktop keeps one line); a name longer than the line is still cut at its end.
  itemLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 2, minWidth: 0 },
  itemName: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemNameText: { flexShrink: 1, fontSize: 12.5, lineHeight: 18, color: P.cardMuted },
  itemDot: { flexShrink: 0, fontSize: 12.5, color: P.muted, opacity: 0.6 },
  itemWords: { flexShrink: 0, fontSize: 12.5, lineHeight: 18, color: P.cardMuted },
  dockMore: { paddingLeft: 31, paddingRight: 8, paddingTop: 2, paddingBottom: 6, fontSize: PROSE_SIZE, color: P.muted },
  dismiss: { width: 20, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  dockFold: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  dockLineText: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, color: P.cardMuted },
  card: {
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
  },
  // On a narrow screen the status and age wrap under the title rather than squeeze it.
  top: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', columnGap: 8 },
  marker: { width: 14, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, minWidth: 140, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, fontWeight: '500', color: P.prose },
  right: { marginLeft: 'auto', fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.muted },
  line: { paddingLeft: 22, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.cardMuted },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 14,
    rowGap: 4,
    paddingLeft: 22,
    paddingTop: 2,
  },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: PROSE_LINE, flexShrink: 1, maxWidth: '100%' },
  chipText: { flexShrink: 1, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.cardMuted },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: 'auto' },
  fold: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.inputBorder,
  },
  foldText: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, color: P.cardMuted },
  foldTime: { fontSize: PROSE_SIZE, color: P.muted },
  foldOutcome: { flexShrink: 0, maxWidth: '60%', fontSize: PROSE_SIZE, fontWeight: '500', color: P.cardMuted },
  // The work item cards' own background, border and radius.
  moving: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
    overflow: 'hidden',
  },
  movingHead: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12 },
  movingTitle: { fontSize: PROSE_SIZE, fontWeight: '500', color: P.prose },
  movingSummary: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, color: P.cardMuted },
  movingList: { paddingHorizontal: 12, paddingBottom: 8 },
  movingGroup: {
    paddingTop: 8,
    paddingBottom: 2,
    fontSize: PROSE_SIZE,
    lineHeight: PROSE_LINE,
    fontWeight: '500',
    color: P.muted,
  },
  movingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 4 },
  movingMarker: { width: 20, height: PROSE_LINE, alignItems: 'center', justifyContent: 'center' },
  movingText: { flex: 1, minWidth: 0 },
  movingRowTitle: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.prose },
  movingRowLine: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.cardMuted },
  ring: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ringDot: { width: 4, height: 4, borderRadius: 2 },
  pause: { flexDirection: 'row', justifyContent: 'center', gap: 2.5 },
  pauseBar: { width: 3, borderRadius: 1, height: '100%' },
}));
