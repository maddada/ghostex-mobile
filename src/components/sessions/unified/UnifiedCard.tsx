/**
 * The Unified list's rows, drawn as the desktop's Unified sidebar draws them
 * (apps/desktop/src/app/native_sidebar/unified/cards.rs and shelves.rs): a three-line card, the
 * shelves' one-line row and the shelf heading.
 *
 * CDXC:Sidebar 2026-10-30 DECISION:
 * User: the phone's Unified list matches the desktop's exactly. Line one is the project's icon (its
 * repository's, from whichever computer has one, else the letter tile), the filled pin when pinned,
 * the repository's name with " · computer" for a session on another computer, and on the right the
 * status (an icon, a word and, while working, a live timer, in the desktop's status colours) or the
 * age; line two is the title; line three the branch, a coloured pull request number and the agent.
 * Every line keeps one weight whether the card is open or not (only its fill, outline and brighter
 * title say it is). Where the desktop shows Snooze and Park on hover, the phone shows them when the
 * card is swiped left, the gesture its Machines cards use for their actions, and in the long-press
 * menu.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import type { UnifiedRow, UnifiedShelf, UnifiedStatus } from '../../../contract/unified/build';
import {
  agentIconTint,
  resolveAgentArtId,
  type GhostexProjectIcon,
  type GhostexSession,
} from '../../../contract/mobileSummary';
import { SessionCopy } from '../../../copy';
import { SidebarPalette } from '../../../theme/palette';
import SwipeRevealRow from '../../../screens/machines-screen/SwipeRevealRow';
import type { MenuAnchor } from '../ContextMenu';
import { ChevronDownGlyph, ChevronRightGlyph, GitPullRequestGlyph, PencilGlyph, PlusGlyph } from '../icons';
import {
  ds,
  inkStyleSheets,
  inkWash,
  LetterTile,
  ProjectIcon,
  SelectedCardOutline,
  selectedFill,
  useSidebarInk,
  type SidebarInk,
} from '../rows';
import { lastInteractionLabel } from '../sessionStatus';
import type { UnifiedSwipeAction } from '../../../contract/unified/strip';
import {
  AlarmGlyph,
  AlertCircleGlyph,
  AlertTriangleGlyph,
  ArrowBackUpGlyph,
  BranchDeletedGlyph,
  BranchGlyph,
  CheckGlyph,
  CircleDashedGlyph,
  HelpCircleGlyph,
  PinFilledGlyph,
  StatusCircleCheckGlyph,
  StatusCircleDotGlyph,
} from './glyphs';
import CloudBoxBadge from '../CloudBoxBadge';
import { showsFoldedStatus, UnifiedCrewToggle, UnifiedFoldedStatus } from './crew';

/** The desktop's done blue (cards.rs `chrome_color(0x95d7f6, …)`). */
const DONE_COLOR = SidebarPalette.ROW_ATTENTION;

export function statusLook(status: UnifiedStatus, ink: SidebarInk): { Glyph: typeof AlertTriangleGlyph; color: string } {
  switch (status) {
    case 'Approval':
      return { Glyph: AlertTriangleGlyph, color: SidebarPalette.ROW_FAILED };
    case 'Question':
      return { Glyph: HelpCircleGlyph, color: SidebarPalette.ROW_QUESTION };
    case 'Failed':
      return { Glyph: AlertCircleGlyph, color: SidebarPalette.ROW_FAILED };
    case 'Working':
      return { Glyph: CircleDashedGlyph, color: SidebarPalette.ROW_WORKING };
    case 'Waiting':
      return { Glyph: StatusCircleDotGlyph, color: ink.muted };
    case 'Done':
      return { Glyph: StatusCircleCheckGlyph, color: DONE_COLOR };
  }
}

