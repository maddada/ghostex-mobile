/**
 * A Unified card's crew count, the toggle that folds the threads nested under it, and the dots a
 * folded card shows for them (CDXC:Sidebar 2026-11-09 in packages/gx-core/src/unified_sidebar/tree.rs;
 * the desktop draws both in apps/desktop/src/app/native_sidebar/unified/threads.rs).
 */

import { View } from 'react-native';

import type { GhostexSession } from '../../../contract/mobileSummary';
import type { UnifiedRow } from '../../../contract/unified/build';
import { CoordinatorBadgeView, FoldedStatusIndicator } from '../CoordinatorBadgeView';
import { ds, useSidebarInk } from '../rows';

/**
 * What a tap on the crew count does (the desktop's unified/threads.rs `crew_label`): "Hide threads" once unfolded, or
 * "Stop keeping threads open" while a search or filter keeps its matches drawn anyway;
 * "Keep threads open" while a search holds it open; otherwise what the unfold shows: "Show 3 threads",
 * "Show 2 threads (5 older)", or "Show threads (20 older)" when every thread waits behind the older-threads row.
 */
export function crewLabel(row: UnifiedRow<GhostexSession>): string {
  const crew = row.crew;
  if (crew === null) return '';
  const plural = (count: number) => (count === 1 ? 'thread' : 'threads');
  if (crew.unfolded && crew.heldOpen) return 'Stop keeping threads open';
  if (crew.unfolded) return 'Hide threads';
  if (crew.open) return 'Keep threads open';
  if (crew.listed === 0) return `Show threads (${crew.older} older)`;
  if (crew.older > 0 && !crew.olderShown) return `Show ${crew.listed} ${plural(crew.listed)} (${crew.older} older)`;
  return `Show ${crew.total} ${plural(crew.total)}`;
}

/**
 * The crew count of a row with threads under it: grey while none works or waits, with how many
 * threads it has; tapping it folds them. `null` for a row with none.
 */
export function UnifiedCrewToggle({ row, onToggle }: { row: UnifiedRow<GhostexSession>; onToggle: (key: string) => void }) {
  const ink = useSidebarInk();
  const crew = row.crew;
  if (crew === null) return null;
  const badge = crew.badge.tone === 'idle' ? { count: crew.total, tone: 'idle' as const } : crew.badge;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: ds(4) }}>
      <CoordinatorBadgeView
        badge={badge}
        onPress={() => onToggle(crew.key)}
        accessibilityLabel={crewLabel(row)}
        expanded={crew.open}
      />
      {/* A folded card stands in for the open thread it hides: the hollow ring (gx-core `contains_active`). */}
      {crew.containsActive ? (
        <View style={{ width: ds(9), height: ds(9), borderRadius: 999, borderWidth: ds(1.5), borderColor: ink.activeRing }} />
      ) : null}
    </View>
  );
}

/** Whether a row draws its folded dots in its status's place: it is folded and something under it, or itself, has a dot. */
export function showsFoldedStatus(row: UnifiedRow<GhostexSession>): boolean {
  const crew = row.crew;
  if (crew === null || crew.open) return false;
  const status = crew.foldedStatus;
  return status.working || status.attention || status.backgroundWork || status.question || status.approval;
}

/** The dots of everything a folded card hides, with its own status ([`showsFoldedStatus`]). */
export function UnifiedFoldedStatus({ row, ringColor }: { row: UnifiedRow<GhostexSession>; ringColor: string }) {
  if (row.crew === null || !showsFoldedStatus(row)) return null;
  return <FoldedStatusIndicator status={row.crew.foldedStatus} ringColor={ringColor} />;
}
