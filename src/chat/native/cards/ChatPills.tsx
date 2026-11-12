/**
 * The pills on the working card (`WorkingCard.tsx`) and the sheet each one opens. Port of desktop
 * `chat_pills.rs`. Always leftmost, two icon pills: "Scroll to bottom" (a down arrow, while the
 * reader is away from the bottom, published by the transcript in `bottomStore.ts`), then "Previous
 * question" (a ?, while a question is unanswered and not For later, from the core's `openQuestions`). Then
 * Threads, Tasks, Subagents and Background, whose labels, counts and order come from the core
 * (`chatPills`, packages/gx-chat-core/src/extras/chat_pills.rs, where the user's decision lives). A
 * pill opens the chat's bottom sheet (`Sheet`, the phone form of desktop's floating menus) with that
 * panel's rows; a tap outside it or Back closes it.
 *
 * CDXC:SessionChat 2026-10-17 DECISION:
 * User picked the attention dot ping (Q236 G) and "Once on arrival, then every 30 s" (Q237) for the
 * "Previous question" pill: it keeps the Threads pill's neutral look plus its amber attention dot,
 * which sends out one ping (under a second) when a question arrives and every 30 s while any is
 * unanswered; a new question restarts the 30 s and the pings stop once nothing waits. With the
 * phone's reduce-motion setting on, the dot stays and never pings. Desktop: `question_ping.rs`, with
 * the timings of `questionPing` in packages/gx-chat-core/visual/scroll-bottom.json.
 *
 * CDXC:SessionChat 2026-10-24 DECISION:
 * User: "for questions if there's 2 or more questions i want to go between showing ? and showing the
 * number pls (every x seconds)". With two or more unanswered questions the ? pill shows the ? for 2 s,
 * then the count for 2 s (`countSwapMs`), as a plain cut like the desktop, whose GPUI fade would
 * redraw the whole chat every frame; with one it stays a ?. One interval, cleared when fewer than two
 * wait, and the slot keeps the wider of the two so the row never moves. Desktop: `chat_pills.rs`.
 *
 * CDXC:SessionChat 2026-10-27 SEE-ALSO:
 * The ? pill holds the chat's question list (the user's decision is on gx-chat-core
 * questions/open_questions.rs): it shows while the chat has any question form or page, keeps its dot,
 * ping and count only while one is unanswered, and a tap opens the list (`QuestionsMenu`) in the
 * pill sheet. Desktop: `questions_list.rs`, where hovering opens it.
 *
 * CDXC:SessionChat 2026-10-28 SEE-ALSO:
 * The list now opens from the Resources pill (`chatPills`, right after the ? pill, with its own stack
 * glyph) and the ? pill only steps through the questions (`previousQuestion`); the user's words are on
 * gx-chat-core questions/open_questions.rs. Rows say how long ago (`questionAge.ts`) and offer a For
 * later / Back to open button (`laterAction`).
 *
 * CDXC:SessionChat 2026-10-28 SEE-ALSO:
 * The ? pill shows only while a question is unanswered and not put off For later (`count`), and a tap
 * steps only through those; answered, withdrawn and For later ones are reached from the Resources
 * pill. The user's words are on gx-chat-core questions/open_questions.rs.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument, ChatPill, QuestionListRow, QuestionListSection } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { MenuRowView } from '../composer/MenuSheet';
import { Sheet } from '../composer/Sheet';
import { CollabShareMenu } from './CollabShareMenu';
import { answeredColor } from './askCard';
import { laterAction, removeAction, rowAge, statusLabel } from './questionAge';
import type { SessionLinksChatPill } from '../sessionLinks';
import { Glyph as TranscriptGlyph } from '../transcript/icons';
import { AgentFleetMenu, AgentTasksMenu, CoordinatorThreadsMenu } from './AgentPanels';
import { BLOCKED_PILL, CoordinatorBoardMenu, type BoardFocus } from './CoordinatorBoard';
import { CoordinatorIntroMenu, INTRO_PILL, coordinatorIntro } from './CoordinatorIntro';
import { SideChatsMenu } from './SideChats';
import { Glyph } from './icons';
import { obj } from './json';
import { BackgroundTasksMenu } from './WorkingStrip';
import { RelayedApprovalsMenu } from './RelayedApprovalCard';
import { approvalsWaitingLine } from './relayedApprovals';
import { SidebarPalette } from '../../../theme/palette';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { hiddenPageCount, hiddenPageDescription, hiddenPageWaiting, type HiddenPage } from './hiddenPages';

/** How often the open Chat Resources list redraws so its ages stay current (desktop `AGE_REFRESH`). */
const AGE_REFRESH_MS = 30_000;