/** `38s`, `4m 12s`, `1h 5m`: how long the agent has worked (cards.rs `elapsed_label`). */
export function elapsedLabel(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** `in 12m`, `in 3h`, `in 2d`: when a snoozed session wakes (shelves.rs `wake_label`). */
export function wakeLabel(wakeAtMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.floor((wakeAtMs - nowMs) / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  if (minutes < 1440) return `in ${Math.floor(minutes / 60)}h`;
  return `in ${Math.floor(minutes / 1440)}d`;
}

function SpinningGlyph({ children }: { children: ReactNode }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, { toValue: 1, duration: 3000, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <Animated.View style={{ transform: [{ rotate }] }}>{children}</Animated.View>;
}

/** A card's status: its icon, word and working timer, or its age when it has no status (also the wall's tile badge). */
export function StatusSlot({ row, nowMs }: { row: UnifiedRow<GhostexSession>; nowMs: number }) {
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  const { status } = row;
  if (status === null) {
    const age = lastInteractionLabel(row.session.source!, nowMs);
    return <Text style={styles.age}>{age ?? ''}</Text>;
  }
  const { Glyph, color } = statusLook(status, ink);
  const started = row.session.workingStartedMs;
  const timer = status === 'Working' && started !== null ? elapsedLabel(nowMs - started) : null;
  const glyph = <Glyph size={ds(13)} color={color} />;
  // CDXC:Sidebar 2026-11-04 DECISION: User: "Please don't say Working or Question or Done for the
  // threads in the sidebar, should just show the icon", and the dot should "stay in 1 place". No
  // status word; the icon sits on the card's edge and the timer grows leftward from it (cards.rs).
  return (
    <View style={styles.status} accessibilityLabel={status}>
      {timer !== null ? <Text style={[styles.statusTimer, { color }]}>{timer}</Text> : null}
      <View style={styles.rightColumn}>{status === 'Working' ? <SpinningGlyph>{glyph}</SpinningGlyph> : glyph}</View>
    </View>
  );
}

/** The repository's icon, or its first letter on a tile when it has none (cards.rs `repo_tile`). */
export function RepoTile({ icon, label, dim = false }: { icon: GhostexProjectIcon | null; label: string; dim?: boolean }) {
  const styles = unifiedStyles(useSidebarInk());
  const tile =
    icon === null ? <LetterTile title={label} size={ds(16)} /> : <ProjectIcon icon={{ ...icon, glyph: '' }} title={label} size={ds(16)} />;
  return <View style={dim ? styles.dim : null}>{tile}</View>;
}

export function AgentIcon({ session }: { session: GhostexSession }) {
  const ink = useSidebarInk();
  if (session.isDraft === true) return <PencilGlyph size={ds(15)} color={ink.text} />;
  const iconId = resolveAgentArtId(session.agentIcon, session.agentName.length > 0 ? session.agentName : session.agent);
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  return <Icon size={iconId === 'terminal' || iconId === 'browser' ? ds(15) : ds(13)} color={agentIconTint(iconId)} />;
}

function pullRequestColor(state: string, ink: SidebarInk): string {
  if (state === 'merged') return '#A371F7';
  if (state === 'closed') return SidebarPalette.ROW_FAILED;
  if (state === 'draft') return ink.muted;
  return '#3FB950';
}

/** What a swipe reveals: the Unified strip's buttons right of its chevron (contract/unified/strip.ts). */
function CardActions({
  actions,
  onSnooze,
  onPark,
  onSleep,
}: {
  actions: readonly UnifiedSwipeAction[];
  onSnooze: (anchor: MenuAnchor) => void;
  onPark: () => void;
  onSleep: () => void;
}) {
  const snoozeRef = useRef<ViewInstance | null>(null);
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  return (
    <View style={styles.actions}>
      {actions.map((action) => {
        switch (action) {
          case 'snooze':
            return (
              <Pressable
                key={action}
                ref={snoozeRef}
                accessibilityRole="button"
                accessibilityLabel="Snooze session"
                style={styles.actionButton}
                onPress={() =>
                  snoozeRef.current?.measureInWindow((x, y, width, height) => onSnooze({ x, y, width, height }))
                }
              >
                <AlarmGlyph size={ds(15)} color={ink.text} />
                <Text style={styles.actionWord}>Snooze</Text>
              </Pressable>
            );
          case 'park':
            return (
              <Pressable key={action} accessibilityRole="button" accessibilityLabel="Park session" style={styles.actionButton} onPress={onPark}>
                <CheckGlyph size={ds(15)} color={ink.text} />
                <Text style={styles.actionWord}>Park</Text>
              </Pressable>
            );
          case 'sleep':
            return (
              <Pressable key={action} accessibilityRole="button" accessibilityLabel="Sleep session" style={styles.actionButton} onPress={onSleep}>
                <Text style={styles.actionWord}>Sleep</Text>
              </Pressable>
            );
        }
      })}
    </View>
  );
}

/** A swiped card's panel, by how many buttons it holds. */
const SWIPE_ACTION_WIDTH = 88;

export type UnifiedCardProps = {
  row: UnifiedRow<GhostexSession>;
  repoIcon: GhostexProjectIcon | null;
  active: boolean;
  nowMs: number;
  sidebarBackground: string;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  onSnooze: (anchor: MenuAnchor) => void;
  onPark: () => void;
  onSleep: () => void;
  /** The strip's buttons a swipe shows (contract/unified/strip.ts). */
  swipeActions: readonly UnifiedSwipeAction[];
  /** Under its project's header, which names the project. */
  inGroup?: boolean;
  /** The crew count's tap on a card with threads under it: folds or unfolds them (contract/unified/tree.ts). */
  onToggleCrew?: (key: string) => void;
};

/** A card: always three lines. */
export function UnifiedCard({
  row,
  repoIcon,
  active: open,
  nowMs,
  sidebarBackground,
  onPress,
  onMenu,
  onSnooze,
  onPark,
  onSleep,
  swipeActions,
  inGroup = false,
  onToggleCrew = () => {},
}: UnifiedCardProps) {
  const cardRef = useRef<ViewInstance | null>(null);
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  const session = row.session.source!;
  // A folded card stands in for the open thread it hides (CDXC:Coordinators 2026-10-22 in gx-core sidebar_view/view.rs).
  const active = open || row.crew?.containsActive === true;
  const needsYou = row.status === 'Approval' || row.status === 'Question' || row.status === 'Done' || row.status === 'Failed';
  const ringColor = active ? selectedFill(sidebarBackground, ink) : sidebarBackground;
  const status = showsFoldedStatus(row) ? (
    <UnifiedFoldedStatus row={row} ringColor={ringColor} />
  ) : (
    <StatusSlot row={row} nowMs={nowMs} />
  );
  // A card that waits on nobody recedes, so the ones that need you stand out.
  const recede = !active && !needsYou && (row.status === null || row.status === 'Working' || row.status === 'Waiting');
  const project = inGroup
    ? (row.machineLabel ?? '')
    : row.machineLabel === null
      ? row.repo.label
      : `${row.repo.label} · ${row.machineLabel}`;
  // With no computer to name either, the status moves up beside the title (cards.rs).
  const titleLineOnly = inGroup && row.machineLabel === null;
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const branch = session.gitBranch !== undefined && session.gitBranch.length > 0 ? session.gitBranch : (session.work?.branch ?? '');
  const prNumber = session.work?.pullRequestNumber ?? null;
  // CDXC:Sidebar 2026-11-04 DECISION: a session outside git keeps its third line, "Untracked"
  // (Q1239) by a crossed-out branch in the branch's colour (cards.rs, build.ts `noSourceControl`).
  // CDXC:Sidebar 2026-11-05 DECISION: every card draws its third line ("i want rows to always
  // remain 3 rows in unified sidebar"): while its branch is not known, the branch this card last
  // showed, else a quiet "No branch" (gx-core unified_sidebar/machines.rs `unified_branch_line`).
  const lastBranch = useRef('');
  if (branch.length > 0) lastBranch.current = branch;
  const placeholder = branch.length === 0 && !row.noSourceControl;
  const shownBranch = branch.length > 0 ? branch : lastBranch.current.length > 0 ? lastBranch.current : SessionCopy.noBranch;
  const openMenu = (): void => {
    cardRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };
  return (
    <View style={styles.cardGap}>
      <SwipeRevealRow
        revealWidth={SWIPE_ACTION_WIDTH * swipeActions.length}
        actions={<CardActions actions={swipeActions} onSnooze={onSnooze} onPark={onPark} onSleep={onSleep} />}
      >
        <Pressable
          ref={cardRef}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: active }}
          onPress={onPress}
          onLongPress={openMenu}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: active ? selectedFill(sidebarBackground, ink) : pressed ? inkWash(ink, 0.06) : sidebarBackground },
          ]}
        >
          {active ? <SelectedCardOutline /> : null}
          {titleLineOnly ? null : (
            <View style={styles.lineOne}>
              {inGroup ? null : <RepoTile icon={repoIcon} label={row.repo.label} />}
              {session.isPinned ? <PinFilledGlyph size={ds(13)} color={ink.muted} /> : null}
              <Text numberOfLines={1} style={styles.project}>
                {project}
              </Text>
              {status}
            </View>
          )}
          <View style={styles.lineTwo}>
            {titleLineOnly && session.isPinned ? <PinFilledGlyph size={ds(13)} color={ink.muted} /> : null}
            <Text
              numberOfLines={1}
              style={[styles.title, needsYou || active ? styles.titleBright : null, recede ? styles.recede : null]}
            >
              {title}
            </Text>
            {session.cloudBox !== undefined ? <CloudBoxBadge cloudBox={session.cloudBox} /> : null}
            {/* The crew count folds the threads nested under the card (CDXC:Sidebar 2026-11-09 in gx-core unified_sidebar/tree.rs). */}
            <UnifiedCrewToggle row={row} onToggle={onToggleCrew} />
            {titleLineOnly ? status : null}
          </View>
          <View style={styles.lineThree}>
            {row.noSourceControl && branch.length === 0 ? (
              <View style={styles.branch}>
                <BranchDeletedGlyph size={ds(12)} color={ink.muted} />
                <Text numberOfLines={1} style={styles.meta}>
                  {SessionCopy.noSourceControl}
                </Text>
              </View>
            ) : (
              <View style={[styles.branch, placeholder ? styles.placeholder : null]}>
                <BranchGlyph size={ds(12)} color={ink.muted} />
                <Text numberOfLines={1} style={styles.meta}>
                  {shownBranch}
                </Text>
              </View>
            )}
            {prNumber !== null ? (
              <View style={styles.pullRequest}>
                <GitPullRequestGlyph size={ds(12)} color={pullRequestColor(session.work?.pullRequestState ?? '', ink)} />
                <Text style={[styles.meta, { color: pullRequestColor(session.work?.pullRequestState ?? '', ink) }]}>
                  #{prNumber}
                </Text>
              </View>
            ) : null}
            <View style={styles.agent}>
              <AgentIcon session={session} />
            </View>
          </View>
        </Pressable>
      </SwipeRevealRow>
    </View>
  );
}

