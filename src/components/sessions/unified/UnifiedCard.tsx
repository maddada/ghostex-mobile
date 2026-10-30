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
import { ChevronDownGlyph, ChevronRightGlyph, GitPullRequestGlyph, PencilGlyph } from '../icons';
import { ds, LetterTile, ProjectIcon, SelectedCardOutline, selectedFill, SELECTED_TEXT, SIDEBAR_MUTED, SIDEBAR_TEXT } from '../rows';
import { lastInteractionLabel } from '../sessionStatus';
import {
  AlarmGlyph,
  AlertCircleGlyph,
  AlertTriangleGlyph,
  ArrowBackUpGlyph,
  BranchGlyph,
  CheckGlyph,
  CircleDashedGlyph,
  HelpCircleGlyph,
  PinFilledGlyph,
  StatusCircleCheckGlyph,
  StatusCircleDotGlyph,
} from './glyphs';

/** The desktop's done blue (cards.rs `chrome_color(0x95d7f6, …)`). */
const DONE_COLOR = SidebarPalette.ROW_ATTENTION;
const AGE_COLOR = SidebarPalette.ROW_TIME;

function statusLook(status: UnifiedStatus): { Glyph: typeof AlertTriangleGlyph; color: string } {
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
      return { Glyph: StatusCircleDotGlyph, color: SIDEBAR_MUTED };
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

function StatusSlot({ row, nowMs }: { row: UnifiedRow<GhostexSession>; nowMs: number }) {
  const { status } = row;
  if (status === null) {
    const age = lastInteractionLabel(row.session.source!, nowMs);
    return <Text style={styles.age}>{age ?? ''}</Text>;
  }
  const { Glyph, color } = statusLook(status);
  const started = row.session.workingStartedMs;
  const timer = status === 'Working' && started !== null ? elapsedLabel(nowMs - started) : null;
  const glyph = <Glyph size={ds(13)} color={color} />;
  return (
    <View style={styles.status}>
      {status === 'Working' ? <SpinningGlyph>{glyph}</SpinningGlyph> : glyph}
      <Text style={[styles.statusWord, { color }]}>{status}</Text>
      {timer !== null ? <Text style={[styles.statusTimer, { color }]}>{timer}</Text> : null}
    </View>
  );
}

/** The repository's icon, or its first letter on a tile when it has none (cards.rs `repo_tile`). */
export function RepoTile({ icon, label, dim = false }: { icon: GhostexProjectIcon | null; label: string; dim?: boolean }) {
  const tile =
    icon === null ? <LetterTile title={label} size={ds(16)} /> : <ProjectIcon icon={{ ...icon, glyph: '' }} title={label} size={ds(16)} />;
  return <View style={dim ? styles.dim : null}>{tile}</View>;
}

function AgentIcon({ session }: { session: GhostexSession }) {
  if (session.isDraft === true) return <PencilGlyph size={ds(15)} color={SIDEBAR_TEXT} />;
  const iconId = resolveAgentArtId(session.agentIcon, session.agentName.length > 0 ? session.agentName : session.agent);
  const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
  return <Icon size={iconId === 'terminal' || iconId === 'browser' ? ds(15) : ds(13)} color={agentIconTint(iconId)} />;
}

function pullRequestColor(state: string): string {
  if (state === 'merged') return '#A371F7';
  if (state === 'closed') return SidebarPalette.ROW_FAILED;
  if (state === 'draft') return SIDEBAR_MUTED;
  return '#3FB950';
}

/** Snooze and Park under a swiped card (hover.rs `render_unified_card_actions`). */
function CardActions({
  onSnooze,
  onPark,
}: {
  onSnooze: (anchor: MenuAnchor) => void;
  onPark: (() => void) | null;
}) {
  const snoozeRef = useRef<ViewInstance | null>(null);
  return (
    <View style={styles.actions}>
      <Pressable
        ref={snoozeRef}
        accessibilityRole="button"
        accessibilityLabel="Snooze session"
        style={styles.actionButton}
        onPress={() =>
          snoozeRef.current?.measureInWindow((x, y, width, height) => onSnooze({ x, y, width, height }))
        }
      >
        <AlarmGlyph size={ds(15)} color={SIDEBAR_TEXT} />
        <Text style={styles.actionWord}>Snooze</Text>
      </Pressable>
      {onPark !== null ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Park session" style={styles.actionButton} onPress={onPark}>
          <CheckGlyph size={ds(15)} color={SIDEBAR_TEXT} />
          <Text style={styles.actionWord}>Park</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export type UnifiedCardProps = {
  row: UnifiedRow<GhostexSession>;
  repoIcon: GhostexProjectIcon | null;
  active: boolean;
  nowMs: number;
  sidebarBackground: string;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  onSnooze: (anchor: MenuAnchor) => void;
  /** Absent while parking is off: a parked card would have no shelf. */
  onPark: (() => void) | null;
};

/** A card: three lines, or two when there is no branch or pull request to show. */
export function UnifiedCard({ row, repoIcon, active, nowMs, sidebarBackground, onPress, onMenu, onSnooze, onPark }: UnifiedCardProps) {
  const cardRef = useRef<ViewInstance | null>(null);
  const session = row.session.source!;
  const needsYou = row.status === 'Approval' || row.status === 'Question' || row.status === 'Done' || row.status === 'Failed';
  // A card that waits on nobody recedes, so the ones that need you stand out.
  const recede = !active && !needsYou && (row.status === null || row.status === 'Working' || row.status === 'Waiting');
  const project = row.machineLabel === null ? row.repo.label : `${row.repo.label} · ${row.machineLabel}`;
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const branch = session.gitBranch !== undefined && session.gitBranch.length > 0 ? session.gitBranch : (session.work?.branch ?? '');
  const prNumber = session.work?.pullRequestNumber ?? null;
  const hasMeta = branch.length > 0 || prNumber !== null;
  const openMenu = (): void => {
    cardRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }));
  };
  return (
    <View style={styles.cardGap}>
      <SwipeRevealRow actions={<CardActions onSnooze={onSnooze} onPark={onPark} />}>
        <Pressable
          ref={cardRef}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: active }}
          onPress={onPress}
          onLongPress={openMenu}
          style={({ pressed }) => [
            styles.card,
            { backgroundColor: active ? selectedFill(sidebarBackground) : pressed ? 'rgba(255,255,255,0.06)' : sidebarBackground },
          ]}
        >
          {active ? <SelectedCardOutline /> : null}
          <View style={styles.lineOne}>
            <RepoTile icon={repoIcon} label={row.repo.label} />
            {session.isPinned ? <PinFilledGlyph size={ds(13)} color={SIDEBAR_MUTED} /> : null}
            <Text numberOfLines={1} style={styles.project}>
              {project}
            </Text>
            <StatusSlot row={row} nowMs={nowMs} />
          </View>
          <View style={styles.lineTwo}>
            <Text
              numberOfLines={1}
              style={[styles.title, needsYou || active ? styles.titleBright : null, recede ? styles.recede : null]}
            >
              {title}
            </Text>
            {!hasMeta ? (
              <View style={styles.agent}>
                <AgentIcon session={session} />
              </View>
            ) : null}
          </View>
          {hasMeta ? (
            <View style={styles.lineThree}>
              {branch.length > 0 ? (
                <View style={styles.branch}>
                  <BranchGlyph size={ds(12)} color={SIDEBAR_MUTED} />
                  <Text numberOfLines={1} style={styles.meta}>
                    {branch}
                  </Text>
                </View>
              ) : (
                <View style={styles.branch} />
              )}
              {prNumber !== null ? (
                <View style={styles.pullRequest}>
                  <GitPullRequestGlyph size={ds(12)} color={pullRequestColor(session.work?.pullRequestState ?? '')} />
                  <Text style={[styles.meta, { color: pullRequestColor(session.work?.pullRequestState ?? '') }]}>
                    #{prNumber}
                  </Text>
                </View>
              ) : null}
              <View style={styles.agent}>
                <AgentIcon session={session} />
              </View>
            </View>
          ) : null}
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
};