/** A label pill's side padding (desktop `chat_pill`, 8px). */
const PILL_PADDING_X = 8;

/** An icon-only pill (Previous question, Scroll to bottom): the chip's shape around one glyph. */
export function IconPill({
  glyph,
  accessibilityLabel,
  color,
  onPress,
  count,
  children,
}: {
  glyph: 'question-mark' | 'arrow-down';
  accessibilityLabel: string;
  color: string;
  onPress: () => void;
  /** Shown instead of the glyph (the ? pill's count); both stay laid out, so the pill keeps the wider. */
  count?: { text: string; shown: boolean };
  children?: ReactNode;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, styles.iconPill, pressed && styles.pillPressed]}
    >
      {count === undefined ? (
        <Glyph name={glyph} size={16} color={color} />
      ) : (
        <View style={styles.glyphSlot}>
          <Text style={[styles.slotCount, { color, opacity: count.shown ? 1 : 0 }]}>{count.text}</Text>
          <View style={[styles.slotGlyph, { opacity: count.shown ? 0 : 1 }]}>
            <Glyph name={glyph} size={16} color={color} />
          </View>
        </View>
      )}
      {children}
    </Pressable>
  );
}

/**
 * "Previous question": its ? and, while questions wait, the pink dot and their count inside the pill,
 * as every pill flags (`InlineDots`; gx-chat-core `extras/chat_pills.rs` `pill_dots` has the user's
 * words). No corner dot, ping or count swap.
 */
export function QuestionPill({
  count,
  accessibilityLabel,
  onPress,
}: {
  count: number;
  newest?: string | null;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
    >
      <Glyph name="question-mark" size={16} color={P.cardMuted} />
      {count > 0 ? <InlineDots dots={[{ tone: 'question', count: String(count) }]} /> : null}
    </Pressable>
  );
}

/** A status dot's colour (gx-chat-core `PillDot::tone`): the sidebar's question pink, approval red (also Blocked), working amber. */
function pillDotColor(tone: string): string {
  if (tone === 'question') return SidebarPalette.ROW_QUESTION;
  if (tone === 'approval' || tone === 'blocked') return SidebarPalette.ROW_APPROVAL;
  return '#c68a06';
}

/** A pill's status inside it, after its label: each dot followed by its count (desktop `inline_dots`). */
function InlineDots({ dots }: { dots: readonly { tone: string; count: string }[] }) {
  const styles = useStyles();
  return (
    <View style={styles.inlineDots}>
      {dots.map((dot, index) => (
        <View key={`${dot.tone}:${index}`} style={styles.boardCount}>
          <View style={[styles.boardDot, { backgroundColor: pillDotColor(dot.tone) }]} />
          <Text style={styles.count}>{dot.count}</Text>
        </View>
      ))}
    </View>
  );
}

/** The groups that start folded: none (the list has two, Unanswered and Earlier; desktop `questions_list.rs`). */
const FOLDED_BY_DEFAULT: ReadonlySet<string> = new Set();

/**
 * The ? pill's list (Chat Resources): every question form, page and chart in the chat, under the
 * filter the header's dropdown picks, in the core's sections, each folding under its chevron, rows
 * newest first (Unanswered: oldest first, the order they were asked). A row scrolls the transcript to it and flashes it. Desktop: `questions_list.rs`.
 */
