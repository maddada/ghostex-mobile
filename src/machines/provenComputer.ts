/**
 * Which computers a saved Easy Connect record has been shown to reach.
 *
 * CDXC:RemotePairing 2026-11-11 WHY:
 * A record proves a computer's key by connecting through an address that carries it: the SSH login
 * there succeeded with that record's own credentials, so the computer behind the key is the one
 * the record was paired with. The keys are kept per record (their server keys only, never an
 * address), so two records for one computer can be told apart from two computers even when the
 * addresses they paired with differ, which is what a pairing code's door address causes since
 * 11.3.0 (machines/computerIdentity.ts). An address a computer only names in its list is not
 * recorded here until a connect through it succeeded.
 *
 * CDXC:RemotePairing 2026-11-11 WHY:
 * Review of the first version (finding 1): a record paired again with a DIFFERENT computer (Edit >
 * Re-pair, "Scan a new code", a pasted code) kept the keys it had proven for the computer before.
 * When that computer was later added again, its new record shared a key with the re-paired one, so
 * the re-paired record, the only login for the other computer, was hidden and then merged away. A
 * proof therefore belongs to the pairing it was made under: it is stored with the key of the
 * address the record was paired with when the connect began, and counts only while the record is
 * still paired with that address. Changing a record's paired address, by pairing or by editing
 * it, makes every earlier proof void without anything having to remember to wipe it, and a
 * connect that began before the change cannot prove anything for the pairing after it. The store
 * also drops a record's proofs when its address changes, and when it is removed or merged away
 * (finding 4).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { tailcatServerKey } from './computerIdentity';

/** `{ [machineId]: { paired: serverKey, keys: serverKey[] } }`, the keys newest first. */
export const PROVEN_SERVER_KEYS_STORAGE_KEY = 'machines.provenServerKeys.v1';
/** A computer has two addresses and a door; a few more leave room for a relay that changed. */
const KEYS_PER_MACHINE = 6;

/** What a record proved while it was paired with the address whose key is `paired`. */
type StoredProof = { paired: string; keys: string[] };
type StoredProofs = Record<string, StoredProof>;

/** The proven keys that count now, by machine id. */
export type ProvenServerKeys = Record<string, string[]>;

async function loadStoredProofs(): Promise<StoredProofs> {
  try {
    const raw = await AsyncStorage.getItem(PROVEN_SERVER_KEYS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const stored: StoredProofs = {};
    for (const [machineId, value] of Object.entries(parsed)) {
      if (typeof value !== 'object' || value === null) continue;
      const { paired, keys } = value as { paired?: unknown; keys?: unknown };
      if (typeof paired !== 'string' || !Array.isArray(keys)) continue;
      stored[machineId] = { paired, keys: keys.filter((key): key is string => typeof key === 'string') };
    }
    return stored;
  } catch {
    return {};
  }
}

/**
 * Every record's proven keys that still count: those proven under the address the record is paired
 * with now (`pairedAddressOf`, null when it has none).
 */
export async function loadProvenServerKeys(
  pairedAddressOf: (machineId: string) => string | null,
): Promise<ProvenServerKeys> {
  const proven: ProvenServerKeys = {};
  for (const [machineId, proof] of Object.entries(await loadStoredProofs())) {
    const pairedAddress = pairedAddressOf(machineId);
    if (pairedAddress !== null && tailcatServerKey(pairedAddress) === proof.paired) proven[machineId] = proof.keys;
  }
  return proven;
}

let writes: Promise<unknown> = Promise.resolve();

/** One change at a time: two computers connecting at once must not overwrite each other's entry. */
function changeStoredProofs(change: (stored: StoredProofs) => boolean): Promise<void> {
  const next = writes.then(async () => {
    const stored = await loadStoredProofs();
    if (change(stored)) await AsyncStorage.setItem(PROVEN_SERVER_KEYS_STORAGE_KEY, JSON.stringify(stored));
  });
  writes = next.catch(() => undefined);
  return next.catch(() => undefined);
}

/**
 * Records that `machineId` connected through `address` in an attempt that began while it was paired
 * with `pairedAddress`. Resolves once it is saved; nothing is recorded for an address without a key
 * this app can read.
 */
export function recordProvenAddress(machineId: string, pairedAddress: string | null, address: string): Promise<void> {
  const paired = pairedAddress === null ? null : tailcatServerKey(pairedAddress);
  const key = tailcatServerKey(address);
  if (paired === null || key === null) return Promise.resolve();
  return changeStoredProofs((stored) => {
    const known = stored[machineId];
    if (known !== undefined && known.paired === paired) {
      if (known.keys.includes(key)) return false;
      known.keys = [key, ...known.keys].slice(0, KEYS_PER_MACHINE);
      return true;
    }
    // The first proof of this pairing; what an earlier pairing proved goes.
    stored[machineId] = { paired, keys: [key] };
    return true;
  });
}

/** Drops everything these records proved: they were removed, merged away, or given another address. */
export function forgetProvenServerKeys(machineIds: readonly string[]): Promise<void> {
  return changeStoredProofs((stored) => {
    let changed = false;
    for (const machineId of machineIds) {
      if (machineId in stored) {
        delete stored[machineId];
        changed = true;
      }
    }
    return changed;
  });
}
