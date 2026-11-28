/**
 * A coordinator's board, the Board pill's sheet: its lines of work grouped by who has the ball
 * (Backlog, To do, Needs you, Blocked, On hold, In progress, Done today, Removed), each a card of its title and
 * its work's links.
 * Groups, rows, tags, folds and counts come from the core (gx-chat-core
 * `extras/coordinator_board.rs`, where the user's decision lives); this only lays them out. A row
 * opens its thread, its question card or its link, as the desktop's side panel does
 * (`apps/desktop/src/app/native_chat/coordinator_board.rs`).
 */

import { plural } from '../../../plural';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Clipboard from 'expo-clipboard';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ScrollViewInstance,
} from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { UserAction } from '../../rust/actions';
import type { RustChat } from '../../rust/useRustChat';
import { SidebarPalette } from '../../../theme/palette';
import { Glyph, type GlyphName } from './icons';
import type { TablerIconComponent } from '../../../assets/tablerIcons.generated';
import { TagGlyph } from '../../../components/sessions/icons';
import { customSessionTagIcon, sessionTagIcon } from '../../../contract/sessionTags';
import { arr, asJson, isTrue, num, obj, str } from './json';
import { usePageCountRefresh } from './pageCounts';
import { PROSE_SIZE, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { TranscriptEnvProvider, type TranscriptEnv } from '../transcript/context';
import { useQuestionReplyOwner } from '../transcript/QuestionReply';
import { LinkWords } from '../transcript/LinkWords';
import { askColor, tint } from './askCard';
import {
  CHOOSE_ANSWER,
  OPENED_ROW_GAP,
  TextArea,
  WorkAnswerLine,
  WorkDescription,
  WorkMenuButton,
  openWorkReply,
  workMenuRows,
  type WorkMenuRow,
} from './workItemParts';
import { replyDraftScopeOf, type ReplyDraftScope } from './replyDrafts';
import { remoteWorkerNotice } from './remoteWorker';
import { AgentMark } from './agentMark';
import { BoardRelayButtons } from './RelayedApprovalCard';
import { openRelayedCardForThread } from './relayedApprovals';
import { showAlert } from '../../../components/common/dialog/alert';

/** Each group's colour: the sidebar's question pink, approval red and working amber. */
const GROUP_COLOR: Record<string, string | null> = {
  needs: SidebarPalette.ROW_QUESTION,
  blocked: SidebarPalette.ROW_APPROVAL,
  // On hold: waiting on something outside, a calm blue-grey (desktop `HOLD_COLOR`).
  hold: '#7fa1c4',
  moving: '#c68a06',
  done: '#2fa865',
};

/** A chip's words: what the link is, then its label ("PR #414", "Issue #12", "GHX-142"). */
function chipLabel(kind: string, label: string): string {
  switch (kind) {
    case 'pr':
      return `PR ${label}`;
    case 'issue':
      return `Issue ${label}`;
    default:
      return label;
  }
}

/** A tag's tint (`BoardTag::tone`), or null for the muted chip. */
export function toneColor(tone: string): string | null {
  switch (tone) {
    case 'question':
      return SidebarPalette.ROW_QUESTION;
    case 'bad':
      return SidebarPalette.ROW_APPROVAL;
    case 'running':
    case 'warn':
      return '#c68a06';
    case 'good':
      return '#2fa865';
    case 'hold':
      return '#7fa1c4';
    case 'held':
    case 'merged':
      return '#8b78f0';
    case 'closed':
      return '#8a8f98';
    default:
      return null;
  }
}

/** The leading icon on a thread-wait Needs you card (desktop `work_cards.rs` `row_mark`). */
function ThreadWaitMark({ waitKind, needsApproval }: { waitKind: string; needsApproval: boolean }) {
  if (waitKind === 'approval' || (waitKind !== 'signIn' && waitKind !== 'usageLimit' && needsApproval)) {
    return <Glyph name="shield-alert" size={14} color={SidebarPalette.ROW_APPROVAL} />;
  }
  if (waitKind === 'signIn' || waitKind === 'usageLimit') {
    return <Glyph name="alert-triangle" size={14} color="#c68a06" />;
  }
  return <GroupMarker group="needs" />;
}

/** The group's marker: Tabler SVGs matching desktop `group_look` (Q4775-Q4783). */
function GroupMarker({ group }: { group: string }) {
  const P = useTranscriptTheme();
  const color = GROUP_COLOR[group] ?? P.cardMuted;
  if (group === 'done') return <Glyph name="circle-check" size={12} color={color} />;
  if (group === 'blocked') return <Glyph name="circle-minus-filled" size={12} color={color} />;
  if (group === 'moving') return <Glyph name="circle-half" size={12} color={color} />;
  if (group === 'hold') return <Glyph name="player-pause" size={12} color={color} />;
  if (group === 'needs') return <Glyph name="circle-dot" size={12} color={color} />;
  if (group === 'later') return <Glyph name="calendar-clock" size={12} color={color} />;
  if (group === 'removed') return <Glyph name="circle-off" size={12} color={color} />;
  if (group === 'ideas') return <Glyph name="archive" size={12} color={color} />;
  return <Glyph name="circle-dashed" size={12} color={color} />;
}

/**
 * A Needs you card's answered/total count ("0/1"): a page's own, else its dock row's (a form's).
 * A computer that sends neither keeps today's card.
 */
function cardCount(row: unknown): string {
  return str(row, 'count') || str(obj(obj(row)?.dock), 'count');
}

/** The Blocked pill's id (gx-chat-core `BLOCKED_PILL`): a tap opens the board at Blocked. */
export const BLOCKED_PILL = 'boardBlocked';

/** The user's own tag on a card: the sidebar's glyph and colour (gx-chat-core `userTag`). */
function UserTagChip({ tag }: { tag: unknown }) {
  const styles = useStyles();
  const color = str(tag, 'color') || '#8e949d';
  const Icon = tagIcon(str(tag, 'icon'));
  return (
    <View accessibilityLabel={str(tag, 'title')} style={[styles.tag, { borderColor: `${color}73` }]}>
      <Icon size={12} color={color} />
      <Text style={styles.tagText} numberOfLines={1}>
        {str(tag, 'label')}
      </Text>
    </View>
  );
}

/** A tag's glyph from its asset name (`star-filled`, `brand-github`): a built-in's by its value,
 * a custom tag's by its catalog icon id. */
function tagIcon(icon: string): TablerIconComponent {
  const builtin: Record<string, string> = {
    'star-filled': 'favorite',
    'alert-triangle': 'high-priority',
    'arrow-down': 'low-priority',
    microscope: 'research',
    checkbox: 'todo',
    'player-play': 'in-progress',
    'test-pipe': 'testing',
    'barrier-block': 'blocked',
    'player-pause': 'on-hold',
    'circle-check': 'done',
    bug: 'bug',
    puzzle: 'feature',
    palette: 'design',
  };
  const tag = builtin[icon];
  if (tag !== undefined) return sessionTagIcon(tag) ?? TagGlyph;
  const id =
    icon === 'terminal-2' ? 'terminal' : icon.replace(/-([a-z0-9])/gu, (_, next: string) => next.toUpperCase());
  return customSessionTagIcon(id);
}

/** Which glyph a menu row draws (gx-chat-core `BoardMenuItem::icon`). */
function menuGlyph(icon: string): GlyphName {
  switch (icon) {
    case 'external-link':
    case 'message-plus':
    case 'circle-check':
    case 'tag':
    case 'trash':
    case 'arrow-back-up':
    case 'hash':
    case 'quote':
      return icon;
    default:
      return 'chevron-right';
  }
}

/** How long a copying row says "Copied" before the menu closes. */
const MENU_COPIED_MS = 900;

/**
 * A card's menu, opened in place under the held card: the core's rows (Open, Copy reference,
 * Reference in chat, Tags, Mark done, Remove or Restore), and Tags turning the list into the
 * sidebar's tags with a back row, as the desktop's menu reopens in place. In place rather than a
 * second sheet, which iOS cannot show over the board's own. A row that copies (the core's
 * `{type: "copyText", text}`, a dock row's `copy`) puts its words on the clipboard here and says
 * "Copied" in its place for a moment before the menu closes (`onCopied`).
 */
function CardMenu({
  row,
  workRows,
  tagOptions,
  tagsPage,
  onTags,
  onPick,
  onCopied,
}: {
  row: unknown;
  /** The dock's own rows for this item first: Show in chat, Dismiss, Snooze (`workItemParts.tsx`). */
  workRows: WorkMenuRow[];
  tagOptions: unknown[];
  tagsPage: boolean;
  onTags: (open: boolean) => void;
  onPick: (command: Record<string, unknown>) => void;
  onCopied: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [snoozing, setSnoozing] = useState<Record<string, unknown>[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copy = (key: string, text: string) => {
    void Clipboard.setStringAsync(text);
    setCopied(key);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(onCopied, MENU_COPIED_MS);
  };
  const setTag = obj(obj(row)?.setTag);
  const current = str(row, 'tag');
  if (snoozing !== null) {
    return (
      <View style={styles.cardMenu}>
        <Pressable accessibilityRole="button" onPress={() => setSnoozing(null)} style={styles.cardMenuRow}>
          <Glyph name="chevron-left" size={15} color={P.cardMuted} />
          <Text style={[styles.cardMenuText, { color: P.cardMuted }]}>Snooze for</Text>
        </Pressable>
        {snoozing.map((choice, index) => (
          <Pressable
            key={`snooze:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`Snooze for ${str(choice, 'label')}`}
            onPress={() => {
              const command = obj(choice.command);
              setSnoozing(null);
              if (command !== null) onPick(command);
            }}
            style={styles.cardMenuRow}
          >
            <Glyph name="moon" size={15} color={P.cardMuted} />
            <Text style={styles.cardMenuText}>{str(choice, 'label')}</Text>
          </Pressable>
        ))}
      </View>
    );
  }
  if (tagsPage && setTag !== null) {
    return (
      <View style={styles.cardMenu}>
        <Pressable accessibilityRole="button" onPress={() => onTags(false)} style={styles.cardMenuRow}>
          <Glyph name="chevron-left" size={15} color={P.cardMuted} />
          <Text style={[styles.cardMenuText, { color: P.cardMuted }]}>Tag As</Text>
        </Pressable>
        {current.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => onPick({ ...setTag, tag: '' })}
            style={styles.cardMenuRow}
          >
            <Glyph name="x" size={15} color={P.cardMuted} />
            <Text style={styles.cardMenuText}>No tag</Text>
          </Pressable>
        ) : null}
        {tagOptions.map((option) => {
          const value = str(option, 'value');
          const Icon = tagIcon(str(option, 'icon'));
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: value === current }}
              onPress={() => onPick({ ...setTag, tag: value })}
              style={styles.cardMenuRow}
            >
              <Icon size={15} color={str(option, 'color') || P.cardMuted} />
              <Text style={[styles.cardMenuText, styles.flex]}>{str(option, 'label')}</Text>
              {value === current ? <Glyph name="check" size={14} color={P.cardMuted} /> : null}
            </Pressable>
          );
        })}
      </View>
    );
  }
  return (
    <View style={styles.cardMenu}>
      {workRows.map((item) => {
        const key = `work:${item.label}`;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            onPress={() =>
              item.snooze !== undefined
                ? setSnoozing(item.snooze)
                : item.copy !== undefined
                  ? copy(key, item.copy)
                  : item.command
                    ? onPick(item.command)
                    : undefined
            }
            style={styles.cardMenuRow}
          >
            <Glyph name={copied === key ? 'check' : item.icon} size={15} color={P.foreground} />
            <Text style={[styles.cardMenuText, styles.flex]}>{copied === key ? 'Copied' : item.label}</Text>
            {item.snooze !== undefined ? <Glyph name="chevron-right" size={14} color={P.cardMuted} /> : null}
          </Pressable>
        );
      })}
      {arr(obj(row)?.menu).map((item, index) => {
        const destructive = isTrue(item, 'destructive');
        const color = destructive ? SidebarPalette.ROW_APPROVAL : P.foreground;
        const command = obj(obj(item)?.command);
        const tags = str(item, 'submenu') === 'tags';
        const key = `${index}:${str(item, 'label')}`;
        // Copy reference (gx-chat-core `coordinator_board.rs`, CDXC:SessionChat 2026-11-25 in
        // transcript/item_references.rs): the phone copies the words itself.
        const copyText = command !== null && str(command, 'type') === 'copyText' ? str(command, 'text') : null;
        const shownCopied = copied === key;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            onPress={() =>
              tags
                ? onTags(true)
                : copyText !== null
                  ? copyText.length > 0
                    ? copy(key, copyText)
                    : undefined
                  : command !== null
                    ? onPick(command)
                    : undefined
            }
            style={styles.cardMenuRow}
          >
            {str(item, 'icon') === 'agent' ? (
              <AgentMark icon={str(row, 'agentIcon') || null} size={15} />
            ) : (
              <Glyph name={shownCopied ? 'check' : menuGlyph(str(item, 'icon'))} size={15} color={color} />
            )}
            <Text style={[styles.cardMenuText, styles.flex, { color }]}>
              {shownCopied ? 'Copied' : str(item, 'label')}
            </Text>
            {tags ? <Glyph name="chevron-right" size={14} color={P.cardMuted} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A closed card's answer segment's width, roughly: its label grown by the phone's text size, sides and marks. */
function segmentWidth(label: string, marks: number, fontScale: number): number {
  return label.length * 7.6 * fontScale + 24 + marks;
}

/**
 * A closed card's answers as one segmented pill (desktop `board_answers` and `work_compact_answers`):
 * the recommended one starred, the one given checked, then Reply, which shows the words sent from
 * here. When they do not fit the card's
 * line the answers fold into "Choose an answer", which opens the card with them listed whole
 * (`onChoose`), so none is cut; once one is given only that one shows. `room` is the line's width.
 */
function ClosedAnswers({
  answers,
  reply,
  replied,
  scope,
  dispatch,
  onReply,
  onChoose,
  room,
  lead,
}: {
  answers: Record<string, unknown>[];
  reply: Record<string, unknown> | null;
  replied: string;
  scope: ReplyDraftScope | null;
  dispatch: RustChat['dispatch'];
  onReply: (reply: Record<string, unknown>) => void;
  onChoose: () => void;
  room: number;
  /** The work it belongs to, before the answers while they leave it room (gx-chat-core work_panel.rs). */
  lead: string;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { fontScale } = useWindowDimensions();
  const given = answers.some((answer) => isTrue(answer, 'picked'));
  const locked = answers.some((answer) => isTrue(answer, 'locked') || isTrue(answer, 'picked'));
  const replyWords = replied.length > 32 ? `${replied.slice(0, 31).trimEnd()}…` : replied;
  // The line's own width and each segment's whole width, measured (`measured`), so the fold holds
  // at any width the sheet gets (split screen, a folded or unfolded foldable, a large text size);
  // the estimates only stand in until the first layout.
  const [lineWidth, setLineWidth] = useState(0);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const measure = (key: string) => (event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    setMeasured((was) => (was[key] === next ? was : { ...was, [key]: next }));
  };
  const onLine = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    setLineWidth((was) => (was === next ? was : next));
  };
  const line = lineWidth > 0 ? lineWidth : room;
  const answerKey = (answer: Record<string, unknown>, index: number) =>
    `answer:${index}:${str(answer, 'label')}:${isTrue(answer, 'picked')}:${isTrue(answer, 'recommended')}`;
  const replyKey = `reply:${replyWords}`;
  const widths = answers.map(
    (answer, index) =>
      measured[answerKey(answer, index)] ??
      segmentWidth(
        str(answer, 'label'),
        (isTrue(answer, 'recommended') ? 13 : 0) + (isTrue(answer, 'picked') ? 15 : 0),
        fontScale,
      ),
  );
  // The pill's own border, around its segments.
  const frame = 2;
  const answersWidth = widths.reduce((sum, value) => sum + value, 0);
  const replyWidth =
    reply !== null
      ? (measured[replyKey] ??
        segmentWidth(replyWords.length > 0 ? replyWords : 'Reply', 15, fontScale))
      : 0;
  const fits = answersWidth + replyWidth + frame <= line;
  /*
   * CDXC:Coordinators 2026-11-15 WHY:
   * After the dock's answers broke inside their words in split screen on an Android foldable (user:
   * "The choice options in the left side are being wrapped weird please show a dropdown button in
   * this case"), the Work sheet's closed cards take the same rule as the dock (`WorkAnswerLine`):
   * the line and every segment are measured instead of guessed from the screen's width, and any two
   * or more answers that do not fit fold into Choose an answer rather than squeeze.
   */
  const fold = !fits && !given && answers.length > 1;
  const shown = fits || !given ? answers : answers.filter((answer) => isTrue(answer, 'picked'));
  const chooseWidth = fold
    ? (measured.choose ?? segmentWidth(CHOOSE_ANSWER, 15, fontScale))
    : shown.reduce((sum, answer) => sum + widths[answers.indexOf(answer)]!, 0);
  // On a card too narrow for Choose an answer and Reply both, the closed pill leaves Reply out:
  // Choose an answer opens the card, where Reply stands beside the answers.
  const showReply = reply !== null && (!fold || chooseWidth + replyWidth + frame <= line);
  const pillWidth = chooseWidth + (showReply ? replyWidth : 0) + frame;
  // The work's name gives way first: it shows only while the answers keep their room beside it, as
  // a narrow desktop column shows the answers alone.
  const showLead = lead.length > 0 && (reply === null || showReply) && pillWidth + 46 <= line;
  const chooseSegment = (onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${CHOOSE_ANSWER}, ${plural(answers.length, 'answer', 'answers')}`}
      hitSlop={{ top: 10, bottom: 10 }}
      onPress={onPress}
      style={[styles.answer, styles.answerKept]}
    >
      <Text style={[styles.tagText, styles.answerStrong, styles.answerKept]} numberOfLines={1}>
        {CHOOSE_ANSWER}
      </Text>
      <Glyph name="chevron-down" size={11} color={P.cardMuted} />
    </Pressable>
  );
  const answerSegment = (answer: Record<string, unknown>, answerIndex: number) => (
    <Pressable
      key={`answer:${answerIndex}`}
      accessibilityRole="button"
      accessibilityLabel={`Answer ${str(answer, 'label')}${isTrue(answer, 'recommended') ? ', Recommended' : ''}`}
      disabled={isTrue(answer, 'locked')}
      hitSlop={{ top: 10, bottom: 10 }}
      onPress={() => {
        const answerCommand = obj(answer.command);
        if (answerCommand !== null) dispatch(asJson(answerCommand) as unknown as UserAction);
      }}
      style={[
        styles.answer,
        answerIndex > 0 && styles.answerDivider,
        isTrue(answer, 'picked') && styles.answerPicked,
        isTrue(answer, 'locked') && !isTrue(answer, 'picked') && styles.answerFaded,
      ]}
    >
      {isTrue(answer, 'picked') ? <Glyph name="check" size={11} color={P.foreground} /> : null}
      {/* Never cut: past the line the answers fold, and a given one wraps. */}
      <Text
        style={[styles.tagText, (isTrue(answer, 'picked') || isTrue(answer, 'recommended')) && styles.answerStrong]}
      >
        {str(answer, 'label')}
      </Text>
      {isTrue(answer, 'recommended') ? <Glyph name="star" size={9} color={tint(askColor(P.light), 0.75)} /> : null}
    </Pressable>
  );
  const replySegment = (target: Record<string, unknown>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Reply"
      disabled={(locked && replied.length === 0) || replied.length > 0}
      hitSlop={{ top: 10, bottom: 10 }}
      onPress={() => onReply(target)}
      style={[
        styles.answer,
        // A divider after the answers or the dropdown before it (always one of them here).
        answers.length > 0 && styles.answerDivider,
        replied.length > 0 && styles.answerPicked,
        replied.length === 0 && styles.answerKept,
        locked && replied.length === 0 && styles.answerFaded,
      ]}
    >
      <Glyph name={replied.length > 0 ? 'check' : 'arrow-back-up'} size={11} color={P.cardMuted} />
      <Text
        style={[styles.tagText, replied.length > 0 ? styles.answerStrong : styles.answerKept]}
        numberOfLines={1}
      >
        {replyWords.length > 0 ? replyWords : 'Reply'}
      </Text>
    </Pressable>
  );
  // While it fits, the pill keeps its width and the work's name gives way; a pill wider than the
  // line (a given answer, or a very large text size) shrinks, wrapping its words, and is never cut.
  return (
    <View style={styles.closedLine} onLayout={onLine}>
      {/* Every segment at its whole width, unseen, to measure the line by (`measured`). */}
      <View
        style={styles.measure}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {answers.map((answer, index) => (
          <View key={`m:${index}`} style={styles.measureItem} onLayout={measure(answerKey(answer, index))}>
            {answerSegment(answer, index)}
          </View>
        ))}
        {reply !== null ? (
          <View style={styles.measureItem} onLayout={measure(replyKey)}>
            {replySegment(reply)}
          </View>
        ) : null}
        <View style={styles.measureItem} onLayout={measure('choose')}>
          {chooseSegment(() => undefined)}
        </View>
      </View>
      {showLead ? (
        <Text numberOfLines={1} style={styles.lead}>
          {lead}
        </Text>
      ) : null}
      <View style={[styles.answers, pillWidth <= line ? styles.answersWhole : null]}>
        {fold ? chooseSegment(onChoose) : null}
        {(fold ? [] : shown).map((answer) => answerSegment(answer, answers.indexOf(answer)))}
        {showReply && reply !== null ? replySegment(reply) : null}
      </View>
    </View>
  );
}

/** A board pill's tap (gx-chat-core `show_item`): the card to show, once per `seq`. */
export type BoardFocus = { key: string; group?: string; seq: number };

type BoardMenuProps = {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
  /** Takes a Reply's opening to run once this sheet has gone (`WorkAnswerLine`'s `afterSheet`); none: at once. */
  afterSheet?: (open: () => void) => void;
  /** The card to scroll to and ring for a moment (desktop `scroll_into_view`). */
  focus?: BoardFocus | null;
};

/** The Work sheet; it sits outside the transcript, so it brings an env for an ask's description and title links. */
export function CoordinatorBoardMenu(props: BoardMenuProps) {
  const P = useTranscriptTheme();
  const dispatch = props.chat.dispatch;
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
  return (
    <TranscriptEnvProvider value={env}>
      <CoordinatorBoardList {...props} />
    </TranscriptEnvProvider>
  );
}

/**
 * How long a jumped-to group's outline takes to blink twice (fade in and out, twice).
 *
 * CDXC:Coordinators 2026-11-25 DECISION:
 * User, of the Work panel opening at In progress from a status pill: "it's shifting the layout of
 * the in progress please lets not do this ... i just want a quick white outline that blinks twice
 * smoothly (fade in and out) on them", then the slower speed (Q4951) and "make the outline shifted
 * 10px from left/right/bottom please so it's not hugging items so close". The tinted box with its
 * padding is gone; an outline overlay sits outside the group, so nothing inside moves. Then, of
 * its bottom edge running into the next group's header: "please make it not overlap and also pls
 * make the color of the outline more transparent": the bottom edge is the group's own (its last
 * card's 8 pt margin below it) and the line peaks at GROUP_BLINK_PEAK. The desktop's
 * `GROUP_BLINK_FOR` (native_chat/coordinator_board.rs) matches.
 */
const GROUP_BLINK_MS = 1800;
/**
 * How far the outline sits outside the group on the left and right. Its top and bottom are the
 * group's own edges: the groups above and below start right there.
 */
const GROUP_BLINK_ROOM = 10;
/** The outline's opacity at the top of each blink: a soft line, not a full white one. */
const GROUP_BLINK_PEAK = 0.4;

/**
 * The outline a jumped-to group blinks with: absolute over the group (its own layout untouched),
 * white in dark mode and near black in light mode, two smooth fades in and out, then gone.
 */
function GroupBlinkOutline({ light }: { light: boolean }) {
  const blink = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const fade = (to: number) =>
      Animated.timing(blink, {
        toValue: to,
        duration: GROUP_BLINK_MS / 4,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      });
    const run = Animated.sequence([fade(GROUP_BLINK_PEAK), fade(0), fade(GROUP_BLINK_PEAK), fade(0)]);
    run.start();
    return () => run.stop();
  }, [blink]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: -GROUP_BLINK_ROOM,
        right: -GROUP_BLINK_ROOM,
        bottom: 0,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: light ? '#141414' : '#ffffff',
        opacity: blink,
      }}
    />
  );
}

function CoordinatorBoardList({ chat, document, onDone, afterSheet, focus = null }: BoardMenuProps) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  // Where each group sits in the list and each card in its group, so a board pill's card can be
  // scrolled to once both are known.
  const list = useRef<ScrollViewInstance>(null);
  const groupTops = useRef<Record<string, number>>({});
  const cardTops = useRef<Record<string, { group: string; y: number }>>({});
  const scrolledFor = useRef<number | null>(null);
  const [ringed, setRinged] = useState<string | null>(null);
  const [highlightedGroup, setHighlightedGroup] = useState<string | null>(null);
  const scrollToFocus = () => {
    if (focus === null || scrolledFor.current === focus.seq) return;
    if (focus.group) {
      const groupY = groupTops.current[focus.group];
      if (groupY === undefined) return;
      scrolledFor.current = focus.seq;
      list.current?.scrollTo({ y: Math.max(0, groupY - 8), animated: true });
      return;
    }
    const card = cardTops.current[focus.key];
    const group = card !== undefined ? groupTops.current[card.group] : undefined;
    if (card === undefined || group === undefined) return;
    scrolledFor.current = focus.seq;
    list.current?.scrollTo({ y: Math.max(0, group + card.y - 8), animated: true });
  };
  useEffect(() => {
    if (focus === null) return undefined;
    if (focus.group) {
      setRinged(null);
      setHighlightedGroup(focus.group);
    } else {
      setHighlightedGroup(null);
      setRinged(focus.key);
    }
    scrollToFocus();
    const timer = setTimeout(() => {
      setRinged(null);
      setHighlightedGroup(null);
    }, 2200);
    return () => clearTimeout(timer);
    // `scrollToFocus` reads refs; a new tap is a new `seq`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, focus?.group, focus?.seq]);
  // The card whose menu a long press opened, and whether it shows its Tags page. Remove is one of
  // its rows (the phone's long-press rule: a card's actions open on a hold).
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuTags, setMenuTags] = useState(false);
  // The card whose closed "Choose an answer" opened it: its answers start listed.
  const [chooseFor, setChooseFor] = useState<string | null>(null);
  // The card under a finger: an opened card lights its title line, the part that shuts it.
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const { width: screenWidth, fontScale } = useWindowDimensions();
  // The chat the dock registered, so a Reply from here keeps its draft (`replyDrafts.ts`).
  const scope = replyDraftScopeOf(chat.dispatch);
  // A Reply from here opens in this chat.
  const owner = useQuestionReplyOwner();
  // The Topic being rewritten in place, and its words so far.
  const [topicDraft, setTopicDraft] = useState<string | null>(null);
  const board = obj(document.coordinatorBoard);
  // The Needs you pages' answered/total counts follow their drafts while the sheet is open.
  usePageCountRefresh(
    chat.dispatch,
    arr(board?.groups).flatMap((group) => arr(obj(group)?.rows).map((row) => str(obj(obj(row)?.dock), 'pageId'))),
  );
  if (board === null) return null;
  const topic = str(obj(board.topic), 'text');
  // Saved on Return or when the field loses the keyboard; unchanged words send nothing.
  const saveTopic = () => {
    if (topicDraft === null) return;
    const words = topicDraft.trim();
    setTopicDraft(null);
    if (words !== topic) chat.dispatch({ type: 'setWorkTopic', text: words } as unknown as UserAction);
  };
  // Puts a card's reference in the chat box so the user can comment on it, and closes the sheet.
  const mention = (reference: string) => {
    if (reference.length === 0) return;
    chat.dispatch({
      type: 'insertBoardReference',
      reference,
      text: chat.state?.composer.text ?? '',
    } as unknown as UserAction);
    onDone();
  };
  const run = (command: unknown) => {
    const type = str(command, 'type');
    if (type.length === 0) return;
    // A thread on another computer: the phone talks only to the coordinator's computer.
    if (type === 'openCoordinatorThread' && str(command, 'serverId').trim().length > 0) {
      const notice = remoteWorkerNotice('another computer');
      showAlert(notice.title, notice.message);
      return;
    }
    chat.dispatch(asJson(command) as unknown as UserAction);
    onDone();
  };
  // Route navigation/open actions from expanded card controls through `run` so the Work sheet
  // closes and remote-worker `serverId` checks still run, while in-sheet actions stay open.
  const dispatchFromLine = (action: unknown) => {
    const type = str(action, 'type');
    if (
      type === 'openCoordinatorThread' ||
      type === 'openExternalUrl' ||
      type === 'openResource' ||
      type === 'jumpToQuestion' ||
      type === 'openWorkAsk'
    ) {
      run(action);
      return;
    }
    chat.dispatch(asJson(action) as unknown as UserAction);
  };
  return (
    // "Work" over the coordinator's work items (gx-chat-core `work_panel.rs`), "Board" from an older gxserver.
    <View accessibilityLabel={str(board, 'title') || 'Board'} style={styles.menu}>
      <Text style={styles.meta} numberOfLines={1}>
        {isTrue(board, 'empty') ? 'Nothing open' : str(board, 'meta')}
      </Text>
      {/* The Topic: what the session is about, in one line; a tap rewrites it (desktop
          `native_chat/work_topic.rs`). Only where the computer keeps one (the core's `topicEditable`). */}
      {isTrue(board, 'topicEditable') &&
        (topicDraft !== null ? (
          <TextInput
            accessibilityLabel="Topic"
            autoFocus
            value={topicDraft}
            onChangeText={setTopicDraft}
            onSubmitEditing={saveTopic}
            onBlur={saveTopic}
            returnKeyType="done"
            maxLength={200}
            placeholder="What this session is about, in one line"
            placeholderTextColor={P.cardMuted}
            style={[styles.topic, styles.topicField]}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={topic ? `Topic: ${topic}. Tap to rewrite it` : 'Add a topic'}
            onPress={() => setTopicDraft(topic)}
          >
            <Text style={[styles.topic, topic ? null : styles.topicEmpty]} numberOfLines={2}>
              {topic || 'Add a topic'}
            </Text>
          </Pressable>
        ))}
      {/* The list reaches GROUP_BLINK_ROOM past the menu's padding on each side, and pads its
          content back by as much, so a jumped-to group's outline has room to draw unclipped while
          every row stays where it was. */}
      <ScrollView ref={list} style={styles.rows} contentContainerStyle={styles.rowsContent} nestedScrollEnabled>
        {arr(board.groups).map((group) => {
          const id = str(group, 'id');
          const open = isTrue(group, 'open');
          const more = str(group, 'moreLabel');
          const isGroupHighlighted = highlightedGroup === id;
          return (
            <View
              key={id}
              onLayout={(event) => {
                groupTops.current[id] = event.nativeEvent.layout.y;
                scrollToFocus();
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${str(group, 'title')}, ${num(group, 'count') ?? 0}`}
                onPress={() => chat.dispatch({ type: 'toggleCoordinatorBoardGroup', group: id })}
                style={styles.groupLine}
              >
                <Glyph name={open ? 'chevron-down' : 'chevron-right'} size={12} color={P.cardMuted} />
                <GroupMarker group={id} />
                <Text style={styles.groupTitle}>{str(group, 'title')}</Text>
                {/* No number for a group holding only opened pages (gx-chat-core `coordinator_board`: shown, counted 0). */}
                <Text style={styles.groupCount}>{num(group, 'count') || ''}</Text>
              </Pressable>
              {arr(obj(group)?.rows).map((row, index) => {
                const command = obj(obj(row)?.command);
                const toggle = obj(obj(row)?.toggle);
                const openThread = obj(obj(row)?.openThread);
                const dock = obj(obj(row)?.dock);
                const key = str(row, 'key') || String(index);
                const restore = obj(obj(row)?.restore);
                const tags = arr(obj(row)?.tags);
                const answers = arr(obj(row)?.answers);
                // The dock's actions for it (gx-chat-core `panel_actions`): Reply among its answers,
                // Show in chat, Dismiss and Snooze at the top of its menu, which also holds the
                // board's own rows (Open, Copy reference, Reference in chat, Tags, Mark done, Drop).
                const actions = obj(obj(row)?.actions);
                const reply = obj(actions?.reply);
                const workRows = workMenuRows(actions, '', '');
                const menuRows = [...workRows, ...arr(obj(row)?.menu)];
                const isThreadWait = str(dock, 'kind') === 'threadWait' || isTrue(row, 'threadWait');
                const waitKind =
                  str(dock, 'waitKind') ||
                  str(row, 'waitKind') ||
                  (isTrue(dock, 'needsApproval') || isTrue(row, 'needsApproval') ? 'approval' : '');
                const threadWaitOpen = obj(dock?.open) ?? obj(obj(row)?.open) ?? obj(obj(row)?.go);
                const threadWaitPreview = str(dock, 'preview') || str(row, 'detail') || str(row, 'note');
                const threadWaitButton =
                  arr(dock?.buttons)
                    .map(obj)
                    .find(
                      (button): button is Record<string, unknown> =>
                        button !== null && str(button, 'label') !== 'Done',
                    ) ?? null;
                const threadWaitAction = obj(threadWaitButton?.command) ?? threadWaitOpen;
                const threadWaitLabel =
                  str(threadWaitButton, 'label') ||
                  str(dock, 'openLabel') ||
                  str(row, 'openLabel') ||
                  (waitKind === 'approval' || isTrue(dock, 'needsApproval') || isTrue(row, 'needsApproval')
                    ? 'Open approval'
                    : 'Open thread');
                const expanded = !isThreadWait && isTrue(row, 'expanded');
                const description = str(row, 'body');
                const answerRecords = answers
                  .map(obj)
                  .filter((answer): answer is Record<string, unknown> => answer !== null);
                // A thread waiting on a relayed approval shows that card's buttons in place of its
                // chips (desktop `board_relay_buttons`; the user's Q1297). Also match a thread-wait
                // dock row's target thread (`dock.open.sessionId`) and `row.sessionId`.
                const relayedSession =
                  str(openThread, 'sessionId') || str(obj(dock?.open), 'sessionId') || str(row, 'sessionId');
                const relayed = openRelayedCardForThread(document, relayedSession);
                const reference = str(row, 'reference');
                const note = str(row, 'note');
                // A tap opens the card in place (one at a time: gx-chat-core `toggle`); a thread-wait
                // Needs you row opens its thread directly (Q4477), and a question's card jumps to its
                // form instead.
                const tapCard =
                  isThreadWait && threadWaitOpen !== null
                    ? () => run(threadWaitOpen)
                    : toggle !== null
                      ? () => {
                          setMenuFor(null);
                          setChooseFor(null);
                          chat.dispatch(asJson(toggle) as unknown as UserAction);
                        }
                      : command !== null
                        ? () => run(command)
                        : undefined;
                // At most two chips fit beside the age; the rest are counted in "+N" (desktop
                // `fit_chips`), so a closed card keeps its two lines. An open card shows them all.
                const shownTags = expanded ? tags : tags.slice(0, 2);
                const hiddenTags = tags.length - shownTags.length;
                // An ask's item pills lead its opened answers; its line then keeps only what they don't say.
                const pills = arr(obj(row)?.itemPills)
                  .map(obj)
                  .filter((pill): pill is NonNullable<ReturnType<typeof obj>> => pill !== null);
                const line = pills.length > 0 ? str(row, 'openLine') : str(row, 'detail') || note;
                // Opened, the chip line takes its own taps (`TextArea`); closed, a tap on it opens the card.
                const ChipArea = expanded ? TextArea : View;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole={tapCard !== undefined ? 'button' : 'text'}
                    accessibilityLabel={str(row, 'title')}
                    accessibilityState={{ expanded }}
                    accessibilityHint={menuRows.length > 0 ? 'Long-press for its actions' : undefined}
                    onPress={tapCard}
                    onPressIn={() => setPressedKey(key)}
                    onPressOut={() => setPressedKey(null)}
                    onLongPress={
                      menuRows.length > 0
                        ? () => {
                            setMenuTags(false);
                            setMenuFor(menuFor === key ? null : key);
                          }
                        : undefined
                    }
                    onLayout={(event) => {
                      cardTops.current[key] = { group: id, y: event.nativeEvent.layout.y };
                      if (focus?.key === key) scrollToFocus();
                    }}
                    style={[
                      styles.card,
                      expanded && styles.cardOpen,
                      ringed === key ? { borderColor: P.accent, backgroundColor: `${P.accent}14` } : null,
                    ]}
                  >
                    <View
                      style={[
                        styles.cardTitleLine,
                        expanded && styles.cardTitleLineOpen,
                        expanded && pressedKey === key && { backgroundColor: P.ink(0.06) },
                      ]}
                    >
                      {isThreadWait ? (
                        <View style={styles.threadWaitMark}>
                          <ThreadWaitMark
                            waitKind={waitKind}
                            needsApproval={isTrue(dock, 'needsApproval') || isTrue(row, 'needsApproval')}
                          />
                        </View>
                      ) : null}
                      {expanded ? (
                        <LinkWords
                          text={str(row, 'title')}
                          runs={obj(row)?.titleRuns}
                          color={P.foreground}
                          style={styles.rowTitleOpen}
                        />
                      ) : isThreadWait ? (
                        <Text style={styles.rowTitle} numberOfLines={2}>
                          {str(row, 'title')}
                        </Text>
                      ) : cardCount(row) !== '' ? (
                        // A page or form says how much is answered at the line's right end, quietly
                        // (gx-chat-core `page_count`: "0/1", "2/7"; desktop `dock_row_look`).
                        <>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {str(row, 'title')}
                          </Text>
                          <Text style={[styles.rowCount, { color: P.cardMuted }]}>{cardCount(row)}</Text>
                        </>
                      ) : (
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {str(row, 'title')}
                        </Text>
                      )}
                      {!isThreadWait && openThread !== null ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open the thread ${str(row, 'title')}`}
                          hitSlop={6}
                          onPress={() => run(openThread)}
                          style={styles.agentButton}
                        >
                          <AgentMark icon={str(row, 'agentIcon') || null} size={14} />
                        </Pressable>
                      ) : null}
                      {restore !== null ? (
                        <Text
                          accessibilityRole="button"
                          accessibilityLabel="Restore to the board"
                          style={styles.restore}
                          onPress={() => chat.dispatch(asJson(restore) as unknown as UserAction)}
                        >
                          Restore
                        </Text>
                      ) : null}
                    </View>
                    {isThreadWait && relayed === null && threadWaitPreview.length > 0 ? (
                      <Text style={[styles.cardLine, styles.threadWaitIndent]} numberOfLines={2}>
                        {threadWaitPreview}
                      </Text>
                    ) : null}
                    {/* Folded card preview: first description line under the title when answers are
                        shown on the closed card (CDXC:Coordinators 2026-11-24, Layout C). */}
                    {!expanded && answers.length > 0 && str(obj(row)?.dock, 'preview').length > 0 ? (
                      <Text style={styles.cardLine} numberOfLines={1}>
                        {str(obj(row)?.dock, 'preview')}
                      </Text>
                    ) : null}
                    {/* A work ask's longer explanation under its short title, whole (desktop `ask_markdown`).
                        Opened, only the title line shuts the card: what is under it takes a tap
                        itself (`TextArea`), and a long press on the description offers Copy. */}
                    {expanded && (description.length > 0 || line.length > 0) ? (
                      <TextArea style={styles.cardText}>
                        {description.length > 0 ? (
                          <WorkDescription
                            text={description}
                            color={P.cardMuted}
                            title={str(row, 'title')}
                            dispatch={chat.dispatch as never}
                          />
                        ) : null}
                        {line.length > 0 ? <Text style={styles.cardLine}>{line}</Text> : null}
                      </TextArea>
                    ) : null}
                    {/* An opened ask draws its answers below, so its chip line would be empty. */}
                    {expanded && answers.length > 0 && relayed === null ? null : (
                      <ChipArea
                        style={[
                          styles.chipLine,
                          isThreadWait && styles.threadWaitIndent,
                          expanded && styles.chipLineOpen,
                        ]}
                      >
                        <View style={[styles.chips, expanded && styles.chipsOpen]}>
                          {relayed !== null ? (
                            <BoardRelayButtons card={relayed} dispatch={chat.dispatch} />
                          ) : isThreadWait ? (
                            threadWaitAction !== null ? (
                              <Pressable
                                accessibilityRole="button"
                                accessibilityLabel={threadWaitLabel}
                                hitSlop={6}
                                onPress={() => run(threadWaitAction)}
                                style={({ pressed }) => [
                                  styles.threadWaitButton,
                                  pressed && { backgroundColor: P.neutralFillPressed },
                                ]}
                              >
                                <Text style={styles.threadWaitButtonText} numberOfLines={1}>
                                  {threadWaitLabel}
                                </Text>
                              </Pressable>
                            ) : null
                          ) : answers.length > 0 && expanded ? null : answers.length > 0 &&
                            description.length > 0 &&
                            // A short description keeps the answers on the card (gx-chat-core
                            // `details_fields`); a computer too old to say so keeps Details.
                            (obj(obj(row)?.dock)?.details === undefined || isTrue(obj(obj(row)?.dock), 'details')) &&
                            toggle !== null ? (
                            // Layout C (CDXC:Coordinators 2026-11-24): keep answers visible on the
                            // closed card with a quiet "Details" button beside them to expand.
                            <View style={styles.flex}>
                              <WorkAnswerLine
                                answers={answerRecords}
                                reply={reply}
                                replied={str(row, 'replied')}
                                busy={false}
                                divider={false}
                                room={-80}
                                chooser="inline"
                                scope={scope}
                                dispatch={chat.dispatch as never}
                                iconOnly
                                details={() => {
                                  setMenuFor(null);
                                  chat.dispatch(asJson(toggle) as unknown as UserAction);
                                }}
                                context={obj(actions?.context)}
                                afterSheet={afterSheet}
                                before={(kind) => (kind === 'reply' ? onDone() : undefined)}
                              />
                            </View>
                          ) : answers.length > 0 ? (
                            <>
                              {/* A Work panel ask names the work it belongs to before its answers (gx-chat-core work_panel.rs). */}
                              <ClosedAnswers
                                lead={str(row, 'lead')}
                                answers={answerRecords}
                                reply={reply}
                                replied={str(row, 'replied')}
                                scope={scope}
                                dispatch={chat.dispatch}
                                // The sheet's and card's sides, the age, and the lead at its least.
                                room={screenWidth - 58 - (6 + 30 * fontScale)}
                                onChoose={() => {
                                  if (toggle === null) return;
                                  setMenuFor(null);
                                  setChooseFor(key);
                                  chat.dispatch(asJson(toggle) as unknown as UserAction);
                                }}
                                onReply={(target) => {
                                  onDone();
                                  const open = () => openWorkReply(target, owner, scope);
                                  if (afterSheet !== undefined) afterSheet(open);
                                  else open();
                                }}
                              />
                            </>
                          ) : tags.length === 0 && !expanded ? (
                            <Text style={note.length > 0 ? styles.note : styles.noLinks} numberOfLines={1}>
                              {note.length > 0 ? note : 'No links yet'}
                            </Text>
                          ) : null}
                          {(isThreadWait || answers.length > 0 || relayed !== null ? [] : shownTags).map(
                            (tag, tagIndex) => {
                              const tagKind = str(tag, 'kind');
                              if (tagKind === 'userTag') {
                                return <UserTagChip key={`userTag:${tagIndex}`} tag={tag} />;
                              }
                              const tint = toneColor(str(tag, 'tone'));
                              const open = obj(obj(tag)?.command);
                              const usageLimit = tagKind === 'usageLimit';
                              const coloured = tagKind === 'release' || tagKind === 'question' || usageLimit;
                              return (
                                <Pressable
                                  key={`${tagKind}:${tagIndex}`}
                                  accessibilityRole={open !== null ? 'link' : 'text'}
                                  accessibilityLabel={str(tag, 'title') || str(tag, 'label')}
                                  onPress={open !== null ? () => run(open) : undefined}
                                  style={[
                                    styles.tag,
                                    usageLimit && styles.usageLimitTag,
                                    coloured &&
                                      tint !== null && { borderColor: usageLimit ? `${tint}73` : tint },
                                  ]}
                                >
                                  {usageLimit ? (
                                    <Glyph name="clock" size={12} color={tint ?? P.cardMuted} />
                                  ) : !coloured ? (
                                    <View style={[styles.tagDot, { backgroundColor: tint ?? P.cardMuted }]} />
                                  ) : null}
                                  <Text
                                    style={[styles.tagText, coloured && tint !== null && { color: tint }]}
                                    numberOfLines={1}
                                    ellipsizeMode="tail"
                                  >
                                    {chipLabel(tagKind, str(tag, 'label'))}
                                  </Text>
                                </Pressable>
                              );
                            },
                          )}
                          {!isThreadWait && answers.length === 0 && relayed === null && hiddenTags > 0 ? (
                            <View style={styles.tag}>
                              <Text style={styles.tagText}>{`+${hiddenTags}`}</Text>
                            </View>
                          ) : null}
                        </View>
                        {expanded ? null : <Text style={styles.age}>{str(row, 'age')}</Text>}
                      </ChipArea>
                    )}
                    {relayed !== null ? (
                      <Text style={styles.note} numberOfLines={2}>
                        {[str(relayed, 'title'), str(relayed, 'codePreview') || str(relayed, 'code')]
                          .filter((part) => part.length > 0)
                          .join('\n')}
                      </Text>
                    ) : null}
                    {expanded ? (
                      <TextArea style={styles.cardOpenFoot}>
                        {/* Its answers with Reply after a divider, or Reply or Open alone, drawn by
                            the dock's own code (desktop `board_card_buttons`). */}
                        <WorkAnswerLine
                          answers={answerRecords}
                          reply={reply}
                          replied={str(row, 'replied')}
                          open={obj(actions?.open) ?? obj(obj(row)?.open)}
                          openLabel={str(row, 'openLabel') || 'Open'}
                          isPage={isTrue(obj(row), 'page') || isTrue(obj(obj(row)?.dock), 'page')}
                          busy={false}
                          divider
                          room={-80}
                          chooser="inline"
                          initialChoosing={chooseFor === key}
                          pills={pills}
                          scope={scope}
                          dispatch={dispatchFromLine as never}
                          afterSheet={afterSheet}
                          before={(kind) => (kind === 'reply' ? onDone() : undefined)}
                          context={obj(actions?.context)}
                        />
                        <View style={styles.cardButtons}>
                          {menuRows.length > 0 ? (
                            <WorkMenuButton
                              active={menuFor === key}
                              onPress={() => {
                                setMenuTags(false);
                                setMenuFor(menuFor === key ? null : key);
                              }}
                            />
                          ) : null}
                          <View style={styles.flex} />
                          <Text style={styles.age}>{str(row, 'age')}</Text>
                        </View>
                      </TextArea>
                    ) : null}
                    {menuFor === key ? (
                      <CardMenu
                        row={row}
                        workRows={workRows}
                        tagOptions={arr(board.tagOptions)}
                        tagsPage={menuTags}
                        onTags={setMenuTags}
                        onCopied={() => {
                          setMenuFor(null);
                          setMenuTags(false);
                        }}
                        onPick={(picked) => {
                          setMenuFor(null);
                          setMenuTags(false);
                          if (str(picked, 'type') === 'insertBoardReference') {
                            mention(str(picked, 'reference'));
                          } else if (
                            str(picked, 'type') === 'coordinatorBoardChange' ||
                            // Dismiss and Snooze settle the item here; the sheet stays open.
                            str(picked, 'type') === 'coordinatorBoardAnswer'
                          ) {
                            chat.dispatch(asJson(picked) as unknown as UserAction);
                          } else {
                            run(picked);
                          }
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })}
              {more.length > 0 ? (
                <Text
                  accessibilityRole="button"
                  style={styles.more}
                  onPress={() => chat.dispatch({ type: 'coordinatorBoardMore', group: id })}
                >
                  {more}
                </Text>
              ) : null}
              {isGroupHighlighted && focus !== null ? (
                <GroupBlinkOutline key={`blink:${focus.seq}`} light={P.light} />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  menu: {
    flexShrink: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  meta: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
  },
  topic: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
    paddingVertical: 4,
  },
  topicEmpty: {
    color: P.cardMuted,
  },
  topicField: {
    borderBottomWidth: 1,
    borderBottomColor: P.cardMuted,
  },
  rows: {
    flexShrink: 1,
    marginHorizontal: -GROUP_BLINK_ROOM,
  },
  rowsContent: {
    paddingHorizontal: GROUP_BLINK_ROOM,
  },
  groupLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
  },
  groupTitle: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
    fontWeight: '600',
  },
  groupCount: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE,
    fontVariant: ['tabular-nums'],
  },
  /** A line of work's card: two lines, always (desktop `board_card`). */
  card: {
    position: 'relative',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.08),
    backgroundColor: P.ink(0.035),
  },
  /** An opened card's description and line, one block under its title (the card's gap). */
  // 12 under the title (the card's 8 and these 4) and over the answers: `OPENED_ROW_GAP`.
  cardText: { gap: 8, marginTop: OPENED_ROW_GAP - 8 },
  /** The open card (gx-chat-core `expanded`): a step brighter, growing to its content. */
  cardOpen: {
    borderColor: P.ink(0.14),
    backgroundColor: P.ink(0.055),
  },
  /** The open card's latest line, whole. */
  cardLine: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
    lineHeight: Math.round((PROSE_SIZE - 1) * 1.4),
  },
  chipLineOpen: {
    height: undefined,
  },
  chipsOpen: {
    flexWrap: 'wrap',
    overflow: 'visible',
  },
  cardButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  cardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.ink(0.12),
  },
  cardButtonPressed: {
    backgroundColor: P.ink(0.08),
  },
  cardButtonText: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
  },
  flex: {
    flex: 1,
  },
  /** A held card's menu, in place under its content. */
  cardMenu: {
    marginTop: 2,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    backgroundColor: P.ink(0.04),
  },
  cardMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  cardMenuText: {
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  // Opened, the title line reaches a little past the text, rounded inside the card, for its
  // pressed state.
  cardTitleLineOpen: {
    marginHorizontal: -6,
    paddingHorizontal: 6,
    marginVertical: -2,
    paddingVertical: 2,
    borderRadius: 7,
  },
  cardTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowTitle: {
    flex: 1,
    color: P.foreground,
    fontSize: PROSE_SIZE,
  },
  rowCount: {
    flexShrink: 0,
    fontSize: PROSE_SIZE,
  },
  rowTitleOpen: {
    flex: 1,
    fontSize: PROSE_SIZE,
    lineHeight: Math.round(PROSE_SIZE * 1.45),
  },
  /** An open card's answers, then its ⋯ and age. */
  cardOpenFoot: {
    gap: 8,
    marginTop: OPENED_ROW_GAP - 8,
  },
  age: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
    fontVariant: ['tabular-nums'],
  },
  agentButton: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.ink(0.1),
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    // At least the chips' height: a given answer too long for the line wraps rather than is cut.
    minHeight: 24,
  },
  chips: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  /** The red × that floats over a long-pressed card's top-right corner (desktop `board_remove_badge`). */
  noLinks: {
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  /** The coordinator's own line for a card with no links: a step brighter than "No links yet". */
  note: {
    flexShrink: 1,
    color: P.prose,
    fontSize: PROSE_SIZE - 2,
  },
  /** An item's one-click answers, one segmented pill (desktop `board_answers`). */
  answersWhole: { flexShrink: 0 },
  // Choices and an unsent Reply hold their words' width: the work's name, then Reply, give way first.
  answerKept: { flexShrink: 0 },
  // A closed card's answers line: it fills the chips' row, so its width is the answers' room.
  closedLine: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Unseen and out of the flow: wide enough that every segment lays out at its whole width.
  measure: { position: 'absolute', left: 0, top: 0, width: 10000, opacity: 0, alignItems: 'flex-start' },
  measureItem: { flexDirection: 'row' },
  answers: {
    flexDirection: 'row',
    flexShrink: 1,
    maxWidth: '100%',
    minHeight: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.ink(0.14),
    overflow: 'hidden',
  },
  answer: {
    flexDirection: 'row',
    flexShrink: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  answerDivider: {
    borderLeftWidth: 1,
    borderLeftColor: P.ink(0.14),
  },
  answerPicked: {
    backgroundColor: P.ink(0.14),
  },
  answerFaded: {
    opacity: 0.4,
  },
  answerStrong: {
    color: P.foreground,
  },
  tag: {
    flexShrink: 1,
    maxWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.ink(0.12),
  },
  usageLimitTag: {
    maxWidth: 240,
  },
  threadWaitMark: {
    width: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  threadWaitIndent: {
    paddingLeft: 22,
  },
  threadWaitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 28,
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: P.neutralFill,
  },
  threadWaitButtonText: {
    color: P.foreground,
    fontSize: PROSE_SIZE - 1,
    fontWeight: '500',
  },
  tagDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  lead: { flexShrink: 1, minWidth: 40, fontSize: 12.5, color: P.cardMuted },
  tagText: {
    flexShrink: 1,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  restore: {
    paddingHorizontal: 5,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 2,
  },
  more: {
    paddingLeft: 12,
    paddingVertical: 4,
    color: P.cardMuted,
    fontSize: PROSE_SIZE - 1,
  },
}));
