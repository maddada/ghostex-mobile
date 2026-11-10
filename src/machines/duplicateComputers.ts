/**
 * Stops using an older record for a computer the moment a newer record of it has connected.
 *
 * CDXC:RemotePairing 2026-11-11 WHY:
 * Coordinator's brief: "recognise a newly scanned computer as one it already has (by what
 * identifies the computer, not by the address), replace the old entry, and on start merge
 * duplicates that already exist, keeping the one that works; never drop an entry for a different
 * computer." The start-up merge (`healDuplicateComputers` in store.ts) runs before anything
 * connects, so it can only use what earlier connects proved. A phone that just took this update
 * has proved nothing yet, and a pairing made a moment ago has not connected either. So each
 * successful connect records the key it went through and looks again: when the record that just
 * connected is the one its group keeps (the newest pairing, which is the one the computer still
 * accepts), the others are hidden and disconnected at once, which ends the two tunnels on one key
 * straight away, and the next start merges them into it with their saved data. Hiding is the
 * app's own switch for a computer, so nothing is deleted while the app runs.
 */
import { logAppEvent } from '../app/appLog';
import { staleDuplicatesOf } from './computerIdentity';
import { getTailcatToken } from './credentials';
import { recordProvenAddress } from './provenComputer';
import { useMachinesStore } from './store';

/**
 * `machineId` connected through `address`. `disconnect` ends a record's connection and tunnel
 * (given by the caller, which owns them).
 */
export function noteConnectedThrough(
  machineId: string,
  address: string,
  disconnect: (staleMachineId: string) => void,
): void {
  void (async () => {
    const proven = await recordProvenAddress(machineId, address);
    if (proven === null) return;
    const { machines } = useMachinesStore.getState();
    const tailcat = machines.filter((machine) => machine.transport === 'tailcat');
    if (tailcat.length < 2) return;
    const tokens = new Map<string, string | null>(
      await Promise.all(tailcat.map(async (machine) => [machine.id, await getTailcatToken(machine.id)] as const)),
    );
    const stale = staleDuplicatesOf(
      machines,
      (id) => tokens.get(id) ?? null,
      (id) => proven[id] ?? [],
      machineId,
    );
    for (const staleId of stale) {
      const record = useMachinesStore.getState().machines.find((machine) => machine.id === staleId);
      if (record === undefined || record.disabled === true) continue;
      logAppEvent(
        `Easy Connect: ${staleId} is an older entry for the computer ${machineId} just reached; hidden now, merged the next time the app opens`,
      );
      useMachinesStore.getState().setMachineDisabled(staleId, true);
      disconnect(staleId);
    }
  })().catch(() => undefined);
}
