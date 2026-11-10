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

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
import { useTranscriptFlags } from '../transcript/context';
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
        <StatusMarker status="moving" size={11} />
        <Text style={[styles.movingTitle, { color: body }]}>{str(card, 'title')}</Text>
        <Text numberOfLines={1} style={styles.movingSummary}>
          {open ? '' : str(card, 'summary')}
        </Text>
      </Pressable>
      {open
        ? rows.map((row, index) => {
            const command = obj(row.command);
            const line = str(row, 'line');
            return (
              <Pressable
                key={`row:${index}`}
                accessibilityRole="button"
                accessibilityLabel={str(row, 'title')}
                disabled={command === null}
                onPress={() => (command !== null ? dispatch(command as never) : undefined)}
                style={styles.movingRow}
              >
                <View style={styles.movingMarker}>
                  <StatusMarker status={str(row, 'status')} size={10} />
                </View>
                <View style={styles.movingText}>
                  <Text numberOfLines={1} style={[styles.movingRowTitle, { color: body }]}>
                    {str(row, 'title')}
                  </Text>
                  {line.length > 0 ? (
                    <Text numberOfLines={1} style={styles.movingRowLine}>
                      {line}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.foldTime}>{str(row, 'age')}</Text>
              </Pressable>
            );
          })
        : null}
    </View>
  );
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
  movingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: P.inputBorder,
  },
  movingMarker: { width: 32, height: PROSE_LINE, alignItems: 'flex-end', justifyContent: 'center', paddingRight: 2 },
  movingText: { flex: 1, minWidth: 0 },
  movingRowTitle: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.prose },
  movingRowLine: { fontSize: PROSE_SIZE, lineHeight: PROSE_LINE, color: P.cardMuted },
  ring: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  ringDot: { width: 4, height: 4, borderRadius: 2 },
  pause: { flexDirection: 'row', justifyContent: 'center', gap: 2.5 },
  pauseBar: { width: 3, borderRadius: 1, height: '100%' },
}));
