/**
 * A computer's agent CLIs, skills and tools on the phone's Edit machine screen: reads and installs
 * them through that computer's own gxserver, over the forward the chat link already holds, with
 * the calls Settings > Agents and Settings > Integrations make on the desktop with that machine
 * picked (`/api/agentCliMaintenance`, `/api/machineIntegrations`, `/api/managedTools`).
 *
 * CDXC:RemoteMachines 2026-10-26 DECISION:
 * User (Q609), asked whether the phone gets the desktop's machine picker: "Yes, add them to the
 * phone." Each computer's Edit machine screen shows Agent CLIs and Skills and tools, with the
 * desktop's states: a computer the phone can't reach, one whose Ghostex is too old for a call, and
 * items its platform can't have (SpaceO and Fast Computer & Browser Use only on a Mac). Desktop
 * control tools that still need macOS grants say that only someone at that Mac can allow them.
 * SEE-ALSO: apps/desktop/src/app/window/settings_modal/tabs/machine_picker.rs (the desktop's
 * picker), server/src/machine_integrations.rs, server/src/managed_tools/desktop_control.rs.
 */

import { FailureCopy } from '../copy';
import { EditMachineCopy } from '../copy/machines';
import { create } from 'zustand';

import { chatMachineLink, unreachableMessage } from '../chat/rust/machine-link';
import { isDemoMachine } from '../demo/identity';
import type { MachineConnectionTarget } from './credentials';
import { machineNameById } from './store';
import {
  answerError,
  jobActive,
  tooOldMessage,
  type AgentCli,
  type MachineIntegrations,
  type ManagedTool,
  type RowAction,
} from './machineToolsView';

export * from './machineToolsView';

const READ_TIMEOUT_MS = 60_000;
const POLL_MS = 2_000;
/** A job is followed this long before the phone stops reading it. */
const FOLLOW_LIMIT_MS = 20 * 60_000;

type Part<T> = { data: T | null; error: string | null };

export type MachineTools = {
  agents: Part<AgentCli[]>;
  tools: Part<ManagedTool[]>;
  integrations: Part<MachineIntegrations>;
  /** A read is in flight. */
  reading: boolean;
  /** What a tap started and has not come back yet, by row key (`agent:codex`, `tool:node`, `skill:ghostex-cli`). */
  starting: Record<string, true>;
  /** The last action that failed, in words, by row key. */
  failed: Record<string, string>;
  /** What the last action did, in words, by row key (the Ghostex CLI row's Repair). */
  done: Record<string, string>;
  following: boolean;
  refreshedAt: number | null;
};

const EMPTY_PART = { data: null, error: null };
const EMPTY: MachineTools = {
  agents: EMPTY_PART,
  tools: EMPTY_PART,
  integrations: EMPTY_PART,
  reading: false,
  starting: {},
  failed: {},
  done: {},
  following: false,
  refreshedAt: null,
};

export const useMachineToolsStore = create<{ byMachineId: Record<string, MachineTools> }>(() => ({
  byMachineId: {},
}));

function current(machineId: string): MachineTools {
  return useMachineToolsStore.getState().byMachineId[machineId] ?? EMPTY;
}

function patch(machineId: string, change: (tools: MachineTools) => Partial<MachineTools>): void {
  useMachineToolsStore.setState((state) => {
    const before = state.byMachineId[machineId] ?? EMPTY;
    return { byMachineId: { ...state.byMachineId, [machineId]: { ...before, ...change(before) } } };
  });
}

/** Whether anything on the computer is still installing (the screen keeps reading it). */
export function anyJobActive(tools: MachineTools): boolean {
  return (
    (tools.agents.data ?? []).some((agent) => jobActive(agent.job)) ||
    (tools.tools.data ?? []).some((tool) => jobActive(tool.job))
  );
}

// ---- requests -----------------------------------------------------------------------------------

type Answer<T> = { result: T } | { error: string };

async function call<T>(machine: MachineConnectionTarget, method: string, params: unknown): Promise<Answer<T>> {
  const link = chatMachineLink(machine);
  const route = await link.routeOrRepair();
  const computer = machineNameById(machine.id);
  if (route === 'legacy') return { error: tooOldMessage(computer) };
  if (route !== 'socket') return { error: link.routeBusy() ? FailureCopy.channelsBusy : unreachableMessage(computer) };
  const answer = await link.rpc(method, params, READ_TIMEOUT_MS);
  if (answer.error !== null) return { error: answerError(answer.error, unreachableMessage(computer), computer) };
  return { result: answer.result as T };
}

function part<T>(answer: Answer<unknown>, pick: (result: unknown) => T | null): Part<T> {
  if ('error' in answer) return { data: null, error: answer.error };
  const data = pick(answer.result);
  return data === null ? { data: null, error: "The computer's answer couldn't be read." } : { data, error: null };
}

function listOf<T>(key: string): (result: unknown) => T[] | null {
  return (result) => {
    const list = (result as Record<string, unknown> | null)?.[key];
    return Array.isArray(list) ? (list as T[]) : null;
  };
}

