/**
 * SESSION row renderer, cloned from the desktop gpui reference sidebar
 * (packages/core-ui/styles/session-cards.css reference-layout skin +
 * session-card-content.tsx): 34dp flat row, absolutely-placed leading agent
 * icon at 70% opacity, 48% on a sleeping row (13dp brand masks, 15dp terminal/browser glyphs) that an
 * active Delayed Send (yellow clock) or Close After Done (pastel-red clock)
 * timer replaces at full opacity, 15.5dp weight-300 title (#b4b8c0), and ONE
 * shared trailing slot flush at the row's right edge. A tagged session paints
 * its tag glyph in that leading slot instead of the agent icon, at full opacity
 * in the tag's color (desktop .session-tag-agent-icon, which owns the slot at
 * rest and only yields to the agent identity on pointer hover — a state the
 * phone has no equivalent for). The status slot after the title follows the
 * desktop row (sessionStatus.ts holds the rules). The open session is a raised
 * card: a 12% white fill, a hairline and a faint top highlight (rows.tsx
 * `SelectedCardOutline`, desktop decorations.rs `session_outline`).
 *
 * CDXC:Sessions 2026-09-24 DECISION: "don't show multiple sessions as selected
 * in the list, just show last active one as highlighted", so warm terminal
 * surfaces no longer get their own fill; only the selected session is
 * highlighted. "Don't show sleeping vs not sleeping effect, make all look the
 * same, just make the last active time bit dimmed for sleeping ones": a
 * sleeping row keeps the normal title and shows no sleep dot, only its Last
 * Active time is dimmer.
 * CDXC:SessionSleep 2026-10-27 DECISION: The user approved the phone Sessions screen drawn like the desktop sidebar (design A, docs/2026-10-21/phone-sessions-screen/sessions-like-sidebar.html), whose note says the phone follows the computer's Advanced > Dim sleeping sessions. With that setting off (the default) the 2026-09-24 rule above holds; with it on, a sleeping row fades to 50% as on the desktop (`dim_sleeping` in apps/desktop/src/app/native_sidebar/sessions.rs). The summary carries the setting (`dimSleepingSessions`).
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import type { CoordinatorBadge, FoldedStatus, RowNesting } from '../../contract/coordinatorTree';
import {
  agentIconTint,
  resolveAgentArtId,
  type GhostexCustomSessionTags,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { resolveSessionTag } from '../../contract/sessionTags';
import { SessionCopy } from '../../copy';
import { useSettingsStore } from '../../settings/store';
import { mixHexColors, SidebarPalette } from '../../theme/palette';
import type { MenuAnchor } from './ContextMenu';
import {
  ds,
  PassingThreadLines,
  SELECTED_TEXT,
  SelectedCardOutline,
  selectedFill,
  SIDEBAR_MUTED,
  STATUS_DOT_SIZE,
  TOUCH_ROW_HEIGHT,
} from './rows';
import StatusDotStack from './StatusDotStack';
import {
  BoxGlyph,
  ChevronRightGlyph,
  ClockGlyph,
  CloudGlyph,
  CoordinatorGlyph,
  CrewGlyph,
  PencilGlyph,
  HeadsetGlyph,
  ServerGlyph,
} from './icons';
import WorkChips, {
  ChipGlyph,
  WORK_SESSION_ROW_HEIGHT,
  type WorkChipActions,
} from './WorkChips';
import { workChips, type WorkChip } from './workChipModel';
import {
  linkBadgeColor,
  sessionLinkChecksMark,
  sessionLinkLook,
  sessionLinkSummary,
  sessionLinksRow,
  type SessionLinksDisplay,
} from '../../chat/native/sessionLinks';
import {
  COMPLETION_FLASH_MS,
  COMPLETION_FLASH_OPACITY,
  COMPLETION_FLASH_PROGRESS,
  hasPendingQuestion,
  isAwaitingApproval,
  nextLabelDeadline,
  rowActivityIndicator,
  rowClockKind,
  rowTimeLabel,
  shouldStartCompletionFlash,
} from './sessionStatus';

/** session_list.rs SESSION_SPACING: the gap under every row. */
const ROW_SPACING = ds(1);
/** How much lower the first line's middle sits than on a desktop-height row (the decorations are placed from it). */
const LINE_SHIFT = (TOUCH_ROW_HEIGHT - ds(34)) / 2;
/** Indent per tree level (threads.rs THREAD_INDENT): one icon plus the row gap. */
const THREAD_INDENT = 16;
/** The fold chevron and its gaps push a coordinator's title right (sessions.rs: icon, chevron, title). */
const CHEVRON_EXTRA = 17;

