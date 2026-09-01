/**
 * TerminalScreen overlay/constant model and the pure session-lookup helpers,
 * moved verbatim from src/screens/TerminalScreen.tsx.
 */

import {
  resolveAgentIconId,
  type GhostexMobileSummary,
  type GhostexSession,
} from '../../contract/mobileSummary';
import { useInventoryStore } from '../../inventory/store';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { useMachinesStore, type MachineRecord } from '../../machines/store';
import { useTerminalStore, type TerminalTab } from '../../terminal/sessions';

/** Which Agent Actions surface (if any) is on top of the terminal screen. */
export type AgentOverlay =
  | { kind: 'none' }
  | { kind: 'rename'; error: string | null }
  | { kind: 'delayedSend' }
  | { kind: 'promptEditor'; sending: boolean };

export const AGENT_OVERLAY_NONE: AgentOverlay = { kind: 'none' };

/**
 * A finished Export Transcript run, as the result sheet needs it. The markdown
 * file lives on the machine, so everything here describes where it landed and
 * what a follow-up conversation on that same machine would be started from.
 */
export type ExportedTranscript = {
  machine: MachineRecord;
  projectId: string;
  /** Session the transcript came from — the sheet's subtitle. */
  sessionTitle: string;
  /** Launcher agent id for the follow-up session ('' hides that choice). */
  agentId: string;
  /** Human name of that agent, for the follow-up row's description. */
  agentLabel: string;
  /** Absolute path of the exported markdown file on the machine. */
  path: string;
};

export const HEADER_HEIGHT = 44;
/** Deliberate separation between the Android IME boundary and the screen's bottom edge. */
export const ANDROID_KEYBOARD_GAP = 3;
/** How long an onSingleTap keeps the key bar optimistic before keyboard events decide. */
export const TAP_KEYBOARD_HINT_TIMEOUT_MS = 1500;

/**
 * Plan 015 §7: the follow-up session's staged first input. A bare mention of
 * the exported markdown plus one trailing space — gxserver types it into the
 * new agent's input and never submits it, so the user writes their own prompt
 * around it. Nothing is ever sent on their behalf.
 */
export function transcriptMentionDraft(path: string): string {
  return `@${path} `;
}

export function machineRecordFor(machineId: string): MachineRecord | null {
  return useMachinesStore.getState().machines.find((machine) => machine.id === machineId) ?? null;
}

export function machineTargetFor(machineId: string): MachineConnectionTarget | null {
  const record = machineRecordFor(machineId);
  if (record === null) return null;
  return {
    id: record.id,
    host: record.host,
    username: record.username,
    port: record.port,
    transport: record.transport,
  };
}

/**
 * Folder of the session shown in `tab` ('' when unknown): a shell tab reuses
 * its own starting directory; an attach tab resolves its session's project
 * path from the machine inventory.
 */
export function sessionFolderFor(tab: TerminalTab | null): string {
  if (tab === null) return '';
  if (tab.kind === 'shell') return tab.cwd ?? '';
  if (tab.ghostexSessionId === undefined) return '';
  const summary = useInventoryStore.getState().inventoriesByMachineId[tab.machineId]?.summary;
  if (summary === null || summary === undefined) return '';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  if (session === undefined) return '';
  const project = summary.projects.find((entry) => entry.projectId === session.projectId);
  return project?.path ?? '';
}

/**
 * Resolved agent icon id of the session shown in `tab` ('terminal' when it is
 * a shell tab or the session is unknown) — drives the key bar's agent-hotkey
 * page. Pure so the screen can subscribe to it as an inventory selector.
 */
export function sessionAgentIdFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): string {
  if (tab === null || tab.ghostexSessionId === undefined) return 'terminal';
  if (summary === null || summary === undefined) return 'terminal';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  if (session === undefined) return 'terminal';
  return resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
}

/**
 * gxserver projectId of the session shown in `tab` ('' while the inventory
 * has not resolved it) — the Session Chat CLI verbs address sessions by the
 * (projectId, sessionId) pair.
 */
export function sessionProjectIdFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): string {
  if (tab === null || tab.ghostexSessionId === undefined) return '';
  if (summary === null || summary === undefined) return '';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  return session?.projectId ?? '';
}

/**
 * Full inventory record of the session shown in `tab` (null while unknown) —
 * the Agent Actions menu needs its live title, sleep state, delayed-send
 * countdown, and activity. Pure so the screen can subscribe to it: the record
 * is the same object identity until the machine's inventory changes.
 */
export function sessionRecordFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): GhostexSession | null {
  if (tab === null || tab.ghostexSessionId === undefined) return null;
  if (summary === null || summary === undefined) return null;
  return summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId) ?? null;
}

export function patchTab(sessionKey: string, patch: Partial<TerminalTab>): void {
  useTerminalStore.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.sessionKey === sessionKey ? { ...tab, ...patch } : tab)),
  }));
}
