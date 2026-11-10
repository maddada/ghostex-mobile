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

import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

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
import { TranscriptFlagsProvider, transcriptFlags, useTranscriptFlags } from '../transcript/context';
import { strengthenedText } from '../transcript/textStrength';

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
            <WorkFoldLine card={card} />
          ) : (
            <WorkCard card={card} dispatch={dispatch} />
          )}
        </QuestionFlashFrame>
      ))}
    </View>
  );
}

/** The dock's cards stop growing here and scroll inside it (desktop `DOCK_MAX_HEIGHT`). */
const DOCK_MAX_HEIGHT = 300;

/**
 * The dock above a coordinator's chat box (gx-chat-core `work_cards::dock`, which holds the user's
 * pick C; desktop `render_work_dock`): every open ask as its full card, newest first, then the one
 * status line ("1 needs you · 5 in progress · 1 waiting") that opens the Work panel. The line's
 * chevron folds the cards. It sits outside the transcript, so it carries the transcript's flags
 * (Text strength) itself.
 */
export function WorkDock({
  document,
  dispatch,
  onOpenWork,
}: {
  document: ChatDocument | null;
  dispatch: Dispatch;
  onOpenWork: () => void;
}) {
  const flags = useMemo(() => transcriptFlags(document), [document]);
  const dock = obj(document?.workDock);
  const [folded, setFolded] = useState(false);
  if (dock === null) return null;
  const cards = arr(dock.cards)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null);
  const parts = arr(obj(dock.line)?.parts)
    .map(obj)
    .filter((part): part is JsonRecord => part !== null);
  if (cards.length === 0 && parts.length === 0) return null;
  return (
    <TranscriptFlagsProvider value={flags}>
      <DockBody
        cards={cards}
        parts={parts}
        folded={folded}
        onFold={() => setFolded((was) => !was)}
        dispatch={dispatch}
        onOpenWork={onOpenWork}
      />
    </TranscriptFlagsProvider>
  );
}

function DockBody({
  cards,
  parts,
  folded,
  onFold,
  dispatch,
  onOpenWork,
}: {
  cards: JsonRecord[];
  parts: JsonRecord[];
  folded: boolean;
  onFold: () => void;
  dispatch: Dispatch;
  onOpenWork: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.dock}>
      {cards.length > 0 && !folded ? (
        <ScrollView style={{ maxHeight: DOCK_MAX_HEIGHT }} contentContainerStyle={styles.dockCards}>
          {cards.map((card) => (
            <QuestionFlashFrame key={str(card, 'key')} target={str(card, 'key')} light={P.light}>
              <WorkCard card={card} dispatch={dispatch} />
            </QuestionFlashFrame>
          ))}
        </ScrollView>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open the Work panel"
        onPress={onOpenWork}
        style={styles.dockLine}
      >
        {cards.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={folded ? 'Show the cards' : 'Fold the cards'}
            hitSlop={8}
            onPress={onFold}
            style={styles.dockFold}
          >
            <Glyph name={folded ? 'chevron-up' : 'chevron-down'} size={12} color={P.muted} />
          </Pressable>
        ) : null}
        <Glyph name="layout-board-split" size={14} color={P.muted} />
        <Text numberOfLines={1} style={styles.dockLineText}>
          {parts.map((part, index) => (
            <Text key={`part:${index}`}>
              {index > 0 ? ' · ' : ''}
              <Text style={{ color: toneColor(str(part, 'tone')) ?? P.cardMuted }}>{str(part, 'text')}</Text>
            </Text>
          ))}
        </Text>
        <Glyph name="chevron-right" size={12} color={P.muted} />
      </Pressable>
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
                <Text style={styles.chipText}>{str(chip, 'label')}</Text>
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
    </View>
  );
}

/**
 * Everything still running, as one quiet row ("Moving · 7" and their names) that opens to a list; a
 * row of the list goes to that item's newest card (gx-chat-core `moving_row`, desktop
 * `work_moving_row`).
 */
function WorkMovingRow({ card, dispatch }: { card: JsonRecord; dispatch: Dispatch }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [open, setOpen] = useState(false);
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
                  <View style={styles.movingMarker}>
                    <WhoMark who={who} />
                  </View>
                  <View style={styles.movingText}>
                    <Text style={[styles.movingRowTitle, { color: body }]}>{str(row, 'title')}</Text>
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
function WorkFoldLine({ card }: { card: JsonRecord }) {
  const styles = useStyles();
  const status = str(card, 'foldStatus') || str(card, 'status');
  return (
    <View accessibilityLabel={str(card, 'foldText')} style={styles.fold}>
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
    </View>
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
