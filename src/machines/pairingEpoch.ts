/**
 * Which pairing of an entry a piece of work began under.
 *
 * CDXC:RemotePairing 2026-11-11 WHY:
 * Found while fixing the review's finding 1: no re-pair path stopped a connect that was already
 * running. A connect to computer A that began before entry R was paired again with B (Edit >
 * Re-pair, "Scan a new code", the security notice, a pasted code) or had its address edited could
 * still finish, and what it brought back was saved onto R: A's address list (R then dialled A's
 * addresses until the list refreshed), the chat link's endpoint and the "own key accepted" mark for
 * A, the inventory, the connection itself (R then looked connected while it rode A's link). Each
 * entry now has a pairing epoch, bumped by the store whenever the address it is paired with changes
 * key or it is removed (`notePairingChanged`). The connection code ends the entry's running connect
 * and tunnel when it is bumped (remote/connection.ts), and everything that saves a late result onto
 * an entry first checks that the epoch it began under is still the entry's. In memory only: nothing
 * outlives the app run that started it.
 */

const epochs = new Map<string, number>();
const listeners = new Set<(machineId: string) => void>();

/** The entry's pairing epoch now; work that saves a result onto the entry keeps this to check. */
export function pairingEpoch(machineId: string): number {
  return epochs.get(machineId) ?? 0;
}

/** Whether `machineId` is still paired as it was when `epoch` was read. */
export function samePairing(machineId: string, epoch: number): boolean {
  return pairingEpoch(machineId) === epoch;
}

/**
 * The entry was paired with another key, had its address edited to one, left Easy Connect or was
 * removed: work begun before this no longer belongs to it.
 */
export function notePairingChanged(machineId: string): void {
  epochs.set(machineId, pairingEpoch(machineId) + 1);
  for (const listener of listeners) {
    try {
      listener(machineId);
    } catch {
      // One listener failing must not keep the others from stopping their work.
    }
  }
}

/** Runs `listener` each time an entry's pairing changes; returns the unsubscribe. */
export function onPairingChanged(listener: (machineId: string) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
