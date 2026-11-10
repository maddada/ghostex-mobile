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
import { openQuestionReply } from '../transcript/QuestionReply';

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

/** The dock's cards stop growing here and scroll inside it (desktop `DOCK_MAX_HEIGHT`). */
const DOCK_MAX_HEIGHT = 420;

/**
 * The dock directly on the chat box (gx-chat-core `work_cards::dock`, which holds the user's
 * decisions; desktop `render_work_dock`): one surface of compact rows, what needs him first, then
 * blocked work and what the newest turn finished; at most `phoneLimit` rows, then "N more need
 * you". A row shows its answer buttons; a tap expands it in place to its full text, links and
 * actions (Reply, Open, Mention, Show in chat, Dismiss, Snooze), and a tap again folds it. Its x
 * hides the whole dock; the Work pill brings it back. It sits outside the transcript, so it
 * carries the transcript's flags (Text strength).
 */
export function WorkDock({ document, chat }: { document: ChatDocument | null; chat: RustChat }) {
  const flags = useMemo(() => transcriptFlags(document), [document]);
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const dock = obj(document?.workDock);
  const rows = arr(dock?.rows)
    .map(obj)
    .filter((row): row is JsonRecord => row !== null);
  if (dock === null || rows.length === 0 || isTrue(dock, 'hidden')) return null;
  const limit = typeof dock.phoneLimit === 'number' ? dock.phoneLimit : 3;
  const hidden = Math.max(0, rows.length - limit);
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <TranscriptFlagsProvider value={flags}>
      <View style={styles.dockSurface}>
        <ScrollView style={{ maxHeight: DOCK_MAX_HEIGHT }} contentContainerStyle={styles.dockRows}>
          {rows.slice(0, limit).map((row) => (
            <QuestionFlashFrame key={str(row, 'key')} target={str(row, 'key')} light={P.light}>
              <DockRow
                row={row}
                chat={chat}
                open={open.has(str(row, 'key'))}
                onToggle={() => toggle(str(row, 'key'))}
              />
            </QuestionFlashFrame>
          ))}
          {hidden > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => chat.dispatch(dock.more as never)}>
              <Text style={styles.dockMore}>{hidden} more need you</Text>
            </Pressable>
          ) : null}
        </ScrollView>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hide until something new needs you"
          hitSlop={10}
          onPress={() => chat.dispatch({ type: 'hideWorkDock' } as never)}
          style={styles.dockHide}
        >
          <Glyph name="x" size={10} color={P.muted} />
        </Pressable>
      </View>
    </TranscriptFlagsProvider>
  );
}

function DockRow({
  row,
  chat,
  open,
  onToggle,
}: {
  row: JsonRecord;
  chat: RustChat;
  open: boolean;
  onToggle: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const body = useBodyColor();
  const [snoozing, setSnoozing] = useState(false);
  const dispatch = chat.dispatch;
  const busy = isTrue(row, 'busy');
  const buttons = arr(row.buttons)
    .map(obj)
    .filter((button): button is JsonRecord => button !== null);
  const reply = obj(row.reply);
  const openCommand = obj(row.open);
  const show = obj(row.showInChat);
  const dismiss = obj(row.dismiss);
  const mention = str(row, 'mention');
  const snooze = arr(row.snooze)
    .map(obj)
    .filter((choice): choice is JsonRecord => choice !== null);
  const action = (label: string, onPress: () => void) => (
    <ToneButton key={label} kind="secondary" label={label} onPress={onPress} />
  );
  return (
    <View style={open ? styles.dockRowOpen : null}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={styles.dockRow}
      >
        <View style={styles.dockIcon}>
          <StatusMarker status={str(row, 'status')} size={13} />
        </View>
        <Text numberOfLines={open ? undefined : 2} style={[styles.dockTitle, { color: body }]}>
          {str(row, 'title')}
        </Text>
        <Text style={styles.foldTime}>{str(row, 'age')}</Text>
      </Pressable>
      {buttons.length > 0 ? (
        <View style={styles.dockButtons}>
          {buttons.map((button, index) => (
            <ToneButton
              key={`answer:${index}`}
              kind="secondary"
              label={str(button, 'label')}
              trailing={
                isTrue(button, 'recommended') ? (
                  <Glyph name="star" size={10} color={tint(askColor(P.light), 0.75)} />
                ) : undefined
              }
              icon={isTrue(button, 'picked') ? 'check' : undefined}
              disabled={busy}
              onPress={() => dispatch(button.command as never)}
            />
          ))}
        </View>
      ) : null}
      {open ? (
        <View style={styles.dockDetail}>
          {arr(row.detail)
            .map((line) => (typeof line === 'string' ? line : ''))
            .filter((line) => line.length > 0)
            .map((line, index) => (
              <Text key={`line:${index}`} style={styles.movingRowLine}>
                {line}
              </Text>
            ))}
          {/* Its links (the work it belongs to, its thread, a PR or issue, a file), as on the desktop row. */}
          {arr(row.chips).length > 0 ? (
            <View style={styles.dockLinks}>
              {arr(row.chips)
                .map(obj)
                .filter((chip): chip is JsonRecord => chip !== null)
                .map((chip, index) => {
                  const command = obj(chip.command);
                  const kind = str(chip, 'kind');
                  return (
                    <Pressable
                      key={`link:${index}`}
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
                      <Text style={[styles.chipText, command !== null ? styles.linkDots : null]}>
                        {str(chip, 'label')}
                      </Text>
                    </Pressable>
                  );
                })}
            </View>
          ) : null}
          <View style={styles.dockActions}>
            {reply !== null
              ? action('Reply', () =>
                  openQuestionReply({
                    form: typeof reply.form === 'string' ? reply.form : null,
                    tag: str(reply, 'tag'),
                    ...(typeof reply.item === 'string' ? { item: reply.item, key: str(reply, 'key') } : {}),
                  }),
                )
              : null}
            {openCommand !== null ? action('Open', () => dispatch(openCommand as never)) : null}
            {mention.length > 0
              ? action('Mention', () =>
                  dispatch({
                    type: 'insertBoardReference',
                    reference: mention,
                    text: chat.state?.composer.text ?? '',
                  } as never),
                )
              : null}
            {show !== null ? action('Show in chat', () => dispatch(show as never)) : null}
            {dismiss !== null ? action('Dismiss', () => dispatch(dismiss as never)) : null}
            {snooze.length > 0 ? action(snoozing ? 'Snooze for' : 'Snooze', () => setSnoozing((was) => !was)) : null}
            {snoozing
              ? snooze.map((choice) =>
                  action(str(choice, 'label'), () => {
                    setSnoozing(false);
                    dispatch(choice.command as never);
                  }),
                )
              : null}
          </View>
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
  dockRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6, paddingHorizontal: 8 },
  dockRowOpen: { borderRadius: 8, backgroundColor: 'rgba(127,127,127,0.06)' },
  dockIcon: { height: PROSE_LINE, justifyContent: 'center' },
  dockTitle: { flex: 1, minWidth: 0, fontSize: PROSE_SIZE, lineHeight: PROSE_LINE },
  dockButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingLeft: 31, paddingRight: 8, paddingBottom: 6 },
  dockDetail: { gap: 4, paddingLeft: 31, paddingRight: 8, paddingBottom: 8 },
  dockLinks: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 4 },
  dockActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 2 },
  dockMore: { paddingLeft: 31, paddingRight: 8, paddingTop: 2, paddingBottom: 6, fontSize: PROSE_SIZE, color: P.muted },
  dockHide: {
    position: 'absolute',
    top: -9,
    right: -9,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
