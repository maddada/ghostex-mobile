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
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { ChatDocument, ChatPill, QuestionListRow, QuestionListSection } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Sheet } from '../composer/Sheet';
import { answeredColor } from './askCard';
import { laterAction, rowAge } from './questionAge';
import type { SessionLinksChatPill } from '../sessionLinks';
import { Glyph as TranscriptGlyph } from '../transcript/icons';
import { AgentFleetMenu, AgentTasksMenu, CoordinatorThreadsMenu, waitingColor } from './AgentPanels';
import { Glyph } from './icons';
import { obj } from './json';
import { BackgroundTasksMenu } from './WorkingStrip';
import { OverlappedDots } from '../../../components/sessions/StatusDotStack';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

/** How often the open Chat Resources list redraws so its ages stay current (desktop `AGE_REFRESH`). */
const AGE_REFRESH_MS = 30_000;

/** The amber of the ? pill's corner dot and a running pill's. */
const ATTENTION_COLOR = '#f5a524';

/** The running corner dot's fade: the Subagents menu's 1.6 s beat (desktop `chat_pills.rs` `running_dot`). */
const RUNNING_PULSE_MS = 1600;

/** `questionPing` in packages/gx-chat-core/visual/scroll-bottom.json (desktop `question_ping.rs`). */
const QUESTION_PING = { durationMs: 800, everyMs: 30000, dotSize: 6, scale: 2.8, alpha: 0.8, countSwapMs: 2000 };
/** The corner dot's offsets inside a pill's edge (the ? pill's and a running pill's, desktop `corner_dot`). */
const DOT_TOP = 1;
const DOT_RIGHT = 2;
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
        <Glyph name={glyph} size={14} color={color} />
      ) : (
        <View style={styles.glyphSlot}>
          <Text style={[styles.slotCount, { color, opacity: count.shown ? 1 : 0 }]}>{count.text}</Text>
          <View style={[styles.slotGlyph, { opacity: count.shown ? 0 : 1 }]}>
            <Glyph name={glyph} size={14} color={color} />
          </View>
        </View>
      )}
      {children}
    </Pressable>
  );
}

