/**
 * Dialing an Easy Connect computer at its best address: the order (`easyConnectAddresses.ts`), the
 * phone's own check of a relay before it dials it, what each attempt says in the device log, and
 * fetching the computer's addresses after a connect.
 *
 * Every line here is `[easy-connect] …` in the device log and names the machine id and the relay,
 * never an address, which is a secret.
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import {
  getEasyConnectAddresses,
  getTailcatToken,
  setEasyConnectAddresses,
  type MachineConnectionTarget,
} from './credentials';
import { tailcatServerKey } from './computerIdentity';
import { noteEasyConnectOn } from './easyConnectRoute';
import { samePairing } from './pairingEpoch';
import {
  addressesNeedRefresh,
  decodeSavedAddresses,
  dialErrorText,
  easyConnectDialOrder,
  encodeSavedAddresses,
  failedDialParams,
  readEasyConnectAddresses,
  type DialCandidate,
  type FailedDialReport,
} from './easyConnectAddresses';

/** An address that failed waits behind the others this long. */
const FAILURE_HOLD_MS = 10 * 60 * 1000;
/** A relay that does not answer `/generate_204` this fast is treated as down for this dial. */
const RELAY_CHECK_TIMEOUT_MS = 3_000;
const RELAY_CHECK_TTL_MS = 60_000;
/** Waits after a connect before asking for the list, so the connect's own work goes first. */
const REFRESH_DELAY_MS = 3_000;
const REFRESH_TIMEOUT_MS = 10_000;
/** A computer that could not answer (an older Ghostex, no chat link) is asked again after this. */
const REFRESH_RETRY_MS = 60 * 60 * 1000;

const failedAt = new Map<string, number>();
const relayChecks = new Map<string, { at: number; up: boolean }>();
const refreshing = new Set<string>();
const lastRefreshAttempt = new Map<string, number>();
/** The last address each machine gave up on, until the machine has been told. */
const unreportedFailures = new Map<string, FailedDialReport>();

/** Whether the relay answers derper's empty `/generate_204`, cached for a minute. */
async function relayAnswers(relay: string): Promise<boolean> {
  const cached = relayChecks.get(relay);
  if (cached !== undefined && Date.now() - cached.at < RELAY_CHECK_TTL_MS) return cached.up;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELAY_CHECK_TIMEOUT_MS);
  let up = false;
  try {
    const response = await fetch(`https://${relay}/generate_204`, { method: 'GET', signal: controller.signal });
    up = response.status === 204 || response.ok;
  } catch {
    up = false;
  } finally {
    clearTimeout(timer);
  }
  relayChecks.set(relay, { at: Date.now(), up });
  if (!up) console.info(`[easy-connect] relay ${relay} did not answer its check; dialing it last`);
  return up;
}

/** The addresses to dial for an Easy Connect machine, best first; empty when none is saved. */
export async function easyConnectDialCandidates(machineId: string): Promise<DialCandidate[]> {
  const [paired, savedText] = await Promise.all([getTailcatToken(machineId), getEasyConnectAddresses(machineId)]);
  const saved = decodeSavedAddresses(savedText, paired);
  const relays = [
    ...new Set((saved?.addresses ?? []).filter((entry) => entry.kind !== 'public').map((entry) => entry.relay)),
  ];
  const down = new Set<string>();
  await Promise.all(
    relays.map(async (relay) => {
      if (!(await relayAnswers(relay))) down.add(relay);
    }),
  );
  return easyConnectDialOrder({
    paired,
    saved,
    failedRecently: (address) => Date.now() - (failedAt.get(address) ?? 0) < FAILURE_HOLD_MS,
    relayDown: (relay) => down.has(relay),
  });
}

/**
 * Records one dial for the device log and the next order. The log line is what the phone's share
 * of each relay is counted from (CDXC:RemotePairing 2026-11-06 in server/src/tailcat/link_log.rs).
 */
export function noteEasyConnectDial(
  machineId: string,
  candidate: DialCandidate,
  outcome:
    | { ok: true; elapsedMs: number }
    | { ok: false; elapsedMs: number; next: DialCandidate | null; error?: unknown },
): void {
  if (outcome.ok) {
    failedAt.delete(candidate.address);
    console.info(
      `[easy-connect] ${machineId} connected via ${candidate.relay} (${candidate.kind}) in ${outcome.elapsedMs}ms`,
    );
    return;
  }
  const now = Date.now();
  failedAt.set(candidate.address, now);
  const error = dialErrorText(outcome.error ?? 'unknown');
  unreportedFailures.set(machineId, {
    relay: candidate.relay,
    kind: candidate.kind,
    elapsedMs: outcome.elapsedMs,
    error,
    failedAt: now,
  });
  console.warn(
    `[easy-connect] ${machineId} could not connect via ${candidate.relay} (${candidate.kind}) after ${outcome.elapsedMs}ms: ${error}` +
      (outcome.next === null ? '' : `; trying ${outcome.next.relay} (${outcome.next.kind})`),
  );
}