export type UnifiedSlimRowProps = {
  row: UnifiedRow<GhostexSession>;
  shelf: UnifiedShelf;
  repoIcon: GhostexProjectIcon | null;
  active: boolean;
  nowMs: number;
  sidebarBackground: string;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  /** Unsnooze on a snoozed row, Unpark on a parked one. */
  onRestore: () => void;
  /** The crew count's tap on a parked or snoozed coordinator with threads under it. */
  onToggleCrew?: (key: string) => void;
};

/** One line on the Snoozed and Parked shelves: the greyed tile, the title, and when it wakes or was last active. */
export function UnifiedSlimRow({
  row,
  shelf,
  repoIcon,
  active: open,
  nowMs,
  sidebarBackground,
  onPress,
  onMenu,
  onRestore,
  onToggleCrew = () => {},
}: UnifiedSlimRowProps) {
  const active = open || row.crew?.containsActive === true;
  const rowRef = useRef<ViewInstance | null>(null);
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  const session = row.session.source!;
  const wake = shelf === 'snoozed' ? row.session.snoozedUntilMs : null;
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const restore = (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={shelf === 'snoozed' ? 'Unsnooze session' : 'Unpark session'}
        style={styles.actionButton}
        onPress={onRestore}
      >
        {shelf === 'snoozed' ? <AlarmGlyph size={ds(15)} color={ink.text} /> : <ArrowBackUpGlyph size={ds(15)} color={ink.text} />}
        <Text style={styles.actionWord}>{shelf === 'snoozed' ? 'Unsnooze' : 'Unpark'}</Text>
      </Pressable>
    </View>
  );
  return (
    <View style={styles.slimGap}>
      <SwipeRevealRow actions={restore}>
        <Pressable
          ref={rowRef}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: active }}
          onPress={onPress}
          onLongPress={() => rowRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }))}
          style={({ pressed }) => [
            styles.slim,
            { backgroundColor: active ? selectedFill(sidebarBackground, ink) : pressed ? inkWash(ink, 0.06) : sidebarBackground },
          ]}
        >
          {active ? <SelectedCardOutline /> : null}
          <RepoTile icon={repoIcon} label={row.repo.label} dim />
          <Text numberOfLines={1} style={[styles.title, styles.slimTitle]}>
            {title}
          </Text>
          <UnifiedCrewToggle row={row} onToggle={onToggleCrew} />
          <UnifiedFoldedStatus row={row} ringColor={active ? selectedFill(sidebarBackground, ink) : sidebarBackground} />
          {wake !== null ? (
            <View style={styles.status}>
              <AlarmGlyph size={ds(13)} color={DONE_COLOR} />
              <Text style={[styles.statusTimer, { color: DONE_COLOR }]}>{wakeLabel(wake, nowMs)}</Text>
            </View>
          ) : (
            <Text style={styles.age}>{lastInteractionLabel(session, nowMs) ?? ''}</Text>
          )}
        </Pressable>
      </SwipeRevealRow>
    </View>
  );
}