/**
 * Re-renders the row when the time it draws next reads differently
 * (nextLabelDeadline): every second while a countdown runs, and only when the
 * relative time's digit changes otherwise. Returns the clock the labels read.
 */
function useRowLabelClock(session: GhostexSession): number {
  const [, wake] = useReducer((tick: number) => tick + 1, 0);
  const nowMs = Date.now();
  const deadline = nextLabelDeadline(session, nowMs);
  useEffect(() => {
    if (deadline === null) return undefined;
    const timeout = setTimeout(wake, Math.max(0, Math.min(deadline - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timeout);
  }, [deadline]);
  return nowMs;
}

/**
 * The completion flash (sessionStatus.ts shouldStartCompletionFlash): the
 * row's opacity dips three times over three seconds, driven natively. Resting
 * progress is 1, which reads as full opacity.
 */
function useCompletionFlash(session: GhostexSession): Animated.AnimatedInterpolation<number> {
  const progress = useRef(new Animated.Value(1)).current;
  const opacity = useMemo(
    () =>
      progress.interpolate({
        inputRange: COMPLETION_FLASH_PROGRESS,
        outputRange: COMPLETION_FLASH_OPACITY,
      }),
    [progress],
  );
  const previousActivity = useRef<string | null>(null);
  const soundEnabled = useSettingsStore((state) => state.hydrated && state.settings.doneNotificationSound);
  useEffect(() => {
    const previous = previousActivity.current;
    previousActivity.current = session.activity;
    if (!shouldStartCompletionFlash(previous, session, soundEnabled)) return;
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: COMPLETION_FLASH_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
    // Only an activity or attention-event change can start a flash; the sound setting is read as it stands then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.activity, session.attentionEventId, session.attentionEnteredAt]);
  return opacity;
}

/** The title shake's sideways offsets (dp before scaling), one step each RENAME_SHAKE_STEP_MS. */
const RENAME_SHAKE_OFFSETS = [5, -5, 4, -4, 2, -2, 0];
const RENAME_SHAKE_STEP_MS = 60;

/**
 * CDXC:SessionTitles 2026-10-12 DECISION: User: "if you don't get confirmation then show the name
 * shake". The title shakes once sideways, like a rejected password field, when gxserver publishes
 * a new `renameFailedAt` for a row this list is already showing (the 8 seconds ran out and the
 * name the agent reports came back). A row that first appears with an old failure stays still.
 * SEE-ALSO: `title_with_rename_shake` in apps/desktop/src/app/native_sidebar/sessions.rs.
 */
function useRenameShake(session: GhostexSession): Animated.Value {
  const offset = useRef(new Animated.Value(0)).current;
  const previousFailedAt = useRef<string | null>(null);
  useEffect(() => {
    const before = previousFailedAt.current;
    previousFailedAt.current = session.renameFailedAt;
    if (before === null || session.renameFailedAt.length === 0 || session.renameFailedAt === before) {
      return;
    }
    offset.setValue(0);
    Animated.sequence(
      RENAME_SHAKE_OFFSETS.map((toValue) =>
        Animated.timing(offset, {
          toValue: ds(toValue),
          duration: RENAME_SHAKE_STEP_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ).start();
  }, [offset, session.renameFailedAt]);
  return offset;
}

/**
 * apps/desktop/src/app/native_sidebar/status.rs `activity_indicator`: one dot
 * centered in a 19x16 slot.
 */
function ActivityDot({ kind }: { kind: 'approval' | 'failed' | 'working' | 'attention' | 'backgroundWork' }) {
  return (
    <View style={styles.indicatorSlot}>
      <View
        style={
          kind === 'approval'
            ? styles.approvalDot
            : kind === 'failed'
            ? styles.failedDot
            : kind === 'working'
              ? styles.workingDot
              : kind === 'attention'
                ? styles.attentionDot
                : styles.backgroundWorkDot
        }
      />
    </View>
  );
}

/**
 * threads.rs `thread_tree_lines`: from under the parent's icon in the row above,
 * down to this row's icon (the last thread) or on through the row (a thread with
 * siblings below it), then across to the icon; and the lines of the outer levels
 * that run on past it.
 */
function ThreadConnector({
  iconLeft,
  depth,
  last,
  passingLines,
  rowHeight,
}: {
  iconLeft: number;
  depth: number;
  last: boolean;
  passingLines: number;
  rowHeight: number;
}) {
  const mid = TOUCH_ROW_HEIGHT / 2;
  // From under the icon of the row above: the rest of that row below its icon, and the gap between.
  const rise = mid - ds(7.5) + ROW_SPACING;
  const left = iconLeft - ds(THREAD_INDENT) + ds(7);
  // Past the depth limit a row is drawn at its parent's level, so a line passing it at that level
  // is its own line, drawn on through the row.
  const ownLevel = 1 << depth;
  const through = !last || (passingLines & ownLevel) !== 0;
  return (
    <>
      <View
        pointerEvents="none"
        style={[styles.threadLine, { left, top: -rise, height: through ? rise + rowHeight : rise + mid }]}
      >
        <View style={[styles.threadLineAcross, { top: rise + mid - 0.5, width: ds(THREAD_INDENT - 6) }]} />
      </View>
      <PassingThreadLines
        lines={passingLines & ~ownLevel}
        levelLeft={(level) => left - ds(depth * THREAD_INDENT) + ds(level * THREAD_INDENT)}
        height={rowHeight + ROW_SPACING}
      />
    </>
  );
}

/**
 * threads.rs `coordinator_badge`: the crew icon and one number (sessions waiting for approval, else
 * threads waiting, else working), tinted to match: red for approval, light blue for waiting, orange
 * for working. An idle coordinator draws no badge (CDXC:Coordinators 2026-10-29 in threads.rs).
 */
function CoordinatorBadgeView({ badge }: { badge: CoordinatorBadge }) {
  const tint =
    badge.tone === 'approval'
      ? SidebarPalette.ROW_APPROVAL
      : badge.tone === 'waiting'
      ? SidebarPalette.ROW_ATTENTION
      : badge.tone === 'working'
        ? SidebarPalette.ROW_WORKING
        : SidebarPalette.MUTED;
  return (
    <View style={styles.coordinatorBadge}>
      <CrewGlyph size={ds(13.55)} color={tint} />
      {badge.count > 0 ? <Text style={[styles.coordinatorBadgeCount, { color: tint }]}>{badge.count}</Text> : null}
    </View>
  );
}

/**
 * native_sidebar/agentbox.rs `agentbox_badge`: where a box session's agent runs, the provider's glyph
 * (a box for local Docker, a server for a remote Docker host, else a cloud) and its label.
 */
function AgentboxBadge({ agentbox }: { agentbox: NonNullable<GhostexSession['agentbox']> }) {
  const label = agentbox.providerLabel.trim().length > 0 ? agentbox.providerLabel : agentbox.provider;
  const Glyph =
    agentbox.provider === 'docker' ? BoxGlyph : agentbox.provider.startsWith('docker:') ? ServerGlyph : CloudGlyph;
  return (
    <View accessible accessibilityLabel={`Runs in agentbox ${agentbox.boxName} (${label})`} style={styles.agentbox}>
      <Glyph size={ds(12)} color={SIDEBAR_MUTED} />
      <Text style={styles.agentboxLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/**
 * apps/desktop/src/app/voice_agent/sidebar_badge.rs: a small green headset on the row of the session
 * a voice call is about, while the call connects or runs (the phone's own call, src/voice/).
 */
function VoiceCallBadge() {
  return (
    <View accessible accessibilityLabel="Voice call about this session">
      <HeadsetGlyph size={ds(12)} color="#4ADE80" />
    </View>
  );
}

/**
 * apps/desktop/src/app/native_sidebar/status.rs `question_indicator`: the pink
 * question dot in the same 19x16 slot as every other indicator. CDXC:SessionStatus 2026-10-23 DECISION:
 * User: "also 1 more thing if there's question + working or question + done then show those 2 dots overlapping like we show it at the bottom of the space button". While the session is also working (orange) or done (blue), the pair overlaps through StatusDotStack, the same stack the Space buttons draw, with the pink dot behind and a ring in the row's surface between them; the pair is centered in the slot.
 */
function QuestionIndicator({ activity, ringColor }: { activity: string; ringColor: string }) {
  const pair = activity === 'working' || activity === 'attention';
  return (
    <View style={styles.indicatorSlot}>
      {pair ? (
        <StatusDotStack
          questionCount={1}
          workingCount={activity === 'working' ? 1 : 0}
          attentionCount={activity === 'attention' ? 1 : 0}
          backgroundWorkCount={0}
          ringColor={ringColor}
        />
      ) : (
        <View style={styles.questionDot} />
      )}
    </View>
  );
}

/**
 * A folded coordinator's stack (coordinatorTree.ts `foldedStatus`): the dots of the threads its fold
 * hides plus its own, overlapping as the machine tabs draw them, in the same 19x16 slot.
 * CDXC:Coordinators 2026-10-24 SEE-ALSO: the user's decision on gx-core `RowNesting::folded_status`; the desktop draws it in apps/desktop/src/app/native_sidebar/threads.rs `folded_status_indicator`.
 */
function FoldedStatusIndicator({ status, ringColor }: { status: FoldedStatus; ringColor: string }) {
  return (
    <View style={[styles.indicatorSlot, styles.foldedSlot]}>
      <StatusDotStack
        questionCount={status.question ? 1 : 0}
        workingCount={status.working ? 1 : 0}
        attentionCount={status.attention ? 1 : 0}
        backgroundWorkCount={status.backgroundWork ? 1 : 0}
        approvalCount={status.approval ? 1 : 0}
        ringColor={ringColor}
      />
    </View>
  );
}

export type SessionRowProps = {
  session: GhostexSession;
  /** Warm-attached session key matches the current terminal. */
  active: boolean;
  /** Exact expanded-group surface behind this row, including collection tint. */
  expandedGroupSurface: string;
  /** Current tint/contrast-resolved sidebar backing. */
  sidebarBackground: string;
  /** Current tint/contrast-resolved sidebar foreground. */
  sidebarForeground: string;
  /** True for rows inside a project card (tighter insets than Quick rows). */
  inCard: boolean;
  /** The owning machine's custom tag catalog, so a `custom-` sessionTag resolves to its icon and color. */
  customSessionTags?: GhostexCustomSessionTags;
  onPress: () => void;
  /** Context menu, opened by long-pressing the row (anchored to the row). */
  onMenu: (anchor: MenuAnchor) => void;
  /** The row's place in its coordinator's tree (coordinatorTree.ts); absent on a top-level row. */
  nesting?: RowNesting;
  /** On a coordinator row: the crew badge. */
  coordinatorBadge?: CoordinatorBadge;
  /** Folds or unfolds a coordinator's threads; the chevron shows while threads are drawn under it. */
  onToggleThreads?: () => void;
  /** What a card's chips do (its links line and a Work mode card's Clean up / Keep offer). */
  workActions?: WorkChipActions;
  /** The computer's "Session links in the sidebar" setting (sessionLinks.ts). */
  sessionLinksDisplay?: SessionLinksDisplay;
  /** The computer's Advanced > Dim sleeping sessions. */
  dimSleeping?: boolean;
  /** A voice call on the phone is about this session. */
  voiceCall?: boolean;
};

/**
 * CDXC:SessionStatus 2026-09-25 DECISION:
 * User: "Please make the indicators for sessions status in the RN session list match gpui one exactly". The row draws what the desktop sidebar row draws (apps/desktop/src/app/native_sidebar/sessions.rs, status.rs, icons.rs) in the same order and sizes: a static 8dp orange dot while working, a 7dp blue dot in attention, an 8dp grey dot for a background shell or monitor on an otherwise idle row, each centered in a 19x16 slot; a pending question replaces the dot and the time with a 6dp pink dot (after the orange one while working); then the timer countdown, or the relative time on a row with no dot, in #a6a6a6 (#686868 while sleeping); an 18dp yellow or pastel-red clock in the leading slot for Delayed Send and Close After Done; and the three-dip completion flash when a session enters attention with the completion sound on. Lifecycle (sleeping, stopped, error) draws no dot, as on the desktop. This supersedes the phone's spinning working ring and its red error and blue done dots. The 2026-10-20 decision in rows.tsx (`STATUS_DOT_SIZE`) supersedes the mixed sizes: every dot is 8dp.
 * The rules live in sessionStatus.ts; the fields they read reach the phone through `to_mobile_session_summary` in server/src/ghostex_cli/sessions.rs.
 */
export default function SessionRow({
  session,
  active,
  expandedGroupSurface,
  sidebarForeground,
  inCard,
  customSessionTags,
  onPress,
  onMenu,
  nesting,
  coordinatorBadge,
  onToggleThreads,
  workActions,
  sessionLinksDisplay = 'badge',
  dimSleeping = false,
  voiceCall = false,
}: SessionRowProps) {
  const rowRef = useRef<ViewInstance | null>(null);
  const iconId = resolveAgentArtId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  const iconSize = iconId === 'terminal' || iconId === 'browser' ? ds(15) : ds(13);
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const nowMs = useRowLabelClock(session);
  const flashOpacity = useCompletionFlash(session);
  const renameShake = useRenameShake(session);
  // The red approval dot wins over every other status (sessionStatus.ts `isAwaitingApproval`).
  const approval = isAwaitingApproval(session);
  const foldedStatus =
    approval || (session.programStatusFailed && session.activity === 'attention') ? undefined : nesting?.foldedStatus;
  const question = hasPendingQuestion(session) && foldedStatus === undefined && !approval;
  const indicator = question || foldedStatus !== undefined ? null : rowActivityIndicator(session);
  const timeLabel = foldedStatus !== undefined ? null : rowTimeLabel(session, nowMs);
  /*
   * Desktop leading-slot order (icons.rs render_session_icon): an armed Delayed
   * Send clock, then a Close After Done clock, then the session tag, then the
   * draft pencil, then the agent icon.
   */
  const tag = resolveSessionTag(session, customSessionTags);
  const TagIcon = tag?.Icon;
  const tagColor = tag === undefined ? null : tag.color;
  const clockKind = rowClockKind(session);
  const timerClockColor =
    clockKind === 'delayedSend'
      ? SidebarPalette.ROW_DELAYED_SEND_CLOCK
      : clockKind === 'closeAfterDone'
        ? SidebarPalette.ROW_CLOSE_AFTER_DONE_CLOCK
        : null;
  const draftPencil =
    timerClockColor === null &&
    !(TagIcon !== undefined && tagColor !== null) &&
    session.isDraft === true &&
    iconId !== 'browser';
  const depth = nesting?.depth ?? 0;
  const indent = ds(depth * THREAD_INDENT);
  const iconLeft = (inCard ? ds(5) : ds(26)) + indent;
  const showChevron = onToggleThreads !== undefined && (nesting?.threadCount ?? 0) > 0;
  const titleIndent = indent + (showChevron ? ds(CHEVRON_EXTRA) : 0);
  const activeBackground = selectedFill(expandedGroupSurface);
  // The desktop's hover fill (appearance.rs `session_hover`) is the phone's pressed state.
  const pressedBackground = mixHexColors('#FFFFFF', expandedGroupSurface, 6);
  /*
   * CDXC:SessionLinks 2026-10-24 SEE-ALSO: `SessionLinks::row` in packages/gx-core/src/sidebar_view/links.rs. A row draws its links as the computer's "Session links in the sidebar" says (a line, a badge or nothing); a Work mode card's own chip line is gone except for the merged-PR Clean up / Keep offer, which takes the line while it waits.
   */
  const offerCleanup = session.work?.offerCleanup === true;
  const linksRow = useMemo(
    () => sessionLinksRow(session.links, sessionLinksDisplay, session.isFocused),
    [session.links, sessionLinksDisplay, session.isFocused],
  );
  const chips = useMemo((): WorkChip[] => {
    if (offerCleanup) {
      return workChips(session.work)
        .filter((chip) => chip.key === 'pr' || chip.key === 'cleanup' || chip.key === 'keep')
        .map((chip) => (chip.key === 'pr' ? { ...chip, trailing: undefined } : chip));
    }
    return linksRow.line.map((link) => {
      const look = sessionLinkLook(link);
      const checks = sessionLinkChecksMark(link);
      return {
        key: link.key,
        glyph: look.glyph,
        // The badge's muted colours (`linkBadgeColor`; desktop link_chips.rs has the user's words).
        glyphColor: linkBadgeColor(look.color),
        label: link.label,
        trailing: checks !== null ? { ...checks, color: linkBadgeColor(checks.color) } : undefined,
        url: link.url,
        description: sessionLinkSummary(link),
      };
    });
  }, [offerCleanup, session.work, linksRow]);
  // The line fits what it can to its width (WorkChips); the links it never lists count into "+N".
  // Under Badge there is no line: the title row's badge names a link and counts the rest.
  const linksNeverShown = offerCleanup
    ? null
    : linksRow.badge !== null && !linksRow.badge.suggested
      ? 0
      : (session.links?.items.length ?? 0) - linksRow.line.length;
  const showChips = chips.length > 0 && workActions !== undefined;
  /*
   * CDXC:SessionLinks 2026-10-27 DECISION:
   * User: "i see the links tag is shown on 2nd row, this is wrong it should always be on same row as
   * header please (so all are singly row in sidebar)". The quiet suggestions badge sits on the title
   * row like the linked badge, so a row without chips stays one line high (the desktop's
   * `render_native_session_links_badge`). Supersedes the 2026-10-24 line under the name.
   */
  const showLinkLine = showChips;
  const linksBadge = offerCleanup ? null : linksRow.badge;
  // An idle coordinator draws no crew badge (threads.rs `coordinator_badge`).
  const shownCoordinatorBadge = coordinatorBadge?.tone === 'idle' ? undefined : coordinatorBadge;
  const rowHeight = TOUCH_ROW_HEIGHT + (showLinkLine ? ds(WORK_SESSION_ROW_HEIGHT - 34) : 0);
  const linePaddingLeft = (inCard ? ds(26) : ds(47)) + titleIndent;

  const openMenuFromRow = (): void => {
    const node = rowRef.current;
    if (node === null) return;
    node.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };

  return (
    <Animated.View style={[styles.rowGap, { opacity: flashOpacity }, dimSleeping && session.isSleeping ? styles.dimmed : null]}>
      <Pressable
        ref={rowRef}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.rowBox,
          { height: rowHeight },
          active ? { backgroundColor: activeBackground } : null,
          !active && pressed ? { backgroundColor: pressedBackground } : null,
        ]}
        onPress={onPress}
        onLongPress={openMenuFromRow}
      >
        {active ? <SelectedCardOutline /> : null}
        {depth > 0 ? (
          <ThreadConnector
            iconLeft={iconLeft}
            depth={depth}
            last={nesting?.lastChild === true}
            passingLines={nesting?.passingLines ?? 0}
            rowHeight={rowHeight}
          />
        ) : null}
        {/* Line 1: the row as it always was. A work card adds its chip line under it. */}
        <View style={[styles.row, { paddingLeft: linePaddingLeft }]}>
          {/* A Claude cloud row's only cloud is its leading orange logo (CDXC:ClaudeCloud 2026-10-29 in the desktop's native_sidebar/claude_cloud.rs), so this slot says where it runs. */}
          <View
            accessible={session.claudeCloud !== undefined}
            accessibilityLabel={session.claudeCloud !== undefined ? SessionCopy.claudeCloud : undefined}
            style={[
              styles.icon,
              { left: iconLeft },
              timerClockColor !== null || tagColor !== null
                ? styles.iconTimer
                : active && !draftPencil
                  ? styles.iconActive
                  : session.isSleeping || draftPencil
                    ? null
                    : styles.iconAwake,
            ]}
          >
            {/* The clock is 18dp inside the 15dp slot, overhanging it evenly, as on the desktop. */}
            {timerClockColor !== null ? (
              <ClockGlyph size={ds(18)} color={timerClockColor} />
            ) : TagIcon !== undefined && tagColor !== null ? (
              <TagIcon size={ds(15)} color={tagColor} strokeWidth={1.9} />
            ) : draftPencil ? (
              <PencilGlyph size={ds(15)} color={sidebarForeground} />
            ) : session.isCoordinator && nesting?.containsActive === true ? (
              <View style={styles.containsActiveRing} />
            ) : session.isCoordinator ? (
              <CoordinatorGlyph size={ds(13)} color={SidebarPalette.ROW_COORDINATOR_CROWN} />
            ) : (
              <Icon size={iconSize} color={agentIconTint(iconId)} />
            )}
          </View>
          {showChevron ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={nesting?.collapsed === true ? 'Show threads' : 'Hide threads'}
              hitSlop={ds(10)}
              onPress={onToggleThreads}
              style={[styles.threadChevron, { left: iconLeft + ds(18) }]}
            >
              <ChevronRightGlyph size={ds(14)} color={SidebarPalette.MUTED} rotated={nesting?.collapsed !== true} />
            </Pressable>
          ) : null}
          {/*
            The row's decorations, placed as the desktop row places them
            (apps/desktop/src/app/native_sidebar/decorations.rs), measured from the
            leading icon, which sits 5dp in from the desktop card's edge. Each is a
            SIBLING of the absolutely-placed icon, never a wrapper around it, so it
            keeps its own full opacity (the icon slot sits at 48%) and cannot move
            the row. Painted in the desktop's order: note, draft, queue.

            The note dot: 4dp, white, at the row's left edge, level with the icon.
          */}
          {session.sessionNote.length > 0 ? (
            <View pointerEvents="none" style={[styles.noteDot, { left: iconLeft - ds(5) }]} />
          ) : null}
          {/*
            The unsent-draft dot: 6dp #b9d8fa at the icon's top right, raised and
            pushed right past the queue badge when one is shown.
          */}
          {session.hasComposerDraft === true ? (
            <View
              pointerEvents="none"
              style={[
                styles.composerDraftDot,
                session.queuedPromptCount > 0
                  ? { left: iconLeft + ds(14), top: ds(4.5) + LINE_SHIFT }
                  : { left: iconLeft + ds(10), top: ds(8.5) + LINE_SHIFT },
              ]}
            />
          ) : null}
          {/*
            Prompts waiting in this session's Ghostex queue (plan 016 §6): a 10dp
            badge over the icon's top right, capped at 99+. Hidden at zero.
          */}
          {session.queuedPromptCount > 0 ? (
            <View
              pointerEvents="none"
              style={[
                styles.queueBadge,
                session.queuedPromptFailedCount > 0 ? styles.queueBadgeFailed : null,
                { left: iconLeft + ds(8) },
              ]}
            >
              <Text style={styles.queueBadgeCount} numberOfLines={1}>
                {session.queuedPromptCount > 99 ? '99+' : String(session.queuedPromptCount)}
              </Text>
            </View>
          ) : null}
          <Animated.Text
            style={[styles.title, active ? styles.titleActive : null, { transform: [{ translateX: renameShake }] }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {title}
          </Animated.Text>
          {/* sessions.rs: the status dot, then the time, each 6dp after the one before; or the question indicator alone. */}
          {question ||
          foldedStatus !== undefined ||
          indicator !== null ||
          timeLabel !== null ||
          shownCoordinatorBadge !== undefined ||
          linksBadge !== null ||
          voiceCall ||
          session.agentbox !== undefined ? (
            <View style={styles.trailing}>
              {/* sessions.rs: the links badge, the crew badge, the voice headset and the box, then the status (CDXC:Sidebar 2026-10-29: the user swapped the links badge before the crew badge). */}
              {linksBadge !== null ? (
                <View
                  accessible
                  accessibilityLabel={
                    linksBadge.suggested
                      ? `${linksBadge.count} suggested links`
                      : linksBadge.more > 0
                        ? `Links: ${linksBadge.label} and ${linksBadge.more} more`
                        : `Link: ${linksBadge.label}`
                  }
                  style={
                    linksBadge.suggested
                      ? [styles.linksBadgeSuggested, { borderColor: linksBadge.color }]
                      : styles.linksBadge
                  }
                >
                  {/* CDXC:SessionLinks 2026-10-29: a linked badge is bare text like the crew count beside it; suggestions keep the icon and dashed pill (desktop link_chips.rs has the user's words). */}
                  {linksBadge.suggested ? <ChipGlyph glyph="link" color={linksBadge.color} size={ds(10)} /> : null}
                  <Text
                    style={[
                      linksBadge.suggested ? styles.linksBadgeSuggestedText : styles.linksBadgeText,
                      { color: linksBadge.color },
                    ]}
                  >
                    {/* "#270+" with more links (desktop link_chips.rs has the user's words). */}
                    {linksBadge.more > 0 ? `${linksBadge.label}+` : linksBadge.label}
                  </Text>
                </View>
              ) : null}
              {shownCoordinatorBadge !== undefined ? <CoordinatorBadgeView badge={shownCoordinatorBadge} /> : null}
              {voiceCall ? <VoiceCallBadge /> : null}
              {session.agentbox !== undefined ? <AgentboxBadge agentbox={session.agentbox} /> : null}
              {question ? (
                <QuestionIndicator
                  activity={session.activity}
                  ringColor={active ? activeBackground : expandedGroupSurface}
                />
              ) : null}
              {foldedStatus !== undefined ? (
                <FoldedStatusIndicator
                  status={foldedStatus}
                  ringColor={active ? activeBackground : expandedGroupSurface}
                />
              ) : null}
              {indicator !== null ? <ActivityDot kind={indicator} /> : null}
              {timeLabel !== null ? (
                <Text style={[styles.trailingText, session.isSleeping ? styles.trailingTextSleeping : null]}>
                  {timeLabel}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {showChips ? (
          <WorkChips
            chips={chips}
            paddingLeft={linePaddingLeft}
            actions={workActions}
            fitLinks={linksNeverShown === null ? undefined : { neverShown: linksNeverShown }}
          />
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /** A linked badge: bare text in the crew count's size (`coordinatorBadgeCount`, desktop `session_links_badge_body`). */
  linksBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  linksBadgeText: {
    fontSize: ds(13.55),
    lineHeight: ds(20),
  },
  /** The suggestions badge: the link icon and the count in a dashed pill. */
  linksBadgeSuggested: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(3),
    height: ds(16),
    paddingHorizontal: ds(5),
    borderRadius: ds(8),
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  linksBadgeSuggestedText: {
    fontSize: ds(10.5),
  },
  rowGap: {
    marginBottom: ROW_SPACING,
  },
  /* sessions.rs `dim_sleeping`. */
  dimmed: {
    opacity: 0.5,
  },
  agentbox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(3),
    maxWidth: ds(96),
    flexShrink: 1,
  },
  agentboxLabel: {
    color: SIDEBAR_MUTED,
    fontSize: ds(11.5),
    fontWeight: '300',
    flexShrink: 1,
  },
  rowBox: {
    borderRadius: ds(5),
  },
  row: {
    height: TOUCH_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: ds(6),
  },
  icon: {
    position: 'absolute',
    top: '50%',
    marginTop: -ds(7.5),
    width: ds(15),
    height: ds(15),
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.48,
  },
  iconActive: {
    opacity: 0.8,
  },
  /**
   * CDXC:Sidebar 2026-10-24 DECISION: User: "ok do 70% for non sleeping basically for now (for agent icons)". An awake row that is not the open session rests its icon at 70%; a sleeping row keeps the base 48%. The desktop's `native_sidebar/icons.rs` uses the same two values.
   */
  iconAwake: {
    opacity: 0.7,
  },
  iconTimer: {
    opacity: 1,
  },
  threadLine: {
    position: 'absolute',
    width: ds(THREAD_INDENT - 5),
    borderLeftWidth: ds(1),
    borderLeftColor: SidebarPalette.ROW_THREAD_LINE,
  },
  threadLineAcross: {
    position: 'absolute',
    left: 0,
    height: ds(1),
    backgroundColor: SidebarPalette.ROW_THREAD_LINE,
  },
  threadChevron: {
    position: 'absolute',
    top: '50%',
    marginTop: -ds(7),
    width: ds(14),
    height: ds(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** The hollow ring a collapsed section heading shows for the selected session inside it (rows.tsx `activeRing`). */
  containsActiveRing: {
    width: ds(9),
    height: ds(9),
    borderRadius: 999,
    borderWidth: ds(1.5),
    borderColor: '#A3A3A3',
  },
  coordinatorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
  },
  coordinatorBadgeCount: {
    fontSize: ds(13.55),
    lineHeight: ds(20),
  },
  noteDot: {
    position: 'absolute',
    top: ds(15) + LINE_SHIFT,
    width: ds(4),
    height: ds(4),
    borderRadius: ds(2),
    backgroundColor: '#FFFFFF',
  },
  /* The desktop's composer-draft color (decorations.rs), #B9D8FA in both themes by the user's 2026-09-21 decision there. */
  composerDraftDot: {
    position: 'absolute',
    width: ds(6),
    height: ds(6),
    borderRadius: 999,
    backgroundColor: '#B9D8FA',
  },
  queueBadge: {
    position: 'absolute',
    top: ds(6.5) + LINE_SHIFT,
    minWidth: ds(10),
    height: ds(10),
    paddingHorizontal: ds(2),
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SidebarPalette.DELAYED_SEND_CLOCK,
  },
  /*
    A `failed` row holds the queue until the user retries or deletes it, so the
    badge switches to the sidebar's error red — desktop paints the same badge
    #ff6b6b for the same reason. Colour only: the box above is untouched, so a
    red badge can never move the row.
  */
  queueBadgeFailed: {
    backgroundColor: SidebarPalette.ERROR_DOT,
  },
  queueBadgeCount: {
    color: '#1D1704',
    fontSize: ds(7),
    fontWeight: '700',
    lineHeight: ds(10),
  },
  title: {
    flex: 1,
    color: '#B4B8C0',
    fontSize: ds(15.5),
    fontWeight: '300',
    lineHeight: ds(20),
  },
  titleActive: {
    color: SELECTED_TEXT,
  },
  /* The desktop row lays its title, status slot and time out with a 6px gap. */
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(6),
    marginStart: ds(6),
  },
  trailingText: {
    color: SidebarPalette.ROW_TIME,
    fontSize: ds(13.55),
    fontWeight: '300',
    lineHeight: ds(20),
    textAlign: 'right',
  },
  trailingTextSleeping: {
    color: SidebarPalette.ROW_TIME_SLEEPING,
  },
  indicatorSlot: {
    width: ds(19),
    height: ds(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* status.rs `folded_status_indicator`: a stack of three or four dots is wider than the slot, which it grows to fit. */
  foldedSlot: {
    width: undefined,
    minWidth: ds(19),
  },
  /** The red approval dot (status.rs APPROVAL_COLOR). */
  approvalDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_APPROVAL,
  },
  failedDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_FAILED,
  },
  workingDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_WORKING,
  },
  attentionDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_ATTENTION,
  },
  backgroundWorkDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_BACKGROUND_WORK,
  },
  questionDot: {
    width: ds(STATUS_DOT_SIZE),
    height: ds(STATUS_DOT_SIZE),
    borderRadius: 999,
    backgroundColor: SidebarPalette.ROW_QUESTION,
  },
});