/** One line on the Snoozed and Parked shelves: the greyed tile, the title, and when it wakes or was last active. */
export function UnifiedSlimRow({ row, shelf, repoIcon, active, nowMs, sidebarBackground, onPress, onMenu, onRestore }: UnifiedSlimRowProps) {
  const rowRef = useRef<ViewInstance | null>(null);
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
        {shelf === 'snoozed' ? <AlarmGlyph size={ds(15)} color={SIDEBAR_TEXT} /> : <ArrowBackUpGlyph size={ds(15)} color={SIDEBAR_TEXT} />}
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
            { backgroundColor: active ? selectedFill(sidebarBackground) : pressed ? 'rgba(255,255,255,0.06)' : sidebarBackground },
          ]}
        >
          {active ? <SelectedCardOutline /> : null}
          <RepoTile icon={repoIcon} label={row.repo.label} dim />
          <Text numberOfLines={1} style={[styles.title, styles.slimTitle]}>
            {title}
          </Text>
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
  working: 'Working',
  snoozed: 'Snoozed',
  parked: 'Parked',
  pinned: 'Pinned',
  active: 'Sessions',
};

/** A shelf's heading: chevron, name and count; a tap folds or opens it. */
export function UnifiedShelfHeader({ shelf, count, open, onToggle }: { shelf: UnifiedShelf; count: number; open: boolean; onToggle: () => void }) {
  const Chevron = open ? ChevronDownGlyph : ChevronRightGlyph;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${SHELF_LABEL[shelf]} (${count})`}
      accessibilityState={{ expanded: open }}
      onPress={onToggle}
      style={({ pressed }) => [styles.shelfHeader, pressed ? styles.shelfPressed : null]}
    >
      <Chevron size={ds(13)} color={SIDEBAR_MUTED} />
      <Text style={styles.shelfLabel}>{SHELF_LABEL[shelf]}</Text>
      <Text style={styles.shelfCount}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cardGap: { paddingHorizontal: ds(3), paddingBottom: ds(2) },
  card: {
    paddingHorizontal: ds(8),
    paddingVertical: ds(7),
    borderRadius: ds(5),
    gap: ds(3),
  },
  lineOne: { height: ds(18), flexDirection: 'row', alignItems: 'center', gap: ds(6) },
  project: { flex: 1, minWidth: 0, color: SIDEBAR_MUTED, fontSize: ds(12.5), fontWeight: '400' },
  status: { flexDirection: 'row', alignItems: 'center', gap: ds(4), flexShrink: 0 },
  statusWord: { fontSize: ds(12.5), fontWeight: '500' },
  statusTimer: { fontSize: ds(12.5), fontWeight: '400', opacity: 0.85 },
  age: { color: AGE_COLOR, fontSize: ds(13.55), fontWeight: '300', flexShrink: 0 },
  lineTwo: { minHeight: ds(20), flexDirection: 'row', alignItems: 'center', gap: ds(6) },
  title: { flex: 1, minWidth: 0, color: SIDEBAR_TEXT, fontSize: ds(15.5), fontWeight: '300', lineHeight: ds(20) },
  titleBright: { color: SELECTED_TEXT },
  recede: { opacity: 0.75 },
  lineThree: { height: ds(17), flexDirection: 'row', alignItems: 'center', gap: ds(5) },
  branch: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: ds(4) },
  meta: { color: SIDEBAR_MUTED, fontSize: ds(12.5), fontWeight: '400', flexShrink: 1 },
  pullRequest: { flexDirection: 'row', alignItems: 'center', gap: ds(2), flexShrink: 0 },
  agent: { opacity: 0.75, flexShrink: 0 },
  dim: { opacity: 0.5 },
  actions: { flex: 1, flexDirection: 'row', alignItems: 'stretch', justifyContent: 'flex-end', gap: ds(2), paddingLeft: ds(4) },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ds(4),
    borderRadius: ds(5),
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  actionWord: { color: SIDEBAR_TEXT, fontSize: ds(12), fontWeight: '400' },
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
  shelfPressed: { backgroundColor: 'rgba(255,255,255,0.06)' },
  shelfLabel: { flex: 1, color: SIDEBAR_MUTED, fontSize: ds(13), fontWeight: '400' },
  shelfCount: { color: SIDEBAR_MUTED, fontSize: ds(13), fontWeight: '300' },
});