const SHELF_LABEL: Record<UnifiedShelf, string> = {
  drafts: 'Drafts',
  working: 'Moving',
  snoozed: 'Snoozed',
  parked: 'Parked',
  pinned: 'Pinned',
  active: 'Sessions',
};

/** A shelf's heading: chevron, name and count; a tap folds or opens it. */
export function UnifiedShelfHeader({ shelf, count, open, onToggle }: { shelf: UnifiedShelf; count: number; open: boolean; onToggle: () => void }) {
  const Chevron = open ? ChevronDownGlyph : ChevronRightGlyph;
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${SHELF_LABEL[shelf]} (${count})`}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.shelfHeader, pressed ? styles.shelfPressed : null]}
    >
      <Chevron size={ds(13)} color={ink.muted} />
      <Text style={styles.shelfLabel}>{SHELF_LABEL[shelf]}</Text>
      <Text style={styles.shelfCount}>{count}</Text>
    </Pressable>
  );
}

/** A project group's header: chevron, icon, name, a "+" for New session there, and the count. */
export function UnifiedGroupHeader({
  label,
  icon,
  count,
  open,
  onToggle,
  onNew,
  urgent = null,
}: {
  label: string;
  icon: GhostexProjectIcon | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  onNew: () => void;
  /** The most urgent status under a folded header, its threads' included: the dot the desktop's header draws (groups.rs `most_urgent`). */
  urgent?: UnifiedStatus | null;
}) {
  const Chevron = open ? ChevronDownGlyph : ChevronRightGlyph;
  const ink = useSidebarInk();
  const styles = unifiedStyles(ink);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} (${count})`}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.shelfHeader, pressed ? styles.shelfPressed : null]}
    >
      <Chevron size={ds(13)} color={ink.muted} />
      <RepoTile icon={icon} label={label} />
      <Text numberOfLines={1} style={styles.groupLabel}>
        {label}
      </Text>
      {!open && urgent !== null ? <UrgentGlyph status={urgent} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`New session in ${label}`} hitSlop={8} onPress={onNew} style={styles.groupNew}>
        <PlusGlyph size={ds(14)} color={ink.muted} />
      </Pressable>
      <Text style={styles.shelfCount}>{count}</Text>
    </Pressable>
  );
}