/**
 * Saves a computer's address list, asked for while the entry was paired with `pairedAddress` (the
 * list is read only while it still is, `decodeSavedAddresses`); returns false (and keeps the old
 * one) when it names none.
 */
export async function saveEasyConnectAddresses(
  machineId: string,
  value: unknown,
  pairedAddress: string | null,
): Promise<boolean> {
  const addresses = readEasyConnectAddresses(value);
  if (addresses.length === 0) return false;
  const pairedKey = pairedAddress === null ? null : tailcatServerKey(pairedAddress);
  await setEasyConnectAddresses(
    machineId,
    encodeSavedAddresses({ fetchedAt: Date.now(), addresses, ...(pairedKey === null ? {} : { pairedKey }) }),
  );
  console.info(
    `[easy-connect] ${machineId} saved ${addresses.length} address(es): ${addresses
      .map((entry) => `${entry.relay} (${entry.kind})`)
      .join(', ')}`,
  );
  return true;
}

/**
 * After a connect, asks the computer for its addresses (`/api/easyConnectAddresses`, with the
 * phone's device token over the chat link) when the saved list is missing or older than the
 * refresh interval, or at once when this connect followed an address the phone gave up on: the
 * request then carries why (`failedDial`), for the computer's log. Fire and forget: a computer that cannot answer (an older Ghostex) is asked
 * again an hour later, and the phone keeps dialing what it has.
 */
export function refreshEasyConnectAddressesSoon(
  machine: MachineConnectionTarget,
  begun: { epoch: number; pairedAddress: string | null; secondRoute?: boolean },
): void {
  // A Tailscale or SSH computer's Easy Connect route (`easyConnectRoute.ts`) keeps its list fresh too.
  if ((machine.transport !== 'tailcat' && begun.secondRoute !== true) || refreshing.has(machine.id)) return;
  // The connect that asks began under a pairing the entry no longer has: its computer's list is
  // not this entry's (machines/pairingEpoch.ts).
  if (!samePairing(machine.id, begun.epoch)) return;
  // A dial that gave up on another address is reported now, whatever the list's age.
  const failure = unreportedFailures.get(machine.id);
  const lastAttempt = lastRefreshAttempt.get(machine.id) ?? 0;
  if (failure === undefined && Date.now() - lastAttempt < REFRESH_RETRY_MS) return;
  refreshing.add(machine.id);
  setTimeout(() => {
    void (async () => {
      try {
        const saved = decodeSavedAddresses(await getEasyConnectAddresses(machine.id), begun.pairedAddress);
        const report = failure === undefined ? null : failedDialParams(failure, Date.now());
        if (report === null && failure !== undefined) unreportedFailures.delete(machine.id);
        if (report === null && !addressesNeedRefresh(saved, Date.now())) return;
        lastRefreshAttempt.set(machine.id, Date.now());
        const link = chatMachineLink(machine);
        if ((await link.route()) !== 'socket') return;
        const answer = await link.rpc('easyConnectAddresses', report ?? {}, REFRESH_TIMEOUT_MS);
        // Sent once: a newer failure replaced it only if it is a different report.
        if (failure !== undefined && unreportedFailures.get(machine.id) === failure) {
          unreportedFailures.delete(machine.id);
        }
        if (answer.error !== null) {
          console.info(
            `[easy-connect] ${machine.id} gave no address list: ${answer.error.code ?? answer.error.message}`,
          );
          return;
        }
        const result = answer.result as { addresses?: unknown } | null;
        // Paired again (or edited, or removed) while it asked: the answer is the computer's before.
        if (!samePairing(machine.id, begun.epoch)) return;
        noteEasyConnectOn(machine.id, readEasyConnectAddresses(result?.addresses).length > 0);
        await saveEasyConnectAddresses(machine.id, result?.addresses, begun.pairedAddress);
      } catch (error) {
        console.info(
          `[easy-connect] ${machine.id} address list fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        refreshing.delete(machine.id);
      }
    })();
  }, REFRESH_DELAY_MS);
}

/**
 * Asks a Tailscale or SSH computer with an Easy Connect route whether Easy Connect is on there now
 * (it names addresses only while it is), for its page (CDXC:RemotePairing 2026-11-13 in
 * easyConnectRoute.ts). Leaves the state unknown when the computer can't answer.
 */
export async function checkEasyConnectOn(machine: MachineConnectionTarget): Promise<void> {
  try {
    const answer = await chatMachineLink(machine).rpc('easyConnectAddresses', {}, REFRESH_TIMEOUT_MS);
    if (answer.error !== null) return;
    const result = answer.result as { addresses?: unknown } | null;
    noteEasyConnectOn(machine.id, readEasyConnectAddresses(result?.addresses).length > 0);
  } catch {
    // Unknown stays unknown, which never reads as on.
  }
}
