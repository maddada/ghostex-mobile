/**
 * The project a files or Git changes pane shows: the project of the session it was opened from (its `origin`), as the
 * computer's session list has them, and that session for Add to Session Context (the session Files was
 * opened from). The pane stays with that project; selecting other sessions never changes it. Once found it
 * is remembered while the app runs, so the pane keeps its project when that session later ends. The rule for offering
 * Files and Git changes is the terminal screen menu's: the session has a project with a folder on the computer.
 */

import { useEffect, useMemo } from 'react';

import { resolveAgentIconId, type GhostexMobileSummary } from '../contract/mobileSummary';
import { SessionCopy } from '../copy';
import { contextSessionFor, type ContextSession } from '../files/sessionContext';
import { useInventoryStore } from '../inventory/store';
import { sessionHasChatView } from '../screens/terminal-screen/session-lookups';

export type PaneProject = {
  readonly machineId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectPath: string;
  /** The session the pane was opened from, as Add to Session Context fills it; null when it runs no agent. */
  readonly session: ContextSession | null;
};

export type PaneProjectState =
  | { readonly kind: 'loading' }
  /** The computer's session list has no such session (any more), and the app has not seen its project this run. */
  | { readonly kind: 'unknown' }
  | { readonly kind: 'project'; readonly project: PaneProject };

const LOADING: PaneProjectState = { kind: 'loading' };
const UNKNOWN: PaneProjectState = { kind: 'unknown' };

/** Projects found for origins this run. */
const remembered = new Map<string, PaneProject>();

/** The project of the session `origin` (`machineId:sessionId`) in its computer's session list, or null. */
export function paneProjectFor(origin: string, summary: GhostexMobileSummary): PaneProject | null {
  const machineId = origin.slice(0, origin.indexOf(':'));
  const sessionId = origin.slice(origin.indexOf(':') + 1);
  const record = summary.sessions.find((entry) => entry.sessionId === sessionId);
  if (record === undefined || record.projectId.length === 0) return null;
  const project = summary.projects.find((entry) => entry.projectId === record.projectId);
  const projectPath = project?.path ?? '';
  if (project === undefined || projectPath.length === 0) return null;
  const agentId = resolveAgentIconId(record.agentIcon, record.agentName.length > 0 ? record.agentName : record.agent);
  const title = record.displayTitle.length > 0 ? record.displayTitle : SessionCopy.fallbackTitle;
  return {
    machineId,
    projectId: record.projectId,
    projectName: project.name ?? '',
    projectPath,
    session: contextSessionFor(
      { kind: 'attach', sessionKey: origin, ghostexSessionId: sessionId },
      agentId,
      title,
      sessionHasChatView(record),
    ),
  };
}

function useSummary(sessionKey: string | null): GhostexMobileSummary | null {
  const machineId = sessionKey === null ? null : sessionKey.slice(0, sessionKey.indexOf(':'));
  return useInventoryStore((state) =>
    machineId === null ? null : (state.inventoriesByMachineId[machineId]?.summary ?? null),
  );
}

export function usePaneProject(origin: string): PaneProjectState {
  const summary = useSummary(origin);
  const found = useMemo(() => (summary === null ? null : paneProjectFor(origin, summary)), [origin, summary]);
  useEffect(() => {
    if (found !== null) remembered.set(origin, found);
  }, [origin, found]);
  if (found !== null) return { kind: 'project', project: found };
  const kept = remembered.get(origin);
  if (kept !== undefined) return { kind: 'project', project: kept };
  return summary === null ? LOADING : UNKNOWN;
}

/** Whether Files and Git changes can be opened for this session now: it has a project with a folder. */
export function usePaneProjectOffered(sessionKey: string | null): boolean {
  // The answer itself is selected, not the session list: a change to another session re-renders nothing.
  return useInventoryStore((state) => {
    if (sessionKey === null) return false;
    const summary = state.inventoriesByMachineId[sessionKey.slice(0, sessionKey.indexOf(':'))]?.summary;
    return summary !== undefined && summary !== null && paneProjectFor(sessionKey, summary) !== null;
  });
}

/** The project of `origin` now, outside a render: from its computer's session list, or as seen this run. */
export function paneProjectNow(origin: string): PaneProject | null {
  const summary = useInventoryStore.getState().inventoriesByMachineId[origin.slice(0, origin.indexOf(':'))]?.summary;
  const found = summary === undefined || summary === null ? null : paneProjectFor(origin, summary);
  return found ?? remembered.get(origin) ?? null;
}
