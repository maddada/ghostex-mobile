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
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { tailcatServerKey } from './computerIdentity';

/** `{ [machineId]: serverKey[] }`, newest first. Renamed with the records by `migrateMachineData`. */
export const PROVEN_SERVER_KEYS_STORAGE_KEY = 'machines.provenServerKeys.v1';
/** A computer has two addresses and a door; a few more leave room for a relay that changed. */
const KEYS_PER_MACHINE = 6;

export type ProvenServerKeys = Record<string, string[]>;

export async function loadProvenServerKeys(): Promise<ProvenServerKeys> {
  try {
    const raw = await AsyncStorage.getItem(PROVEN_SERVER_KEYS_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const proven: ProvenServerKeys = {};
    for (const [machineId, keys] of Object.entries(parsed)) {
      if (Array.isArray(keys)) proven[machineId] = keys.filter((key): key is string => typeof key === 'string');
    }
    return proven;
  } catch {
    return {};
  }
}

let writes: Promise<unknown> = Promise.resolve();

/**
 * Records that `machineId` connected through `address`, and resolves with every record's proven
 * keys afterwards; null when the address carries no key this app can read.
 */
export function recordProvenAddress(machineId: string, address: string): Promise<ProvenServerKeys | null> {
  const key = tailcatServerKey(address);
  if (key === null) return Promise.resolve(null);
  // One at a time: two computers connecting at once must not overwrite each other's entry.
  const next = writes.then(async () => {
    const proven = await loadProvenServerKeys();
    const known = proven[machineId] ?? [];
    if (!known.includes(key)) {
      proven[machineId] = [key, ...known].slice(0, KEYS_PER_MACHINE);
      await AsyncStorage.setItem(PROVEN_SERVER_KEYS_STORAGE_KEY, JSON.stringify(proven));
    }
    return proven;
  });
  writes = next.catch(() => undefined);
  return next.catch(() => null);
}
