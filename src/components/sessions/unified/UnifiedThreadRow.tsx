/**
 * The rows drawn under an unfolded Unified card: one line per thread (its agent's icon or a
 * sub-coordinator's crown, the title, what differs from the card: pin, computer, branch, pull
 * request, its own crew count, then its status) and each coordinator's "N older threads" row.
 * The desktop draws the same in apps/desktop/src/app/native_sidebar/unified/threads.rs.
 *
 * CDXC:Sidebar 2026-11-09 SEE-ALSO: the maintainer's decision in packages/gx-core/src/unified_sidebar/tree.rs. On the
 * phone a thread row opens on a tap and shows its actions on a long press only (user decision 2026-10-12: no
 * always-visible buttons on the phone's rows).
 */

import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';

import type { GhostexSession } from '../../../contract/mobileSummary';
import type { UnifiedRow } from '../../../contract/unified/build';
import { SessionCopy } from '../../../copy';
import type { MenuAnchor } from '../ContextMenu';
import { CoordinatorGlyph } from '../icons';
import { ds, inkStyleSheets, inkWash, SelectedCardOutline, selectedFill, useSidebarInk } from '../rows';
import { showsFoldedStatus, UnifiedCrewToggle, UnifiedFoldedStatus } from './crew';
import { BranchGlyph, PinFilledGlyph } from './glyphs';
import { AgentIcon, StatusSlot } from './UnifiedCard';

/** Indent per tree level, as the desktop's `THREAD_INDENT`. */
const THREAD_INDENT = 16;

function branchOf(session: GhostexSession): string {
  return session.gitBranch !== undefined && session.gitBranch.length > 0 ? session.gitBranch : (session.work?.branch ?? '');
}

export type UnifiedThreadRowProps = {
  row: UnifiedRow<GhostexSession>;
  /** 1 for the card's own threads. */
  depth: number;
  /** The card it sits under, whose computer, branch and pull request it does not repeat. */
  card: UnifiedRow<GhostexSession>;
  active: boolean;
  nowMs: number;
  sidebarBackground: string;
  onPress: () => void;
  onMenu: (anchor: MenuAnchor) => void;
  onToggleCrew: (key: string) => void;
};

export function UnifiedThreadRow({
  row,
  depth,
  card,
  active: open,
  nowMs,
  sidebarBackground,
  onPress,
  onMenu,
  onToggleCrew,
}: UnifiedThreadRowProps) {
  const rowRef = useRef<ViewInstance | null>(null);
  const ink = useSidebarInk();
  const styles = threadStyles(ink);
  const session = row.session.source!;
  const cardSession = card.session.source!;
  const active = open || row.crew?.containsActive === true;
  const title = session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
  const branch = branchOf(session);
  const shownBranch = branch.length > 0 && branch !== branchOf(cardSession) ? branch : null;
  const prNumber = session.work?.pullRequestNumber ?? null;
  const shownPr = prNumber !== null && prNumber !== (cardSession.work?.pullRequestNumber ?? null) ? prNumber : null;
  const machine = row.machine !== card.machine ? row.machineLabel : null;
  const ringColor = active ? selectedFill(sidebarBackground, ink) : sidebarBackground;
  return (
    <View style={[styles.gap, { paddingLeft: ds(3 + 12) }]}>
      <View style={styles.line}>
        <Pressable
          ref={rowRef}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ selected: active }}
          onPress={onPress}
          onLongPress={() => rowRef.current?.measureInWindow((x, y, width, height) => onMenu({ x, y, width, height }))}
          style={({ pressed }) => [
            styles.row,
            { paddingLeft: ds(6 + (depth - 1) * THREAD_INDENT) },
            { backgroundColor: active ? selectedFill(sidebarBackground, ink) : pressed ? inkWash(ink, 0.06) : sidebarBackground },
          ]}
        >
          {active ? <SelectedCardOutline /> : null}
          <View style={styles.icon}>
            {row.crew !== null || session.isCoordinator ? (
              <CoordinatorGlyph size={ds(13)} color={ink.crown} />
            ) : (
              <AgentIcon session={session} />
            )}
          </View>
          <Text numberOfLines={1} style={[styles.title, active ? styles.titleBright : null]}>
            {title}
          </Text>
          {session.isPinned ? <PinFilledGlyph size={ds(12)} color={ink.muted} /> : null}
          {machine !== null ? (
            <Text numberOfLines={1} style={styles.meta}>
              {machine}
            </Text>
          ) : null}
          {shownBranch !== null ? (
            <View style={styles.branch}>
              <BranchGlyph size={ds(11)} color={ink.muted} />
              <Text numberOfLines={1} style={styles.meta}>
                {shownBranch}
              </Text>
            </View>
          ) : null}
          {shownPr !== null ? <Text style={styles.meta}>#{shownPr}</Text> : null}
          <UnifiedCrewToggle row={row} onToggle={onToggleCrew} />
          {showsFoldedStatus(row) ? (
            <UnifiedFoldedStatus row={row} ringColor={ringColor} />
          ) : (
            <StatusSlot row={row} nowMs={nowMs} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

/** The quiet row that lists a coordinator's older threads, or tucks them away again (desktop threads.rs wording). */
export function UnifiedOlderRow({
  depth,
  older,
  shown,
  onPress,
}: {
  depth: number;
  older: number;
  shown: boolean;
  onPress: () => void;
}) {
  const ink = useSidebarInk();
  const styles = threadStyles(ink);
  const label = shown ? 'Hide older threads' : older === 1 ? '1 older thread' : `${older} older threads`;
  return (
    <View style={[styles.gap, { paddingLeft: ds(3 + 12) }]}>
      <View style={styles.line}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={onPress}
          style={({ pressed }) => [
            styles.older,
            { paddingLeft: ds(6 + (depth - 1) * THREAD_INDENT + 13 + 6) },
            pressed ? { backgroundColor: inkWash(ink, 0.06) } : null,
          ]}
        >
          <Text style={styles.olderLabel}>{label}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const threadStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    gap: { paddingRight: ds(3), paddingBottom: ds(1) },
    /** One tree line down the block, in the desktop's tree colour (threads.rs `tree_line_color`). */
    line: { borderLeftWidth: ds(1), borderLeftColor: inkWash(ink, 0.25), paddingLeft: ds(2) },
    row: {
      height: ds(30),
      paddingRight: ds(8),
      flexDirection: 'row',
      alignItems: 'center',
      gap: ds(6),
      borderRadius: ds(5),
    },
    icon: { opacity: 0.75, width: ds(15), alignItems: 'center' },
    title: { flex: 1, minWidth: 0, color: ink.text, fontSize: ds(14), fontWeight: '300' },
    titleBright: { color: ink.selectedText },
    meta: { color: ink.muted, fontSize: ds(11.5), fontWeight: '400', flexShrink: 1, maxWidth: ds(110) },
    branch: { flexDirection: 'row', alignItems: 'center', gap: ds(3), flexShrink: 1, maxWidth: ds(110) },
    older: { height: ds(26), justifyContent: 'center', borderRadius: ds(5) },
    olderLabel: { color: ink.muted, fontSize: ds(11.5) },
  }),
);
