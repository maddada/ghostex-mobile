/**
 * Keeps the phone's box registry and each box's session list current, on the Sessions screen's
 * 5-second poll: every reachable computer's `cloudBoxes list`, then each box's sessions, read from
 * its gxserver while it is up and from its cached rows while it is not (./boxSessions.ts).
 * Nothing here wakes a box: an asleep box is never called (Q1013).
 */

import { useInventoryStore, emptyMachineInventory } from '../inventory/store';
import { pushedCloudBoxes } from '../inventory/summaryStream';
import { enabledMachines, useMachinesStore, type MachineRecord } from '../machines/store';
import { chatMachineLink } from '../chat/rust/machine-link';
import { homeCloudBoxesRpc, forgetBoxLink } from './boxLink';
import { syncCloudKit } from './cloudKit';
import { refreshBoxesFromProviders } from './phoneStart';
import { boxSummaryFromPresentation, cachedBoxSummary } from './boxSessions';
import { boxMachineRecord, useCloudBoxesStore, type CloudBoxEntry } from './store';
import { cloudBoxMachineId, isReachable, type CloudBox, type CloudBoxSessionRow } from './types';
import type { GhostexMobileSummary } from '../contract/mobileSummary';

const LIST_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 15_000;

const inFlight = new Map<string, Promise<void>>();
/** A provider's list is read at most this often per computer that is off. */
const PROVIDER_READ_MS = 60_000;
const providerReadAt = new Map<string, number>();

function once(key: string, run: () => Promise<void>): Promise<void> {
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;
  const promise = run().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/** One computer's boxes, when its Ghostex answers. A computer that does not keeps its stored rows. */
export function refreshHomeBoxes(home: MachineRecord): Promise<void> {
  return once(`home:${home.id}`, async () => {
    // A computer that pushes the list on the sessions list stream is not asked (inventory/summaryStream.ts).
    const pushed = pushedCloudBoxes(home.id);
    let result: unknown = pushed;
    if (pushed === undefined) {
      const answer = await homeCloudBoxesRpc(home.id, 'list', {}, LIST_TIMEOUT_MS);
      if (answer.error !== null) return;
      result = answer.result;
    }
    const boxes = (result as { boxes?: CloudBox[] } | null)?.boxes;
    if (!Array.isArray(boxes)) return;
    // The computer answers: its cloud kit is read again when due (./cloudKit.ts).
    void syncCloudKit(home.id).catch(() => undefined);
    const before = useCloudBoxesStore.getState().entries;
    useCloudBoxesStore.getState().setHomeBoxes(home.id, boxes);
    const after = useCloudBoxesStore.getState().entries;
    for (const boxId of Object.keys(before)) {
      if (after[boxId] === undefined) {
        void forgetBoxLink(cloudBoxMachineId(boxId));
        dropBoxInventory(cloudBoxMachineId(boxId));
      }
    }
  });
}

function writeBoxInventory(machineId: string, summary: GhostexMobileSummary, error: string | null): void {
  const state = useInventoryStore.getState();
  const previous = state.inventoriesByMachineId[machineId] ?? emptyMachineInventory();
  const fingerprint = JSON.stringify(summary);
  if (previous.fingerprint === fingerprint && previous.lastError === error && previous.hasLoaded) return;
  useInventoryStore.setState({
    inventoriesByMachineId: {
      ...state.inventoriesByMachineId,
      [machineId]: {
        ...previous,
        summary,
        serverSummary: summary,
        fingerprint,
        hasLoaded: true,
        refreshing: false,
        lastError: error,
        lastErrorCode: error === null ? null : 'unknown',
      },
    },
  });
}

function dropBoxInventory(machineId: string): void {
  const state = useInventoryStore.getState();
  if (state.inventoriesByMachineId[machineId] === undefined) return;
  const next = { ...state.inventoriesByMachineId };
  delete next[machineId];
  useInventoryStore.setState({ inventoriesByMachineId: next });
}

/** One box's session list: its gxserver's while it is up, its cached rows while it is not. */
export function refreshBoxSessions(entry: CloudBoxEntry): Promise<void> {
  const machine = boxMachineRecord(entry);
  return once(`box:${machine.id}`, async () => {
    if (!isReachable(entry.box.state)) {
      writeBoxInventory(machine.id, cachedBoxSummary(entry), null);
      return;
    }
    const link = chatMachineLink(machine);
    await link.route();
    const answer = await link.rpc('readPresentationSnapshot', {}, READ_TIMEOUT_MS);
    const summary = answer.error === null ? boxSummaryFromPresentation(entry, answer.result) : null;
    if (summary !== null) {
      writeBoxInventory(machine.id, summary, null);
      void reportBoxSessions(entry, summary);
      return;
    }
    // Not answering yet (still connecting): keep what is shown, else the cached rows.
    const current = useInventoryStore.getState().inventoriesByMachineId[machine.id]?.summary;
    writeBoxInventory(machine.id, current ?? cachedBoxSummary(entry), answer.error?.message ?? null);
  });
}

/** The rows last reported per box, so an unchanged list is not sent again. */
const reported = new Map<string, string>();

/**
 * Tells the box's computer which sessions the box holds (`reportBoxSessions`), as the desktop does,
 * so a stopped box still lists them on every client and the archive rule can read them.
 */
async function reportBoxSessions(entry: CloudBoxEntry, summary: GhostexMobileSummary): Promise<void> {
  const sessions: CloudBoxSessionRow[] = summary.sessions.map((session) => ({
    projectId: session.projectId,
    sessionId: session.sessionId,
    title: session.displayTitle,
    ...(session.agent.length > 0 ? { agentId: session.agent } : {}),
    ...(session.gitBranch !== undefined && session.gitBranch.length > 0 ? { branch: session.gitBranch } : {}),
    ...(session.agentSessionId.length > 0 ? { agentSessionId: session.agentSessionId } : {}),
    ...(session.lastActiveAt.length > 0 ? { lastActiveAt: session.lastActiveAt } : {}),
  }));
  const fingerprint = JSON.stringify(sessions);
  if (reported.get(entry.box.boxId) === fingerprint || entry.source !== 'home') return;
  const answer = await homeCloudBoxesRpc(entry.homeMachineId, 'reportBoxSessions', {
    boxId: entry.box.boxId,
    sessions,
  });
  if (answer.error === null) reported.set(entry.box.boxId, fingerprint);
}

/** The poll's step: every computer's boxes, then every box's sessions. */
export async function refreshCloudBoxes(): Promise<void> {
  await useCloudBoxesStore.getState().load();
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const homes = enabledMachines(useMachinesStore.getState()).filter(
    (machine) => inventories[machine.id]?.hasLoaded === true && inventories[machine.id]?.lastError === null,
  );
  await Promise.all(homes.map((home) => refreshHomeBoxes(home)));
  // A computer that is off: its boxes' states come from the providers, with the phone's cloud kit.
  const offline = enabledMachines(useMachinesStore.getState()).filter(
    (machine) => inventories[machine.id]?.hasLoaded === true && inventories[machine.id]?.lastError !== null,
  );
  await Promise.all(
    offline.map((home) => {
      if (Date.now() - (providerReadAt.get(home.id) ?? 0) < PROVIDER_READ_MS) return Promise.resolve();
      providerReadAt.set(home.id, Date.now());
      return once(`provider:${home.id}`, () => refreshBoxesFromProviders(home.id).catch(() => undefined));
    }),
  );
  const entries = Object.values(useCloudBoxesStore.getState().entries);
  await Promise.all(entries.map((entry) => refreshBoxSessions(entry)));
}