/** A folded project header's dot: its most urgent status's icon, in its colour, labelled with the status word. */
function UrgentGlyph({ status }: { status: UnifiedStatus }) {
  const ink = useSidebarInk();
  const { Glyph, color } = statusLook(status, ink);
  return (
    <View accessibilityLabel={status}>
      <Glyph size={ds(13)} color={color} />
    </View>
  );
}

const unifiedStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    groupLabel: { flex: 1, minWidth: 0, color: ink.text, fontSize: ds(13.5), fontWeight: '400' },
    groupNew: { width: ds(24), height: ds(24), alignItems: 'center', justifyContent: 'center' },
    cardGap: { paddingHorizontal: ds(3), paddingBottom: ds(2) },
    card: {
      paddingHorizontal: ds(8),
      paddingVertical: ds(7),
      borderRadius: ds(5),
      gap: ds(3),
    },
    lineOne: { height: ds(18), flexDirection: 'row', alignItems: 'center', gap: ds(6) },
    project: { flex: 1, minWidth: 0, color: ink.muted, fontSize: ds(12.5), fontWeight: '400' },
    status: { flexDirection: 'row', alignItems: 'center', gap: ds(4), flexShrink: 0 },
    statusTimer: { fontSize: ds(12.5), fontWeight: '400', opacity: 0.85 },
    age: { color: ink.time, fontSize: ds(13.55), fontWeight: '300', flexShrink: 0 },
    lineTwo: { minHeight: ds(20), flexDirection: 'row', alignItems: 'center', gap: ds(6) },
    title: { flex: 1, minWidth: 0, color: ink.text, fontSize: ds(15.5), fontWeight: '300', lineHeight: ds(20) },
    titleBright: { color: ink.selectedText },
    recede: { opacity: 0.75 },
    lineThree: { height: ds(17), flexDirection: 'row', alignItems: 'center', gap: ds(5) },
    branch: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ds(4) },
    /** A branch shown while the current one is not known: the last one seen, or "No branch". */
    placeholder: { opacity: 0.6 },
    meta: { color: ink.muted, fontSize: ds(12.5), fontWeight: '400', flexShrink: 1 },
    pullRequest: { flexDirection: 'row', alignItems: 'center', gap: ds(2), flexShrink: 0 },
    agent: { opacity: 0.75, flexShrink: 0, width: ds(17), alignItems: 'center' },
    /**
     * CDXC:Sidebar 2026-11-05 DECISION: User: "the dot that indicates working/status is shifted to
     * the left a bit and not center aligned with the icon below it". The status icon and the agent
     * icon share one fixed-width, centred right column, so the status sits exactly over the agent
     * icon whatever the timer says (cards.rs, `STATUS_SLOT_WIDTH`).
     */
    rightColumn: { width: ds(17), alignItems: 'center', flexShrink: 0 },
    dim: { opacity: 0.5 },
    actions: { flex: 1, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'flex-end', gap: ds(2), paddingLeft: ds(4) },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: ds(4),
      borderRadius: ds(5),
      backgroundColor: inkWash(ink, 0.06),
    },
    actionWord: { color: ink.text, fontSize: ds(12), fontWeight: '400' },
    slimGap: { paddingHorizontal: ds(3), paddingBottom: ds(1) },
    slim: {
      height: ds(34),
      paddingHorizontal: ds(8),
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(8),
      borderRadius: ds(5),
    },
    slimTitle: { opacity: 0.8 },
    shelfHeader: {
      marginHorizontal: ds(3),
      height: ds(30),
      paddingHorizontal: ds(6),
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(6),
      borderRadius: ds(5),
    },
    shelfPressed: { backgroundColor: inkWash(ink, 0.06) },
    shelfLabel: { flex: 1, color: ink.muted, fontSize: ds(13), fontWeight: '400' },
    shelfCount: { color: ink.muted, fontSize: ds(13), fontWeight: '300' },
  }),
);
