/**
 * How long the phone waits before dialling a computer that did not answer its last dials again.
 *
 * CDXC:RemoteMachines 2026-11-14 WHY:
 * Nothing used to back off from a computer that does not answer (asleep, off, out of reach): the Sessions poll dialled
 * it every 5 s, the reconnect ladder every 30 s and the chat link every 2 s. On an iPhone, Tailscale (iOS issue
 * tailscale#21773) runs out of WireGuard buffers when an app keeps retrying a TCP connect to an offline peer about
 * every 10 s, and then stalls every peer, the healthy computers included, for about 100 s. So after two dials that got
 * no answer (unreachable, timed out, refused), `ensureConnected` stops dialling that computer for 30 s, then 1, 2, 4
 * and 5 minutes from then on, and answers its callers at once with the last failure. What the person does on purpose
 * dials at once and starts the count again: Retry, opening a terminal, adding a project, sending a file, opening a
 * web preview link; so do coming back to the front, a network change, pairing the entry again and any connect that
 * worked. Auth and host-key failures keep their own stop; a check or a command failing on a live connection is never
 * a dial failure.
 * SEE-ALSO: src/remote/connection.ts (`ensureConnected`), src/inventory/store.ts (`refreshAll` skips a computer
 * inside its wait), src/app/autoReconnect.ts (the ladder waits for its end).
 */

import { logAppEvent } from '../app/appLog';

/** Dial failures that keep today's quick retries before the wait starts. */
const QUICK_FAILURES = 2;
/** The wait after each further failure; the last one repeats. */
export const DIAL_BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 240_000, 300_000];

/** Native connect codes that mean the computer did not answer at all. */
const UNANSWERED_CODES: ReadonlySet<string> = new Set(['E_UNREACHABLE', 'E_TIMEOUT', 'E_REFUSED']);

type Backoff = {
  failures: number;
  /** When the next dial may go out (0 while the quick retries last). */
  until: number;
  code: string;
  message: string;
};

const backoffs = new Map<string, Backoff>();

/** The native code of a failed connect when it means the computer did not answer, else null. */
export function unansweredDialCode(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && UNANSWERED_CODES.has(code) ? code : null;
}

/** A dial to `machineId` got no answer. */
export function noteDialFailure(machineId: string, code: string, message: string): void {
  const failures = (backoffs.get(machineId)?.failures ?? 0) + 1;
  const step = failures - QUICK_FAILURES - 1;
  const wait = step < 0 ? 0 : DIAL_BACKOFF_STEPS_MS[Math.min(step, DIAL_BACKOFF_STEPS_MS.length - 1)]!;
  backoffs.set(machineId, { failures, until: wait === 0 ? 0 : Date.now() + wait, code, message });
  if (wait > 0) {
    logAppEvent(
      `Connection: ${machineId} did not answer ${failures} dials (${code}); next dial in ${Math.round(wait / 1000)} s`,
    );
  }
}

/** A dial to `machineId` connected. */
export function noteDialSuccess(machineId: string): void {
  backoffs.delete(machineId);
}

/** Lets the next dial to `machineId` go out at once and starts the count again. */
export function clearDialBackoff(machineId: string, why: string): void {
  const backoff = backoffs.get(machineId);
  if (backoff === undefined) return;
  backoffs.delete(machineId);
  if (backoff.until > Date.now()) logAppEvent(`Connection: ${machineId} may dial again now (${why})`);
}

/** How long until `machineId` may be dialled again (0 when it may now). */
export function dialWaitMs(machineId: string, now = Date.now()): number {
  const backoff = backoffs.get(machineId);
  return backoff === undefined ? 0 : Math.max(0, backoff.until - now);
}

/** The error a caller gets while `machineId` waits: the last dial's own failure, so it reads as it did. */
export function dialWaitError(machineId: string): Error | null {
  const backoff = backoffs.get(machineId);
  if (backoff === undefined || dialWaitMs(machineId) === 0) return null;
  return Object.assign(new Error(backoff.message), { code: backoff.code });
}