export function QuestionsMenu({
  chat,
  document,
  onDone,
  onOpenResource,
  filtersOpen,
  onFiltersClose,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
  onOpenResource: (action: UserAction) => void;
  /** The filter dropdown (`QuestionsFilterTrigger` in the sheet's header) is open. */
  filtersOpen: boolean;
  onFiltersClose: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  // The rows' ages are worded from the clock: redraw every 30 s while the list is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), AGE_REFRESH_MS);
    return () => clearInterval(tick);
  }, []);
  const sections = document.openQuestions?.sections ?? [];
  const filters = document.openQuestions?.filters ?? [];
  const picked = document.openQuestions?.filter ?? 'all';
  // The list pages (gx-chat-core `page_sections`): one page, a Show more row, and once it has been
  // tapped, scrolling to the end adds the next page by itself. Closing the list or picking another
  // filter starts again from one page (desktop `questions_list.rs`).
  const autoMore = useRef(false);
  const askedAt = useRef<number | null>(null);
  useEffect(() => {
    autoMore.current = false;
    askedAt.current = null;
  }, [picked]);
  useEffect(
    () => () => {
      chat.dispatch({ type: 'questionListReset' });
    },
    [],
  );
  const showMore = () => {
    autoMore.current = true;
    askedAt.current = null;
    chat.dispatch({ type: 'questionListMore' });
  };
  const folded = (id: string) => FOLDED_BY_DEFAULT.has(id) !== toggled.has(id);
  // The rows still to come in the groups that are open: what scrolling to the end loads.
  const remaining = sections
    .filter((section) => !folded(section.id))
    .reduce((sum, section) => sum + (section.remaining ?? 0), 0);
  const toggle = (id: string) =>
    setToggled((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  return (
    <View accessibilityLabel="Chat Resources" style={styles.questionsMenu}>
      <Text style={styles.questionsSummary}>{document.openQuestions?.summary ?? ''}</Text>
      <ScrollView
        nestedScrollEnabled
        scrollEventThrottle={64}
        onScroll={({ nativeEvent }) => {
          const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
          const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
          if (!autoMore.current || remaining === 0 || !atEnd || askedAt.current === remaining) return;
          askedAt.current = remaining;
          chat.dispatch({ type: 'questionListMore' });
        }}
      >
        {sections.length === 0 ? (
          <Text style={styles.questionsSummary}>Nothing of this kind in this chat yet.</Text>
        ) : null}
        {sections.map((section) => (
          <QuestionsSection
            key={section.id}
            section={section}
            folded={folded(section.id)}
            now={now}
            onShowMore={showMore}
            onToggle={() => toggle(section.id)}
            onLater={(action) => chat.dispatch(action)}
            onPick={(row) => {
              // A form or chart opens in the sheet and the chat stays where it is; a page opens as before.
              if (row.kind === 'form' || row.kind === 'chart') onOpenResource({ type: 'openResource', id: row.id });
              else {
                chat.dispatch({ type: 'jumpToQuestion', id: row.id });
                onDone();
              }
            }}
          />
        ))}
      </ScrollView>
      {filtersOpen ? (
        // The filter's pick list, under its trigger at the sheet header's right end.
        <View style={styles.filterMenu} accessibilityRole="menu">
          {filters.map((filter) => (
            <Pressable
              key={filter.id}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: filter.id === picked }}
              accessibilityLabel={`${filter.label} ${filter.count}`}
              onPress={() => {
                chat.dispatch({ type: 'questionListFilter', filter: filter.id });
                onFiltersClose();
              }}
              style={({ pressed }) => [styles.filterRow, pressed && styles.pillPressed]}
            >
              <View style={styles.filterCheck}>
                {filter.id === picked ? <Glyph name="check" size={13} color={P.foreground} /> : null}
              </View>
              <Text style={styles.filterLabel}>{filter.label}</Text>
              <Text style={styles.filterCount}>{String(filter.count)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The filter's small dropdown at the right of the sheet's header: the current pick and a chevron.
 *
 * CDXC:SessionChat 2026-10-27 SEE-ALSO:
 * The user's words (no row label pills, a small dropdown on the header's line instead of tabs) are on
 * desktop `questions_list.rs` `question_list_filter_trigger`.
 */
function QuestionsFilterTrigger({ document, onPress }: { document: ChatDocument; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const picked = document.openQuestions?.filter ?? 'all';
  const label = (document.openQuestions?.filters ?? []).find((filter) => filter.id === picked)?.label ?? 'All';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show: ${label}`}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.filterTrigger, pressed && styles.pillPressed]}
    >
      <Text style={styles.filterLabel}>{label}</Text>
      <Glyph name="chevron-down" size={12} color={P.cardMuted} />
    </Pressable>
  );
}

/** A row's icon by what it is: an HTML page, a chart or a Q&A form (desktop `kind_look`). */
function KindIcon({ kind, color }: { kind: QuestionListRow['kind']; color: string }) {
  if (kind === 'page') return <TranscriptGlyph name="file-type-html" size={13} color={color} />;
  if (kind === 'chart') return <TranscriptGlyph name="chart-bar" size={13} color={color} />;
  return <Glyph name="list-check" size={13} color={color} />;
}

function QuestionsSection({
  section,
  folded,
  now,
  onToggle,
  onShowMore,
  onLater,
  onPick,
}: {
  section: QuestionListSection;
  folded: boolean;
  now: number;
  onShowMore: () => void;
  onToggle: () => void;
  onLater: (
    action: { type: 'questionForLater'; id: string; later: boolean } | { type: 'questionRemove'; id: string },
  ) => void;
  onPick: (row: QuestionListRow) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View>
      {section.title.length > 0 ? (
        // "Earlier" has no header while nothing is unanswered (gx-chat-core blanks its title).
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${section.title} ${section.count}`}
          accessibilityState={{ expanded: !folded }}
          onPress={onToggle}
          style={styles.questionsSection}
        >
          <Glyph name={folded ? 'chevron-right' : 'chevron-down'} size={12} color={P.cardMuted} />
          <Text style={styles.questionsSectionLabel}>{section.title}</Text>
          <Text style={styles.questionsSectionLabel}>{String(section.count)}</Text>
        </Pressable>
      ) : null}
      {folded ? null : (
        <>
          {section.rows.map((row) => {
            const answered = row.status === 'answered';
            const withdrawn = row.status === 'withdrawn' || row.status === 'canceled';
            const age = rowAge(row, now);
            const label = statusLabel(row.status);
            // No hover on a phone, so the buttons always show. They sit before the label and age so
            // every row's age ends at the same right edge.
            const buttons = [
              laterAction(row.status, row.kind, row.id),
              removeAction(row.status, row.kind, row.id),
            ].filter((button) => button !== null);
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${row.title}`}
                onPress={() => onPick(row)}
                style={({ pressed }) => [styles.questionsRow, pressed && styles.pillPressed]}
              >
                <KindIcon
                  kind={row.kind}
                  color={answered ? answeredColor(P.light) : withdrawn ? P.ink(0.35) : P.cardMuted}
                />
                <Text numberOfLines={1} style={[styles.questionsTitle, withdrawn && { color: P.cardMuted }]}>
                  {row.title}
                </Text>
                {row.thread !== undefined && row.thread.length > 0 ? (
                  // A page a thread posted names the thread (a coordinator's Thread pages group).
                  <Text numberOfLines={1} style={styles.questionsMeta}>
                    {row.thread}
                  </Text>
                ) : null}
                {buttons.map((button) => (
                  // Its own press: it never also jumps to the question.
                  <Pressable
                    key={button.label}
                    accessibilityRole="button"
                    accessibilityLabel={button.label}
                    onPress={() => onLater(button.action)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.questionsLater, pressed && styles.pillPressed]}
                  >
                    <Glyph name={button.glyph} size={14} color={P.cardMuted} />
                  </Pressable>
                ))}
                {label !== null ? <Text style={styles.questionsMeta}>{label}</Text> : null}
                {age.length > 0 ? <Text style={styles.questionsMeta}>{age}</Text> : null}
              </Pressable>
            );
          })}
          {(section.remaining ?? 0) > 0 ? (
            // This group's own Show more, under its own rows; a folded group shows none.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Show all ${section.count}`}
              onPress={onShowMore}
              style={({ pressed }) => [styles.questionsMore, pressed && styles.pillPressed]}
            >
              <Text style={styles.questionsSectionLabel}>{`Show all ${section.count}`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  );
}

/** The glyph of a panel pill (desktop `chat_pills.rs` `pill_icon`). */
function pillGlyph(id: string) {
  return id === 'tasks'
    ? 'list-check'
    : id === 'background'
      ? 'terminal-2'
      : id === 'resources'
        ? 'stack'
        : id === 'stashed'
          ? 'stack-push'
          : id === 'sideChats'
            ? 'messages'
            : id === 'board'
              ? 'layout-board-split'
              : id === BLOCKED_PILL
                ? 'circle-minus-filled'
                : id === 'approvals'
                  ? 'shield-check'
                  : id === INTRO_PILL
                    ? 'bulb'
                    : id === 'autopilot'
                      ? 'plane'
                      : id === 'threads'
                        ? 'users-group'
                        : 'users';
}

/**
 * One panel pill in the Worked row's chip look (`TranscriptItemRow.tsx` `chip`): icon, label, count. A tap opens its sheet.
 * `collapsed` drops the label when the row has no room for it (`PillsStrip.tsx`): the glyph and the count or dots stay.
 */
export function Pill({
  pill,
  open,
  onPress,
  collapsed = false,
}: {
  pill: ChatPill;
  open: boolean;
  onPress: () => void;
  collapsed?: boolean;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const label = collapsed ? '' : pill.label;
  return (
    <Pressable
      accessibilityRole={pill.switch !== undefined ? 'switch' : 'button'}
      accessibilityLabel={pill.ariaLabel}
      accessibilityState={pill.switch !== undefined ? { checked: pill.switch } : { expanded: open }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        label.length === 0 && styles.pillNoLabel,
        (pressed || open) && styles.pillPressed,
      ]}
    >
      <Glyph name={pillGlyph(pill.id)} size={14} color={P.cardMuted} />
      {/* Blocked has no word, like the ? pill: its glyph and red dot (gx-chat-core `blocked_pill`). */}
      {label.length > 0 ? <Text style={styles.label}>{label}</Text> : null}
      {/* Autopilot on: a green dot after its label (desktop chat_pills.rs `AUTOPILOT_ON_COLOR`). */}
      {pill.switch === true ? <View style={styles.switchOnDot} /> : null}
      {(pill.dots ?? []).length > 0 && (collapsed || pill.id !== 'board') ? (
        <InlineDots dots={pill.dots ?? []} />
      ) : pill.count.length > 0 ? (
        <Text style={styles.count}>{pill.count}</Text>
      ) : null}
    </Pressable>
  );
}

/** The "+N" pill (desktop `strip_overflow.rs`): the pills the row has no room for wait in its sheet. */
export function OverflowPill({ count, open, onPress }: { count: number; open: boolean; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} more pills`}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [styles.pill, (pressed || open) && styles.pillPressed]}
    >
      <Glyph name="dots" size={14} color={P.cardMuted} />
      <Text style={styles.count}>{`+${count}`}</Text>
    </Pressable>
  );
}

/** One row of the "+N" sheet: the hidden pill's glyph, name and count or dots; a tap does what the pill would. */
export function OverflowPillRow({ pill, onPress }: { pill: ChatPill; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pill.ariaLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.overflowRow, pressed && styles.pillPressed]}
    >
      <Glyph name={pillGlyph(pill.id)} size={16} color={P.cardMuted} />
      <Text style={styles.overflowName} numberOfLines={1}>
        {pill.label.length > 0 ? pill.label : pill.ariaLabel}
      </Text>
      {pill.switch === true ? <View style={styles.switchOnDot} /> : null}
      {(pill.dots ?? []).length > 0 ? (
        <InlineDots dots={pill.dots ?? []} />
      ) : pill.count.length > 0 ? (
        <Text style={[styles.count, styles.overflowCount]}>{pill.count}</Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The Links pill, the strip's last: the sidebar badge's text and colours, much fainter (one link's ID
 * and "+N" for the others in the most pressing link's colour, its edge at 45% of it; muted and
 * dashed, "3 suggested", while the session only has suggestions). A tap opens the session's links sheet. Desktop: `links_pill.rs`;
 * the user's words are on gx-core `SessionLinks::chat_pill`.
 */
export function LinksPill({ pill, onPress }: { pill: SessionLinksChatPill; onPress: () => void }) {
  const styles = useStyles();
  // The badge's colour, muted to the project header's diff numbers (`linkBadgeColor`; desktop
  // link_chips.rs has the user's words), its edge at 45% of it.
  const color = pill.color;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pill.accessibilityLabel}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        styles.linksPill,
        { borderColor: withAlpha(pill.color.slice(0, 7), 0.45) },
        pill.suggested && styles.linksPillSuggested,
        pressed && styles.pillPressed,
      ]}
    >
      <TranscriptGlyph name="link" size={14} color={color} />
      <Text style={[styles.label, !pill.suggested && styles.linksId, { color }]}>
        {pill.more > 0 ? `${pill.label}+` : pill.label}
      </Text>
    </Pressable>
  );
}

/** How much of a hidden page's pill shows (`PillsStrip.tsx` plans it, desktop `minimized_pages.rs` `PageTier`). */
export type PagePillTier = 'full' | 'count' | 'icon';

/** The preset width a page pill never grows past: its icon, about fourteen characters of title and "16/16" (desktop `PAGE_PILL_WIDTH`). */
const PAGE_PILL_WIDTH = 172;

/**
 * A hidden page's pill (`hiddenPages.ts`, where the user's words are): the page's icon, its title cut
 * short and its answered count ("3/16", muted once all are answered) while the row has room; its icon
 * and count once the row drops labels; its icon and a pink dot while questions wait on the narrowest.
 * A tap brings the page back; a long press closes it for good. Desktop: `minimized_pages.rs`.
 */
export function PagePill({
  page,
  tier,
  onPress,
  onLongPress,
}: {
  page: HiddenPage;
  tier: PagePillTier;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const count = hiddenPageCount(page);
  const waiting = hiddenPageWaiting(page);
  const dot = <View style={[styles.pageDot, { backgroundColor: SidebarPalette.ROW_QUESTION }]} />;
  const trailing =
    tier === 'icon' ? (
      waiting ? (
        dot
      ) : null
    ) : count !== null ? (
      <Text style={[styles.count, !waiting && styles.overflowCount]}>{count}</Text>
    ) : page.questionsLeft ? (
      dot
    ) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${hiddenPageDescription(page)}`}
      accessibilityHint="Long press to close the page"
      accessibilityActions={[{ name: 'longpress', label: 'Close page' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'longpress') onLongPress();
      }}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        tier !== 'full' && styles.pillNoLabel,
        { maxWidth: PAGE_PILL_WIDTH },
        pressed && styles.pillPressed,
      ]}
    >
      <Glyph name="file-type-html" size={14} color={P.cardMuted} />
      {tier === 'full' ? (
        <Text style={styles.pageTitle} numberOfLines={1}>
          {page.title.trim().length > 0 ? page.title.trim() : 'Ghostex page'}
        </Text>
      ) : null}
      {trailing}
    </Pressable>
  );
}

/** A hidden page's row in the "+N" sheet: its icon, title and count, or the dot while it waits uncounted. */
export function PageOverflowRow({ page, onPress }: { page: HiddenPage; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const count = hiddenPageCount(page);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${hiddenPageDescription(page)}`}
      onPress={onPress}
      style={({ pressed }) => [styles.overflowRow, pressed && styles.pillPressed]}
    >
      <Glyph name="file-type-html" size={16} color={P.cardMuted} />
      <Text style={styles.overflowName} numberOfLines={1}>
        {page.title.trim().length > 0 ? page.title.trim() : 'Ghostex page'}
      </Text>
      {count !== null ? (
        <Text style={[styles.count, styles.overflowCount]}>{count}</Text>
      ) : page.questionsLeft ? (
        <View style={[styles.pageDot, { backgroundColor: SidebarPalette.ROW_QUESTION }]} />
      ) : null}
    </Pressable>
  );
}

/** `#rrggbb` at `alpha`, as `#rrggbbaa`; any other colour as it is. */
function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return `${color}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')}`;
}

/** The sheet a pill opens: that panel's rows, titled by the pill. `open` is the pill's id, or null. */
export function PillMenuSheet({
  chat,
  document,
  open,
  onClose,
  onHost,
  boardFocus = null,
}: {
  chat: RustChat;
  document: ChatDocument;
  open: string | null;
  onClose: () => void;
  /** Runs a host action of the chat screen (Autopilot's "Autopilot settings…" row asks for `autopilotSettings`). */
  onHost?: (action: string) => void;
  /** The card a board pill in the chat asked to see, which the Board sheet scrolls to. */
  boardFocus?: BoardFocus | null;
}) {
  const questions = open === 'resources' && (document.openQuestions?.total ?? 0) > 0;
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!questions) setFiltersOpen(false);
  }, [questions]);
  // The coordinator tips' "Don't show again", which applies when their sheet closes.
  const [introDontShow, setIntroDontShow] = useState(false);
  const shown = questions
    ? ({ id: 'resources', label: 'Chat Resources' } as ChatPill)
    : (document.chatPills ?? []).find((pill) => pill.id === open);
  // A panel that went away (the subagents finished) takes its sheet with it.
  useEffect(() => {
    if (open !== null && open !== 'board' && shown === undefined) onClose();
  }, [open, shown, onClose]);
  const close = () => {
    // The Threads list goes back to its first step, as folding the panel did (desktop `pill_menu_closed`).
    if (open === 'threads') chat.dispatch({ type: 'toggleCoordinatorThreadsMore', step: 0 });
    // The done tasks come back in their short form the next time the sheet opens.
    if (open === 'tasks') chat.dispatch({ type: 'toggleAgentTasksCompleted', step: 0 });
    if (open === INTRO_PILL && introDontShow) chat.dispatch({ type: 'hideCoordinatorIntro' });
    setIntroDontShow(false);
    onClose();
  };
  /** A modal picked in this sheet opens only after its presenter has gone on iOS. */
  const openAfterDismiss = useRef<UserAction | null>(null);
  const openModal = (action: UserAction) => {
    // The transcript viewer is a modal of its own (`SubagentViewer`). iOS cannot present it while this
    // sheet's modal is still up or sliding away, and drops it without a word, as it did the composer's
    // photo picker (`NativeComposer.tsx`). Android's modal is a dialog.
    if (Platform.OS === 'ios') openAfterDismiss.current = action;
    else chat.dispatch(action);
    close();
  };
  /** Autopilot's settings row navigates away; on iOS that waits for this sheet's modal to go too. */
  const hostAfterDismiss = useRef<string | null>(null);
  const onDismissed = () => {
    const action = openAfterDismiss.current;
    openAfterDismiss.current = null;
    if (action !== null) chat.dispatch(action);
    const host = hostAfterDismiss.current;
    hostAfterDismiss.current = null;
    if (host !== null) onHost?.(host);
  };
  /** An Autopilot row: the toggle runs in the core, the settings row on the chat screen. */
  const runAutopilotRow = (command: { [key: string]: unknown }) => {
    if (command.type === 'openAutopilotSettings') {
      if (Platform.OS === 'ios') hostAfterDismiss.current = 'autopilotSettings';
      else onHost?.('autopilotSettings');
    } else chat.dispatch(command as UserAction);
    close();
  };
  const background = obj(document.backgroundTasksPanel);
  return (
    <Sheet
      // The Work panel also opens from the dock's status line, which stands in for its pill
      // (`WorkCards.tsx` `WorkDock`).
      visible={shown !== undefined || open === 'board'}
      onClose={close}
      onDismissed={onDismissed}
      title={
        open === INTRO_PILL
          ? (coordinatorIntro(document)?.title ?? shown?.label ?? '')
          : open === 'autopilot'
            ? 'Autopilot'
            : (shown?.label ?? (open === 'board' ? 'Work' : ''))
      }
      subtitle={open === 'approvals' && shown !== undefined ? approvalsWaitingLine(document) : undefined}
      accessory={
        questions ? (
          <QuestionsFilterTrigger document={document} onPress={() => setFiltersOpen((was) => !was)} />
        ) : undefined
      }
    >
      {open === 'threads' ? (
        <CoordinatorThreadsMenu chat={chat} document={document} onDone={close} />
      ) : open === 'board' ? (
        <CoordinatorBoardMenu chat={chat} document={document} onDone={close} focus={boardFocus} />
      ) : open === INTRO_PILL ? (
        <CoordinatorIntroMenu
          chat={chat}
          document={document}
          dontShowAgain={introDontShow}
          onDontShowAgain={setIntroDontShow}
          onDone={close}
        />
      ) : open === 'approvals' ? (
        <RelayedApprovalsMenu chat={chat} document={document} />
      ) : open === 'collab' ? (
        <CollabShareMenu chat={chat} document={document} onDone={close} />
      ) : open === 'autopilot' ? (
        <View>
          {(shown?.menu ?? []).map((row, index) => (
            <MenuRowView
              key={`${index}:${typeof row.label === 'string' ? row.label : 'row'}`}
              row={row}
              onRun={runAutopilotRow}
              onOpen={() => undefined}
            />
          ))}
        </View>
      ) : open === 'sideChats' ? (
        <SideChatsMenu chat={chat} document={document} onDone={close} />
      ) : open === 'tasks' ? (
        <AgentTasksMenu chat={chat} document={document} />
      ) : open === 'subagents' ? (
        <AgentFleetMenu document={document} onOpen={openModal} />
      ) : open === 'background' && background !== null ? (
        <BackgroundTasksMenu tasks={background} />
      ) : questions ? (
        <QuestionsMenu
          chat={chat}
          document={document}
          onDone={close}
          onOpenResource={openModal}
          filtersOpen={filtersOpen}
          onFiltersClose={() => setFiltersOpen(false)}
        />
      ) : null}
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  switchOnDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#22c55e' },
  /** A hidden page's pink dot while its questions wait (`PagePill`). */
  pageDot: { width: 7, height: 7, borderRadius: 3.5 },
  /** A hidden page's title in its pill, cut short with an ellipsis (`PagePill`). */
  pageTitle: { flexShrink: 1, minWidth: 0, color: P.foreground, fontSize: 13, lineHeight: 19 },
  /** One of the Board pill's coloured counts: its group's dot and number. */
  boardCount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  boardDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: PILL_PADDING_X,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: P.ink(0.1),
  },
  /**
   * Square-ish around its glyph, the label pills' height: their 19pt line plus 2pt above and below,
   * so the 16pt glyph takes 3.5pt. The ? pill is neutral like Threads (user, 2026-10-15: "same height as
   * the threads and scroll to bottom pills (and same color)", desktop `chat_pills.rs`).
   */
  iconPill: {
    paddingHorizontal: 6,
    paddingVertical: 3.5,
  },
  pillPressed: {
    backgroundColor: P.ink(0.08),
  },
  /** A pill with its label dropped: a pixel less each side, as the desktop's. */
  pillNoLabel: {
    paddingHorizontal: PILL_PADDING_X - 1,
  },
  overflowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  overflowName: {
    flex: 1,
    minWidth: 0,
    color: P.foreground,
    fontSize: 15,
  },
  linksPill: {
    gap: 4,
  },
  linksPillSuggested: {
    borderStyle: 'dashed',
  },
  linksId: {
    fontWeight: '500',
  },
  label: {
    color: P.cardMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  count: {
    color: P.foreground,
    fontSize: 13,
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  },
  /** A "+N" sheet row's count, muted beside the pill's name (desktop `strip_overflow.rs`). */
  overflowCount: {
    color: P.cardMuted,
  },
  /** A pill's status dots, after its label (`InlineDots`). */
  inlineDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  /** The ? pill's glyph and count share this slot; the count sets its width once wider than the glyph. */
  glyphSlot: {
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCount: {
    minWidth: 16,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  slotGlyph: {
    position: 'absolute',
  },
  /**
   * The sheet's body: 12 in from both edges, plus each line's own 4, puts the summary, the section
   * titles and the rows' trailing age and button 16 in, where the sheet's title row sits
   * (`Sheet.tsx` `titleRow`); the 4 left inside a row keeps its pressed fill off the text.
   *
   * CDXC:SessionChat 2026-10-28 DECISION:
   * User, of the phone's Chat Resources sheet: "0 unanswered is touching the edge. There's no padding there", and "From the right side, there is no padding, and things are touching": the sheet's lines get the same inset on both sides as its title.
   */
  questionsMenu: { gap: 4, maxHeight: 520, paddingHorizontal: 12 },
  questionsSummary: { color: P.cardMuted, fontSize: 13, paddingHorizontal: 4, paddingBottom: 4 },
  /** A section header in the Links card's look: chevron, title and count (desktop `question_section_header`). */
  questionsSection: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 4 },
  questionsSectionLabel: { color: P.cardMuted, fontSize: 13 },
  questionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingLeft: 22,
    paddingRight: 4,
    borderRadius: 6,
  },
  questionsLater: {
    flexShrink: 0,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  questionsMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: 6,
  },
  questionsTitle: { flex: 1, minWidth: 0, color: P.foreground, fontSize: 14 },
  filterTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  /**
   * The pick list, floating under the header's trigger with its right edge on the trigger's, so it
   * opens leftwards inside the sheet: the sheet's title row is inset 16 (`Sheet.tsx` `titleRow`),
   * this list's container is not (desktop `open_select_list_right_aligned`).
   */
  filterMenu: {
    position: 'absolute',
    top: 0,
    right: 16,
    minWidth: 160,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.ink(0.12),
    backgroundColor: P.composerBackground,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 10 },
  filterCheck: { width: 14, alignItems: 'center' },
  filterLabel: { color: P.foreground, fontSize: 13 },
  filterCount: { marginLeft: 'auto', color: P.cardMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  questionsMeta: { flexShrink: 0, maxWidth: 110, color: P.muted, fontSize: 13, fontVariant: ['tabular-nums'] },
}));
