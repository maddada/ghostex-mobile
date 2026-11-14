/**
 * Opens Drafts when a new session lands there, in the Project list (its project and its Drafts
 * heading) and in the Unified list (the Drafts shelf). A session the phone opens itself is shown
 * full screen, so there is no row to scroll to.
 *
 * CDXC:Drafts 2026-11-02 SEE-ALSO:
 * packages/gx-core/src/sidebar_view/draft_arrivals.rs holds the user's decision and the desktop's
 * half (which also scrolls the open session's row into view); contract/draftArrivals.ts mirrors
 * its rule.
 */

import { useEffect, useRef } from 'react';

import { DraftArrivals, OpenedArrivals, sessionRevealPlan, type DraftRow } from '../../contract/draftArrivals';
import { projectKeyForSession, sessionKindSection } from '../../contract/grouping';
import type { UnifiedRow } from '../../contract/unified/build';
import type { MachineInventory } from '../../inventory/store';
import { useUnifiedListStore } from '../../screens/sessions-screen/unified-list-store';
import { useTerminalStore } from '../../terminal/sessions';
import { useCollapseStore } from './collapseStore';

function createdMs(createdAt: string): number | null {
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * The Project list: one tracker per computer, reset while the Unified list is shown. A new session
 * the phone opens (one it just created, mostly) also opens its collection, project, session group
 * and heading, whichever heading that is (CDXC:Sidebar 2026-11-14 in contract/draftArrivals.ts).
 */
export function useOpenProjectDraftsOnArrival(
  inventoriesByMachineId: Record<string, MachineInventory>,
  enabled: boolean,
): void {
  const trackers = useRef(new Map<string, DraftArrivals>());
  const openedTrackers = useRef(new Map<string, OpenedArrivals>());
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  useEffect(() => {
    if (!enabled) {
      trackers.current.clear();
      openedTrackers.current.clear();
      return;
    }
    const nowMs = Date.now();
    for (const [machineId, inventory] of Object.entries(inventoriesByMachineId)) {
      const sessions = inventory.summary?.sessions;
      if (sessions === undefined) continue;
      const drafts: DraftRow[] = sessions
        .filter((session) => sessionKindSection(session, nowMs) === 'drafts')
        .map((session) => ({
          id: session.sessionId,
          collapseKey: projectKeyForSession(session),
          createdMs: createdMs(session.createdAt),
        }));
      let tracker = trackers.current.get(machineId);
      if (tracker === undefined) {
        tracker = new DraftArrivals();
        trackers.current.set(machineId, tracker);
      }
      for (const arrival of tracker.observe(drafts, nowMs)) {
        useCollapseStore.getState().openDrafts(machineId, arrival.collapseKey);
      }
      let opened = openedTrackers.current.get(machineId);
      if (opened === undefined) {
        opened = new OpenedArrivals();
        openedTrackers.current.set(machineId, opened);
      }
      opened.observe(
        sessions.map((session) => ({
          id: session.sessionId,
          collapseKey: '',
          createdMs: createdMs(session.createdAt),
        })),
        nowMs,
      );
      // The terminal store keys an open session `<machineId>:<sessionId>` (attachSessionKey).
      const prefix = `${machineId}:`;
      const openId = selectedSessionKey?.startsWith(prefix) === true ? selectedSessionKey.slice(prefix.length) : null;
      if (!opened.takeOpened(openId, nowMs)) continue;
      const session = sessions.find((candidate) => candidate.sessionId === openId);
      const summary = inventory.summary;
      if (session === undefined || summary === null || summary === undefined) continue;
      useCollapseStore.getState().openSession(machineId, sessionRevealPlan(summary, session, nowMs));
    }
  }, [inventoriesByMachineId, enabled, selectedSessionKey]);
}

/** The Unified list's Drafts shelf. */
export function useOpenUnifiedDraftsOnArrival(drafts: readonly UnifiedRow[], enabled: boolean): void {
  const tracker = useRef(new DraftArrivals());
  useEffect(() => {
    if (!enabled) {
      tracker.current.reset();
      return;
    }
    const rows: DraftRow[] = drafts.map((row) => ({
      id: row.id,
      collapseKey: '',
      createdMs: row.session.createdMs,
    }));
    if (tracker.current.observe(rows, Date.now()).length > 0) useUnifiedListStore.getState().openDrafts();
  }, [drafts, enabled]);
}