/** Reads the computer's agent CLIs, integrations and tools, unless a read is running or the answer is fresh. */
export async function refreshMachineTools(
  machine: MachineConnectionTarget,
  options: { ifOlderThanMs?: number } = {},
): Promise<void> {
  if (isDemoMachine(machine)) return;
  const before = current(machine.id);
  if (before.reading) return;
  if (
    options.ifOlderThanMs !== undefined &&
    before.refreshedAt !== null &&
    Date.now() - before.refreshedAt < options.ifOlderThanMs
  )
    return;
  patch(machine.id, () => ({ reading: true }));
  const [agents, integrations, tools] = await Promise.all([
    call(machine, 'agentCliMaintenance', { action: 'list' }),
    call(machine, 'machineIntegrations', { action: 'status' }),
    call(machine, 'managedTools', { action: 'list', includeDesktopControl: true }),
  ]);
  patch(machine.id, () => ({
    reading: false,
    refreshedAt: Date.now(),
    agents: part(agents, listOf<AgentCli>('agents')),
    tools: part(tools, listOf<ManagedTool>('tools')),
    integrations: part(integrations, (result) =>
      typeof result === 'object' && result !== null ? (result as MachineIntegrations) : null,
    ),
  }));
  if (anyJobActive(current(machine.id))) void follow(machine);
}

/** A row's action: install or update an agent CLI or a tool, install or remove a skill. */
export async function runRowAction(machine: MachineConnectionTarget, key: string, action: RowAction): Promise<void> {
  if (current(machine.id).starting[key]) return;
  patch(machine.id, (tools) => ({
    starting: { ...tools.starting, [key]: true },
    failed: Object.fromEntries(Object.entries(tools.failed).filter(([failedKey]) => failedKey !== key)),
  }));
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  let answer: Answer<unknown>;
  if (kind === 'agent') {
    answer = await call(machine, 'agentCliMaintenance', {
      action: 'start',
      agentId: id,
      operation: action.operation,
      methodId: action.methodId,
    });
  } else if (kind === 'tool' && action.operation === 'retry') {
    // A tool that wasn't answering is checked again; the list below shows the result.
    answer = await call(machine, 'managedTools', { action: 'read', tool: id, fresh: true });
  } else if (kind === 'cli') {
    // CDXC:Cli 2026-11-25 DECISION: User (Q115 "yes"): the phone's Ghostex CLI row gets Repair, which adds the PATH line to that computer's shell startup file through its gxserver (server/src/machine_integrations.rs `addCliFolderToPath`), shown only when that computer offers it (`ghostexCli.pathFix`).
    answer = await call(machine, 'machineIntegrations', { action: 'addCliFolderToPath' });
  } else if (kind === 'tool') {
    answer = await call(machine, 'managedTools', { action: 'start', tool: id, operation: action.operation });
  } else {
    answer = await call(machine, 'machineIntegrations', { action: action.operation, skillName: id });
  }
  patch(machine.id, (tools) => {
    const starting = { ...tools.starting };
    delete starting[key];
    const change: Partial<MachineTools> = { starting };
    if ('error' in answer) change.failed = { ...tools.failed, [key]: answer.error };
    else if (kind === 'cli') change.done = { ...tools.done, [key]: cliRepairDone(answer.result) };
    else if (kind === 'skill') change.integrations = { data: answer.result as MachineIntegrations, error: null };
    return change;
  });
  if (kind !== 'skill') {
    // Read everything again; for the Ghostex CLI row that is the integrations with its new PATH.
    patch(machine.id, () => ({ refreshedAt: null }));
    await refreshMachineTools(machine);
  }
}

/** Repair's answer in words: which files got the line, or which already had it. */
function cliRepairDone(result: unknown): string {
  const files = ((result as { files?: unknown } | null)?.files ?? []) as { path?: string; added?: boolean }[];
  const named = (added: boolean) =>
    files
      .filter((file) => file.added === added && typeof file.path === 'string')
      .map((file) => file.path)
      .join(' and ');
  const added = named(true);
  return added !== ''
    ? EditMachineCopy.machineTools.cliPathAdded(added)
    : EditMachineCopy.machineTools.cliPathAlready(named(false));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Reads again every two seconds while an install runs on the computer. */
async function follow(machine: MachineConnectionTarget): Promise<void> {
  if (current(machine.id).following) return;
  patch(machine.id, () => ({ following: true }));
  const started = Date.now();
  try {
    while (Date.now() - started < FOLLOW_LIMIT_MS) {
      await sleep(POLL_MS);
      patch(machine.id, () => ({ refreshedAt: null }));
      const before = current(machine.id);
      if (!before.reading) {
        patch(machine.id, () => ({ reading: true }));
        const [agents, tools] = await Promise.all([
          call(machine, 'agentCliMaintenance', { action: 'list' }),
          call(machine, 'managedTools', { action: 'list', includeDesktopControl: true }),
        ]);
        patch(machine.id, (state) => ({
          reading: false,
          refreshedAt: Date.now(),
          // A read lost while the computer is busy keeps the last answer.
          agents: 'error' in agents ? state.agents : part(agents, listOf<AgentCli>('agents')),
          tools: 'error' in tools ? state.tools : part(tools, listOf<ManagedTool>('tools')),
        }));
      }
      if (!anyJobActive(current(machine.id))) return;
    }
  } finally {
    patch(machine.id, () => ({ following: false }));
  }
}
