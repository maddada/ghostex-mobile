/**
 * A coordinator's crew count and a folded coordinator's dots, shared by the drawer's rows
 * (SessionRow.tsx) and the Unified list (unified/UnifiedCard.tsx).
 *
 * threads.rs `coordinator_badge`: the crew icon and one number (sessions waiting for approval, else
 * threads waiting, else working), tinted to match: red for approval, light blue for waiting, orange
 * for working, grey while idle. The drawer draws no badge for an idle coordinator; a Unified card with
 * threads always shows it, as information: its hat's chevron folds them (CDXC:Coordinators 2026-11-11
 * in apps/desktop/src/app/native_sidebar/threads.rs; the phone's chevron sits beside the hat, so a
 * clock in the hat's place never hides it and the count is never a toggle here).
 */

import { StyleSheet, Text, View } from 'react-native';

import type { CoordinatorBadge, FoldedStatus } from '../../contract/coordinatorTree';
import { SidebarPalette } from '../../theme/palette';
import { CrewGlyph } from './icons';
import { ds } from './rows';
import StatusDotStack from './StatusDotStack';

export function crewTint(tone: CoordinatorBadge['tone']): string {
  return tone === 'approval'
    ? SidebarPalette.ROW_APPROVAL
    : tone === 'waiting'
      ? SidebarPalette.ROW_ATTENTION
      : tone === 'working'
        ? SidebarPalette.ROW_WORKING
        : SidebarPalette.MUTED;
}

/** The crew icon and its number (none at zero). */
export function CoordinatorBadgeView({ badge }: { badge: CoordinatorBadge }) {
  const tint = crewTint(badge.tone);
  return (
    <View style={styles.badge}>
      <CrewGlyph size={ds(13.55)} color={tint} />
      {badge.count > 0 ? <Text style={[styles.count, { color: tint }]}>{badge.count}</Text> : null}
    </View>
  );
}

/**
 * A folded coordinator's stack: the dots of the threads its fold hides plus its own, overlapping as
 * the machine tabs draw them, in the status dot's 19x16 slot.
 * CDXC:Coordinators 2026-10-24 SEE-ALSO: the user's decision on gx-core `RowNesting::folded_status`; the desktop draws it in apps/desktop/src/app/native_sidebar/threads.rs `folded_status_indicator`.
 */
export function FoldedStatusIndicator({ status, ringColor }: { status: FoldedStatus; ringColor: string }) {
  return (
    <View style={styles.foldedSlot}>
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

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
  },
  count: {
    fontSize: ds(13.55),
    lineHeight: ds(20),
  },
  /* status.rs `folded_status_indicator`: a stack of three or four dots is wider than the slot, which it grows to fit. */
  foldedSlot: {
    minWidth: ds(19),
    height: ds(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
});
