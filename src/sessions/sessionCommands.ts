/**
 * Shared session-command runtime.
 *
 * Extracted verbatim from SessionsScreen so the Terminal screen's Agent
 * Actions menu runs session mutations through the SAME serialized queue and
 * optimistic-inventory bookkeeping. Two copies of `remoteMutationQueues` would
 * let a sleep from the terminal header race a sleep from the drawer for one
 * session, so this module owns the only queue map in the app.
 */

import { runGhostexCli, type CliJsonResult } from '../components/sessions/cli';
import { optimisticChangeResourceKey, type OptimisticInventoryChange } from '../inventory/optimistic';
import { useInventoryStore } from '../inventory/store';
import type { MachineRecord } from '../machines/store';
import { useTerminalStore } from '../terminal/sessions';
import type { GhostexSession } from '../contract/mobileSummary';

/** Agent icons whose sessions gxserver can fork (desktop sidebar parity). */
export const FORK_AGENT_ICONS = ['codex', 'claude', 'pi', 'empryo'];

/**
 * True when gxserver can make a session of this agent icon (or agent id) a coordinator: any agent
 * since the user's Q2980 decision (COORDINATOR_AGENT_FAMILIES in packages/gx-protocol/src/coordinator.rs
 * of the Ghostex main repo; `coordinator_agent_family_supported`). A computer from before 2026-11-13
 * still refuses the agents outside its own list, and the phone says why.
 */
export function isCoordinatorAgent(agentIcon: string): boolean {
  return agentIcon.trim().length > 0;
}

const remoteMutationQueues = new Map<string, Promise<void>>();

export async function enqueueRemoteMutation(
  machineId: string,
  resourceKey: string,
  run: () => Promise<void>,
): Promise<void> {
  const queueKey = `${machineId}:${resourceKey}`;
  const previous = remoteMutationQueues.get(queueKey) ?? Promise.resolve();
  const scheduled = previous.catch(() => undefined).then(run);
  remoteMutationQueues.set(queueKey, scheduled);
  try {
    await scheduled;
  } finally {
    if (remoteMutationQueues.get(queueKey) === scheduled) {
      remoteMutationQueues.delete(queueKey);
    }
  }
}

export function pinMutation(sessionId: string, isPinned: boolean): OptimisticInventoryChange {
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { isPinned, ...(isPinned ? { isParked: false } : {}) },
    confirmPatch: { isPinned },
  };
}

export function parkMutation(sessionId: string, isParked: boolean): OptimisticInventoryChange {
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { isParked, ...(isParked ? { isPinned: false } : {}) },
    confirmPatch: { isParked },
  };
}

export function tagMutation(sessionId: string, tag: string): OptimisticInventoryChange {
  const sessionTag = tag === 'none' ? '' : tag;
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { sessionTag },
    confirmPatch: { sessionTag },
  };
}

/**
 * Session note write. The saved note is trimmed by gxserver before it reaches
 * presentation, so the optimistic row has to carry the trimmed text or the
 * confirmation would never match the server's own answer.
 */
export function sessionNoteMutation(sessionId: string, note: string): OptimisticInventoryChange {
  const sessionNote = note.trim();
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { sessionNote },
    confirmPatch: { sessionNote },
  };
}

/**
 * When to look again after a rename: gxserver shows the new name for 8 seconds while the agent
 * confirms it, then puts the reported name back and publishes the refused one as
 * `renameFailedTitle` (server/src/presentation/session_attributes.rs).
 */
export const RENAME_CONFIRM_REFRESH_MS = 8_500;

/**
 * CDXC:SessionTitles 2026-10-12 DECISION: User: after a rename the agent never confirmed, "the
 * user can rename again and he should see the new name he set there and be able to send it
 * again". Rename opens with that name until gxserver drops it (a confirmed or newer rename).
 */
export function renameInitialTitle(session: GhostexSession): string {
  return session.renameFailedTitle.length > 0 ? session.renameFailedTitle : session.title;
}

export function renameMutation(sessionId: string, title: string): OptimisticInventoryChange {
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { title, displayTitle: title, displayTitleTooltip: title },
    confirmPatch: { title },
  };
}

export function lifecycleMutation(sessionId: string, sleeping: boolean): OptimisticInventoryChange {
  return sleeping
    ? {
        kind: 'sessionPatch',
        sessionId,
        patch: {
          isSleeping: true,
          isLive: false,
          status: 'sleep',
          activity: 'sleep',
          nativePaneState: 'unmounted',
        },
        confirmPatch: { isSleeping: true },
      }
    : {
        kind: 'sessionPatch',
        sessionId,
        patch: {
          isSleeping: false,
          isLive: true,
          status: 'idle',
          activity: 'idle',
          nativePaneState: 'mounted',
        },
        confirmPatch: { isSleeping: false },
      };
}

export type RunSessionCommandOptions = {
  /** Drop this session's warm native surface before running (sleep/kill). */
  closeWarmSessionId?: string;
  optimisticChange?: OptimisticInventoryChange;
  /** Already-summarized failure text; callers render it in their own status UI. */
  onError?: (message: string) => void;
};

/**
 * Run one session-mutating CLI command with optimistic inventory bookkeeping:
 * begin → (queued) close warm surface → CLI → commit → fresh refresh, with a
 * rollback plus `onError` on any failure.
 *
 * Returns the command's parsed JSON result, or null when it failed — callers
 * that act on the daemon's answer (the agent rename request's
 * `shouldSendAgentRenameCommand`) read it; the rest ignore it.
 */
export async function runSessionCommand(
  target: MachineRecord,
  command: string,
  options?: RunSessionCommandOptions,
): Promise<CliJsonResult | null> {
  const inventory = useInventoryStore.getState();
  const mutationId =
    options?.optimisticChange === undefined
      ? null
      : inventory.beginOptimisticMutations(target.id, [options.optimisticChange])[0];
  const mutationIds = mutationId === null ? [] : [mutationId];
  let result: CliJsonResult | null = null;
  try {
    const run = async (): Promise<void> => {
      if (options?.closeWarmSessionId !== undefined) {
        await useTerminalStore.getState().closeWarmSessionFor(target.id, options.closeWarmSessionId);
      }
      result = await runGhostexCli(target, command);
      if (mutationIds.length > 0) {
        useInventoryStore.getState().commitOptimisticMutations(target.id, mutationIds);
      }
    };
    if (options?.optimisticChange === undefined) {
      await run();
    } else {
      await enqueueRemoteMutation(target.id, optimisticChangeResourceKey(options.optimisticChange), run);
    }
    await useInventoryStore.getState().refreshMachineFresh(target);
    return result;
  } catch (error) {
    if (mutationIds.length > 0) {
      useInventoryStore.getState().rollbackOptimisticMutations(target.id, mutationIds);
    }
    options?.onError?.(error instanceof Error ? error.message : String(error));
    return null;
  }
}