/** "Previous question" with its amber dot, which pings now and then while questions wait. */
export function QuestionPill({
  count,
  newest,
  accessibilityLabel,
  onPress,
}: {
  count: number;
  newest: string | null;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const ping = useQuestionPing(count, newest);
  const showingCount = useCountSwap(count);
  // Only unanswered questions get the attention look; answered and For later ones keep the pill
  // so the list stays reachable.
  return (
    <IconPill
      glyph="question-mark"
      accessibilityLabel={accessibilityLabel}
      color={P.cardMuted}
      onPress={onPress}
      count={{ text: String(count), shown: showingCount }}
    >
      {count > 0 ? <PingRing progress={ping} /> : null}
      {count > 0 ? <View pointerEvents="none" style={styles.cornerDot} /> : null}
    </IconPill>
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
  filtersOpen,
  onFiltersClose,
}: {
  chat: RustChat;
  document: ChatDocument;
  onDone: () => void;
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
  const remaining = document.openQuestions?.remaining ?? 0;
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
            onToggle={() => toggle(section.id)}
            onLater={(action) => chat.dispatch(action)}
            onPick={(row) => {
              chat.dispatch({ type: 'jumpToQuestion', id: row.id });
              onDone();
            }}
          />
        ))}
        {remaining > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Show more, ${remaining} left`}
            onPress={showMore}
            style={({ pressed }) => [styles.questionsMore, pressed && styles.pillPressed]}
          >
            <Text style={styles.questionsSectionLabel}>Show more</Text>
            <Text style={styles.questionsMeta}>{String(remaining)}</Text>
          </Pressable>
        ) : null}
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
  onLater,
  onPick,
}: {
  section: QuestionListSection;
  folded: boolean;
  now: number;
  onToggle: () => void;
  onLater: (action: { type: 'questionForLater'; id: string; later: boolean }) => void;
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
      {folded
        ? null
        : section.rows.map((row) => {
            const answered = row.status === 'answered';
            const withdrawn = row.status === 'withdrawn';
            const age = rowAge(row, now);
            const later = laterAction(row.status, row.kind, row.id);
            return (
              <Pressable
                key={row.id}
                accessibilityRole="button"
                accessibilityLabel={`Go to ${row.title}`}
                onPress={() => onPick(row)}
                style={({ pressed }) => [styles.questionsRow, pressed && styles.pillPressed]}
              >
                <KindIcon kind={row.kind} color={answered ? answeredColor(P.light) : withdrawn ? P.ink(0.35) : P.cardMuted} />
                <Text
                  numberOfLines={1}
                  style={[
                    styles.questionsTitle,
                    withdrawn && { color: P.cardMuted },
                  ]}
                >
                  {row.title}
                </Text>
                {row.status === 'later' ? <Text style={styles.questionsMeta}>For later</Text> : null}
                {age.length > 0 ? <Text style={styles.questionsMeta}>{age}</Text> : null}
                {later !== null ? (
                  // Its own press: it never also jumps to the question.
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={later.label}
                    onPress={() => onLater(later.action)}
                    hitSlop={6}
                    style={({ pressed }) => [styles.questionsLater, pressed && styles.pillPressed]}
                  >
                    <Glyph name={later.glyph} size={14} color={P.cardMuted} />
                  </Pressable>
                ) : null}
              </Pressable>
            );
          })}
    </View>
  );
}

/** True while the ? pill shows its count: every other `countSwapMs` while two or more questions wait. */
function useCountSwap(count: number): boolean {
  const [shown, setShown] = useState(false);
  const swapping = count >= 2;
  useEffect(() => {
    if (!swapping) return undefined;
    const swap = setInterval(() => setShown((was) => !was), QUESTION_PING.countSwapMs);
    return () => {
      clearInterval(swap);
      setShown(false);
    };
  }, [swapping]);
  return shown;
}

/**
 * The question pill's ping: 0 at rest, running to 1 once on arrival and every 30 s while questions
 * wait. A new question (the newest id changing without the count dropping) restarts the beat; the
 * beats stop when nothing waits; with reduce motion on it never runs, so only the dot shows.
 */
function useQuestionPing(count: number, newest: string | null): Animated.Value {
  const reduceMotion = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const seen = useRef<{ count: number; newest: string | null }>({ count: 0, newest: null });
  const [arrival, setArrival] = useState(0);
  useEffect(() => {
    const before = seen.current;
    seen.current = { count, newest };
    if (newest !== null && newest !== before.newest && count >= before.count) setArrival((n) => n + 1);
  }, [count, newest]);
  const waiting = count > 0;
  useEffect(() => {
    if (!waiting || reduceMotion || arrival === 0) return undefined;
    const play = () => {
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: QUESTION_PING.durationMs,
        easing: Easing.linear,
        useNativeDriver: true,
      }).start(() => progress.setValue(0));
    };
    play();
    const beat = setInterval(play, QUESTION_PING.everyMs);
    return () => {
      clearInterval(beat);
      progress.stopAnimation();
      progress.setValue(0);
    };
  }, [arrival, waiting, reduceMotion, progress]);
  return progress;
}

/** The ring spreading out of the ? pill's dot; it takes no touches. */
function PingRing({ progress }: { progress: Animated.Value }) {
  const { dotSize, scale, alpha } = QUESTION_PING;
  const size = dotSize * scale;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: DOT_TOP + dotSize / 2 - size / 2,
        right: DOT_RIGHT + dotSize / 2 - size / 2,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: ATTENTION_COLOR,
        opacity: progress.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, alpha, 0] }),
        transform: [
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [1 / scale, 1],
              easing: Easing.out(Easing.cubic),
            }),
          },
        ],
      }}
    />
  );
}

/** One panel pill in the Worked row's chip look (`TranscriptItemRow.tsx` `chip`): icon, label, count. A tap opens its sheet. */
export function Pill({ pill, open, onPress }: { pill: ChatPill; open: boolean; onPress: () => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pill.ariaLabel}
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.pill,
        // Two overlapping corner dots reach half a dot further in than one: room for them, not over the count.
        pill.running &&
          waitingColor(pill.waiting) !== null && { paddingRight: PILL_PADDING_X + QUESTION_PING.dotSize / 2 },
        (pressed || open) && styles.pillPressed,
      ]}
    >
      <CornerIndicator pill={pill} />
      <Glyph
        name={
          pill.id === 'tasks'
            ? 'list-check'
            : pill.id === 'background'
              ? 'terminal-2'
              : pill.id === 'resources'
                ? 'stack'
                : 'users'
        }
        size={12}
        color={P.cardMuted}
      />
      <Text style={styles.label}>{pill.label}</Text>
      {pill.count.length > 0 ? <Text style={styles.count}>{pill.count}</Text> : null}
    </Pressable>
  );
}

/**
 * The Links pill, the strip's last: the sidebar badge's text and colours, much fainter (one link's ID
 * and "+N" for the others in the most pressing link's colour at 60%, its edge at 18%; muted and
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
        { borderColor: withAlpha(pill.color.slice(0, 7), pill.suggested ? 0.45 : 0.32) },
        pill.suggested && styles.linksPillSuggested,
        pressed && styles.pillPressed,
      ]}
    >
      <TranscriptGlyph name="link" size={12} color={color} />
      <Text style={[styles.label, !pill.suggested && styles.linksId, { color }]}>
        {pill.more > 0 ? `${pill.label}+` : pill.label}
      </Text>
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

/**
 * A pill's corner (CDXC:SessionChat 2026-10-27 in gx-chat-core extras/chat_pills.rs, desktop
 * `corner_indicator`): the pulsing amber dot while something runs, the sidebar's red or pink dot
 * while something waits on the user, and both overlapping with the sidebar's 1px ring
 * (`OverlappedDots`) when both hold, the waiting one in front.
 */
function CornerIndicator({ pill }: { pill: ChatPill }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const waiting = waitingColor(pill.waiting);
  if (pill.running && waiting !== null) {
    return (
      <View pointerEvents="none" style={styles.cornerStack}>
        <OverlappedDots
          colors={[ATTENTION_COLOR, waiting]}
          size={QUESTION_PING.dotSize}
          ringColor={P.composerBackground}
          unit={(value) => value}
        />
      </View>
    );
  }
  if (pill.running) return <RunningDot />;
  if (waiting !== null) return <View pointerEvents="none" style={[styles.cornerDot, { backgroundColor: waiting }]} />;
  return null;
}

/**
 * A running pill's corner dot (`running`, gx-chat-core `extras/chat_pills.rs`, where the user's
 * decision lives): the ? pill's own dot (`cornerDot`), fading to 35% and back every 1.6 s, and still
 * with the phone's reduce-motion setting on.
 */
function RunningDot() {
  const styles = useStyles();
  const reduceMotion = useReducedMotion();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduceMotion) return undefined;
    const half = { duration: RUNNING_PULSE_MS / 2, easing: Easing.linear, useNativeDriver: true };
    const beat = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { ...half, toValue: 0.35 }),
        Animated.timing(opacity, { ...half, toValue: 1 }),
      ]),
    );
    beat.start();
    return () => {
      beat.stop();
      opacity.setValue(1);
    };
  }, [reduceMotion, opacity]);
  return <Animated.View pointerEvents="none" style={[styles.cornerDot, { opacity }]} />;
}

/** The sheet a pill opens: that panel's rows, titled by the pill. `open` is the pill's id, or null. */
export function PillMenuSheet({
  chat,
  document,
  open,
  onClose,
}: {
  chat: RustChat;
  document: ChatDocument;
  open: string | null;
  onClose: () => void;
}) {
  const questions = open === 'resources' && (document.openQuestions?.total ?? 0) > 0;
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => {
    if (!questions) setFiltersOpen(false);
  }, [questions]);
  const shown = questions
    ? ({ id: 'resources', label: 'Chat Resources' } as ChatPill)
    : (document.chatPills ?? []).find((pill) => pill.id === open);
  // A panel that went away (the subagents finished) takes its sheet with it.
  useEffect(() => {
    if (open !== null && shown === undefined) onClose();
  }, [open, shown, onClose]);
  const close = () => {
    // The Threads list goes back to its first step, as folding the panel did (desktop `pill_menu_closed`).
    if (open === 'threads') chat.dispatch({ type: 'toggleCoordinatorThreadsMore', step: 0 });
    // The done tasks come back in their short form the next time the sheet opens.
    if (open === 'tasks') chat.dispatch({ type: 'toggleAgentTasksCompleted', step: 0 });
    onClose();
  };
  const background = obj(document.backgroundTasksPanel);
  return (
    <Sheet
      visible={shown !== undefined}
      onClose={close}
      title={shown?.label ?? ''}
      accessory={
        questions ? (
          <QuestionsFilterTrigger document={document} onPress={() => setFiltersOpen((was) => !was)} />
        ) : undefined
      }
    >
      {open === 'threads' ? (
        <CoordinatorThreadsMenu chat={chat} document={document} onDone={close} />
      ) : open === 'tasks' ? (
        <AgentTasksMenu chat={chat} document={document} />
      ) : open === 'subagents' ? (
        <AgentFleetMenu chat={chat} document={document} onDone={close} />
      ) : open === 'background' && background !== null ? (
        <BackgroundTasksMenu tasks={background} />
      ) : questions ? (
        <QuestionsMenu
          chat={chat}
          document={document}
          onDone={close}
          filtersOpen={filtersOpen}
          onFiltersClose={() => setFiltersOpen(false)}
        />
      ) : null}
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
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
   * Square-ish around its glyph, the label pills' height: their 16pt line plus 2pt above and below,
   * so the 14pt glyph takes 3pt. The ? pill is neutral like Threads (user, 2026-10-15: "same height as
   * the threads and scroll to bottom pills (and same color)", desktop `chat_pills.rs`).
   */
  iconPill: {
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  pillPressed: {
    backgroundColor: P.ink(0.08),
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
    fontSize: 11.5,
    lineHeight: 16,
  },
  count: {
    color: P.foreground,
    fontSize: 11.5,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  /** The ? pill's and a running pill's amber dot, inside the pill's edge in the top right corner. */
  cornerDot: {
    position: 'absolute',
    top: DOT_TOP,
    right: DOT_RIGHT,
    width: QUESTION_PING.dotSize,
    height: QUESTION_PING.dotSize,
    borderRadius: QUESTION_PING.dotSize / 2,
    backgroundColor: ATTENTION_COLOR,
  },
  /** The ? pill's glyph and count share this slot; the count sets its width once wider than the glyph. */
  glyphSlot: {
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotCount: {
    minWidth: 14,
    textAlign: 'center',
    fontSize: 11.5,
    lineHeight: 14,
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
  questionsSummary: { color: P.cardMuted, fontSize: 12.5, paddingHorizontal: 4, paddingBottom: 4 },
  /** A section header in the Links card's look: chevron, title and count (desktop `question_section_header`). */
  questionsSection: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 4 },
  questionsSectionLabel: { color: P.cardMuted, fontSize: 12.5 },
  questionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 40,
    paddingLeft: 22,
    paddingRight: 4,
    borderRadius: 6,
  },
  questionsLater: { flexShrink: 0, width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  questionsMore: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 6 },
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
  filterCount: { marginLeft: 'auto', color: P.cardMuted, fontSize: 12, fontVariant: ['tabular-nums'] },
  questionsMeta: { flexShrink: 0, maxWidth: 110, color: P.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  /** The running and waiting dots overlapping: one ring further out, so the front dot sits where a lone dot does. */
  cornerStack: {
    position: 'absolute',
    top: DOT_TOP - 1,
    right: DOT_RIGHT - 1,
  },
}));
