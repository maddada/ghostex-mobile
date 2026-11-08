/**
 * The phone's half of the chat's offline-computer card and the messages held for it
 * (gx-chat-core `session/computer.rs`; the desktop's half is
 * `apps/desktop/src/app/remote_conn/chat_computers.rs`).
 *
 * CDXC:RemoteMachines 2026-11-08 DECISION:
 * User, on the offline-notice page: the phone gets the same card and hold in this release
 * ("same release", Q1839). Every chat on the phone is on another computer, so it is always
 * `remote`; offline is the inventory's own test for a computer whose last poll failed. A message
 * held while it is offline waits on the gxserver of another of the phone's computers that has been
 * connected to it (`knowsComputer`, server/src/connected_computers/held_sends.rs): the page's "a
 * message held from the phone would go to whichever computer the phone is connected to". With no
 * such computer the hold is refused and the text goes back to the box.
 */

import type { MachineConnectionTarget } from '../../machines/credentials';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore, type MachineRecord } from '../../machines/store';
import { sessionChatRpc, type RpcAnswer } from './transport';

/** What the core reads (`SessionComputer` in gx-chat-core). */
export type ChatSessionComputer = {
  name: string;
  remote: boolean;
  offline: boolean;
  lastSeenMs?: number;
  serverId?: string;
  answeredAtMs?: number;
};

/** The three calls that go to the computer holding the message, never the session's own. */
export const HELD_SEND_METHODS: ReadonlySet<string> = new Set([
  'holdSessionChatSend',
  'listHeldSessionChatSends',
  'cancelHeldSessionChatSend',
]);

/** How long the check a chat asks for waits for the computer to answer. */
const CHECK_TIMEOUT_MS = 4_000;

/** What the last check of each machine found, until its inventory loads again. */
const checks = new Map<string, { silent: boolean; answeredAtMs?: number }>();
const checkListeners = new Set<() => void>();

function machineName(machine: MachineRecord | undefined): string {
  if (machine === undefined) return 'The computer';
  return (machine.computerName ?? machine.name).trim() || machine.username || 'The computer';
}

/** The session's Global Ref names its computer's gxserver: `<serverId>:<projectId>:<sessionId>`. */
function serverIdOf(machineId: string, projectId: string, sessionId: string): string | undefined {
  const sessions = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary?.sessions ?? [];
  const globalRef = sessions.find(
    (session) => session.projectId === projectId && session.sessionId === sessionId,
  )?.globalRef;
  const serverId = globalRef?.split(':')[0];
  return serverId !== undefined && serverId.length > 0 ? serverId : undefined;
}

/** What the core is told about the chat's computer now. */
export function sessionComputer(machineId: string, projectId: string, sessionId: string): ChatSessionComputer {
  const machine = useMachinesStore.getState().machines.find((candidate) => candidate.id === machineId);
  const inventory = useInventoryStore.getState().inventoriesByMachineId[machineId];
  const check = checks.get(machineId);
  const pollFailed = inventory !== undefined && inventory.hasLoaded && inventory.lastError !== null;
  const offline = pollFailed || check?.silent === true;
  const lastSeen = machine?.lastConnectedAt != null ? Date.parse(machine.lastConnectedAt) : NaN;
  const computer: ChatSessionComputer = { name: machineName(machine), remote: true, offline };
  if (offline && Number.isFinite(lastSeen)) computer.lastSeenMs = lastSeen;
  const serverId = serverIdOf(machineId, projectId, sessionId);
  if (serverId !== undefined) computer.serverId = serverId;
  if (check?.answeredAtMs !== undefined) computer.answeredAtMs = check.answeredAtMs;
  return computer;
}

/** Calls `listener` whenever what the chat's computer looks like changes. */
export function subscribeSessionComputer(
  machineId: string,
  projectId: string,
  sessionId: string,
  listener: (computer: ChatSessionComputer) => void,
): () => void {
  let last = JSON.stringify(sessionComputer(machineId, projectId, sessionId));
  const recheck = () => {
    const inventory = useInventoryStore.getState().inventoriesByMachineId[machineId];
    // A poll that loaded again ends a silent check.
    if (inventory?.lastError === null && checks.get(machineId)?.silent === true) {
      checks.set(machineId, { ...checks.get(machineId), silent: false });
    }
    const next = sessionComputer(machineId, projectId, sessionId);
    const key = JSON.stringify(next);
    if (key === last) return;
    last = key;
    listener(next);
  };
  const unsubscribeInventory = useInventoryStore.subscribe((state, previous) => {
    if (state.inventoriesByMachineId[machineId] !== previous.inventoriesByMachineId[machineId]) recheck();
  });
  const unsubscribeMachines = useMachinesStore.subscribe((state, previous) => {
    if (state.machines !== previous.machines) recheck();
  });
  checkListeners.add(recheck);
  return () => {
    unsubscribeInventory();
    unsubscribeMachines();
    checkListeners.delete(recheck);
  };
}

/**
 * A message to the chat's computer got no answer for 10 s (Q1838 "check fast"): ask it directly
 * instead of waiting for the next poll to fail.
 */
export async function checkComputer(machine: MachineConnectionTarget): Promise<void> {
  const answer = await Promise.race([
    sessionChatRpc(machine, 'listHeldSessionChatSends', {}, CHECK_TIMEOUT_MS),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), CHECK_TIMEOUT_MS + 500)),
  ]);
  const answered = answer !== null && answer.error?.code !== 'unreachable';
  checks.set(machine.id, answered ? { silent: false, answeredAtMs: Date.now() } : { silent: true });
  for (const listener of [...checkListeners]) listener();
}

/** The phone's computer whose gxserver holds this chat's messages, once one was found. */
const holders = new Map<string, string>();

/**
 * Sends one of the three held-message calls to a computer of the phone's that has been connected
 * to the chat's offline computer: the one that took the last hold, else the first that says it
 * knows it.
 */
export async function heldSendRpc(
  chatMachineId: string,
  chatKey: string,
  method: string,
  fields: Record<string, unknown>,
): Promise<RpcAnswer> {
  const endpoint = `/api/${method}`;
  const serverId = typeof fields.serverId === 'string' ? fields.serverId : '';
  const machines = useMachinesStore.getState().machines;
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const reachable = machines.filter(
    (machine) =>
      machine.id !== chatMachineId &&
      machine.disabled !== true &&
      inventories[machine.id]?.hasLoaded === true &&
      inventories[machine.id]?.lastError === null,
  );
  const known = holders.get(chatKey);
  let holder = reachable.find((machine) => machine.id === known);
  if (holder === undefined && serverId.length > 0) {
    for (const machine of reachable) {
      const asked = await sessionChatRpc(machine, 'listHeldSessionChatSends', { serverId }, CHECK_TIMEOUT_MS * 2);
      const result = asked.error === null ? (asked.result as { knowsComputer?: unknown } | null) : null;
      if (result?.knowsComputer === true) {
        holder = machine;
        holders.set(chatKey, machine.id);
        break;
      }
    }
  }
  if (holder === undefined) {
    // Nothing holds anything for this chat: an empty list, and a hold that goes back to the box.
    if (method === 'listHeldSessionChatSends') return { result: { sends: [] }, error: null };
    return {
      error: {
        code: 'noHoldComputer',
        message: 'none of your other computers is connected to it, so it can’t wait for it.',
        endpoint,
      },
    };
  }
  return sessionChatRpc(holder, method, fields);
}
