/**
 * Notices an iPhone connection whose new channels stopped opening, checks it once, and replaces it.
 *
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * The iPhone's libssh2 (1.11.0) loses the next packet sent after a partly sent one. When that packet opens a channel,
 * every later open on the connection waits libssh2's 60 s read timeout and then fails as "Failed to open channel",
 * while the channels already open keep flowing. The phone read that as busy or as the computer refusing, so it kept
 * the stuck connection for a minute or more, though a redial takes about 280 ms (gx-xgs, proved on mini). The native
 * fix needs a new app; until then this file shortens the stall. Timing alone never replaces a connection: a command
 * that has run 8 s, a slow "Failed to open channel" or two timeouts with nothing answered only start one check, an
 * `echo` in its own lane (channelBudget.ts `withProbeChannel`) that never waits behind the command slots. Only "no
 * answer in 8 s" replaces the connection, and only when nothing else proves new channels open:
 * - A command that started after the check began and answered is that proof, and the check's "stalled" is dropped.
 *   Frames on channels that were already open are not, because this stall leaves them flowing.
 * - An answered check clears only the commands that started before it began; later ones keep their own watch.
 * - A plain shell open on the computer blocks every automatic replacement (its program would end): the computer's
 *   Reset connection button shows instead (also in `ensureConnected`, src/remote/connection.ts).
 * - The phone's recovery rules apply (`canRecover` in src/app/autoReconnect.ts: auto-reconnect on, in front, not
 *   disconnected by hand).
 * - A check that could not run (a large transfer under way, the lane taken) is retried every few seconds while a
 *   suspect remains, and everything pending is dropped when the connection ends.
 * SEE-ALSO: src/remote/connection.ts (`checkStalledConnection`, `ensureConnected`), src/remote/channelBudget.ts (the
 * lane and the operation hooks), src/app/autoReconnect.ts (`installStallWatch`).
 */

import { Platform } from 'react-native';

import { logAppEvent } from '../app/appLog';
import { linkTransferring } from './linkActivity';

/** How long a command runs, or a channel open takes, before the connection is checked. */
export const STALL_SUSPECT_MS = 8_000;
/** Commands that timed out with nothing answered since the connection came up, before it is checked. */
const SILENT_TIMEOUTS_FOR_CHECK = 2;
/** How often a check that could not run is tried again while a suspect remains. */
const RETRY_MS = 2_000;

export type StallCheckOutcome = 'answered' | 'busy' | 'capacity' | 'stalled' | 'failed';

export type StallWatchHandlers = {
  /** One bounded check in the probe lane. */
  check(machineId: string): Promise<StallCheckOutcome>;
  /** Replaces the computer's connection. */
  replace(machineId: string, reason: string): Promise<void>;
  /** Whether the phone's recovery rules let it replace this computer's connection by itself now. */
  mayRecover(machineId: string): boolean;
  /** Plain shells this phone holds open on the computer; their programs end with the connection. */
  plainShells(machineId: string): number;
  /** Shows the computer's Reset connection button. */
  offerReset(machineId: string): void;
};

type Operation = { startedAt: number; timer: ReturnType<typeof setTimeout> };
type Watch = {
  epoch: number;
  answered: number;
  timeouts: number;
  /** Operations whose native call started before this were covered by an answered check. */
  clearedBefore: number;
  /** When the newest command that answered had started (proof that new channels opened then). */
  newestAnsweredStart: number;
  checking: Promise<void> | null;
  /** Why a check is still owed (a trigger without an operation of its own, or one that could not run). */
  owed: string | null;
  retry: ReturnType<typeof setTimeout> | null;
  operations: Map<number, Operation>;
};

const watches = new Map<string, Watch>();
let handlers: StallWatchHandlers | null = null;
let nextOperationId = 1;

export function installStallWatch(next: StallWatchHandlers): void {
  handlers = next;
}

/** Only the iPhone has this stall (Android's sshj sends each packet whole); Android keeps today's behaviour. */
function watching(): boolean {
  return Platform.OS === 'ios' && handlers !== null;
}

function watchFor(machineId: string): Watch {
  let watch = watches.get(machineId);
  if (watch === undefined) {
    watch = {
      epoch: 0,
      answered: 0,
      timeouts: 0,
      clearedBefore: 0,
      newestAnsweredStart: 0,
      checking: null,
      owed: null,
      retry: null,
      operations: new Map(),
    };
    watches.set(machineId, watch);
  }
  return watch;
}

/**
 * The connection came up, ended, is being replaced, or was closed by hand: everything pending belongs to the
 * connection before, so its timers stop and a check still running settles into nothing.
 */
export function resetStallWatch(machineId: string): void {
  const watch = watchFor(machineId);
  watch.epoch += 1;
  watch.answered = 0;
  watch.timeouts = 0;
  watch.clearedBefore = Date.now();
  watch.newestAnsweredStart = 0;
  watch.owed = null;
  if (watch.retry !== null) clearTimeout(watch.retry);
  watch.retry = null;
  for (const operation of watch.operations.values()) clearTimeout(operation.timer);
  watch.operations.clear();
}

/** Plain shells open on the computer, as the watch's host counts them (0 on Android and before it is installed). */
export function plainShellsOpen(machineId: string): number {
  return watching() ? (handlers?.plainShells(machineId) ?? 0) : 0;
}

/** Shows the computer's Reset connection button instead of replacing the connection by itself. */
export function offerResetInstead(machineId: string, why: string): void {
  logAppEvent(`Connection: ${machineId} looks stuck; not replacing it by itself (${why})`);
  handlers?.offerReset(machineId);
}

/** A command's native call starts; returns the token its end reports with. */
export function noteOperationStarted(machineId: string): number {
  const id = nextOperationId++;
  if (!watching()) return id;
  const watch = watchFor(machineId);
  const startedAt = Date.now();
  const epoch = watch.epoch;
  const timer = setTimeout(() => {
    if (watches.get(machineId)?.epoch !== epoch) return;
    evaluate(machineId);
  }, STALL_SUSPECT_MS);
  watch.operations.set(id, { startedAt, timer });
  return id;
}

/** A command's native call settled: `answered` when it came back, `timeout` for E_TIMEOUT, else `failed`. */
export function noteOperationEnded(machineId: string, id: number, outcome: 'answered' | 'timeout' | 'failed'): void {
  const watch = watches.get(machineId);
  const operation = watch?.operations.get(id);
  if (watch === undefined || operation === undefined) return;
  clearTimeout(operation.timer);
  watch.operations.delete(id);
  if (outcome === 'answered') {
    watch.answered += 1;
    watch.newestAnsweredStart = Math.max(watch.newestAnsweredStart, operation.startedAt);
    return;
  }
  if (outcome !== 'timeout') return;
  watch.timeouts += 1;
  if (watch.answered === 0 && watch.timeouts >= SILENT_TIMEOUTS_FOR_CHECK) {
    owe(machineId, `${watch.timeouts} commands timed out and nothing answered since connecting`);
  }
}

/** Whether a "Failed to open channel" took long enough to be this stall rather than the computer refusing. */
export function isSlowOpenFailure(startedAt: number, now = Date.now()): boolean {
  return now - startedAt >= STALL_SUSPECT_MS;
}

/** A channel open failed only after `STALL_SUSPECT_MS`: not a refusal until the check says what it was. */
export function noteSlowOpenFailure(machineId: string, elapsedMs: number): void {
  if (!watching()) return;
  owe(machineId, `a channel open failed after ${Math.round(elapsedMs / 1000)} s`);
}

function owe(machineId: string, reason: string): void {
  watchFor(machineId).owed = reason;
  evaluate(machineId);
}

/** The oldest command still running that no answered check covers, once it has run `STALL_SUSPECT_MS`. */
function suspectReason(watch: Watch, now: number): string | null {
  if (watch.owed !== null) return watch.owed;
  for (const operation of watch.operations.values()) {
    if (operation.startedAt >= watch.clearedBefore && now - operation.startedAt >= STALL_SUSPECT_MS) {
      return `a command has run ${Math.round((now - operation.startedAt) / 1000)} s`;
    }
  }
  return null;
}

/** Starts a check when one is owed and none runs; otherwise retries later while a suspect remains. */
function evaluate(machineId: string): void {
  if (!watching()) return;
  const watch = watchFor(machineId);
  if (watch.checking !== null) return; // the running check re-evaluates when it ends
  const reason = suspectReason(watch, Date.now());
  if (reason === null) return;
  if (linkTransferring(machineId)) {
    // A heavy transfer holds the link; its own outcome decides. Asked again once it may have ended.
    scheduleRetry(machineId, watch, `${reason}; a large transfer is under way`);
    return;
  }
  void runCheck(machineId, watch, reason);
}

function scheduleRetry(machineId: string, watch: Watch, why: string): void {
  if (watch.retry !== null) return;
  logAppEvent(`Connection: ${machineId} check postponed (${why})`);
  const epoch = watch.epoch;
  watch.retry = setTimeout(() => {
    watch.retry = null;
    if (watch.epoch === epoch) evaluate(machineId);
  }, RETRY_MS);
}

/** Runs the one check and acts on its answer; triggers while it runs are evaluated again when it ends. */
function runCheck(machineId: string, watch: Watch, reason: string): Promise<void> {
  const active = handlers;
  if (active === null) return Promise.resolve();
  if (!active.mayRecover(machineId)) return Promise.resolve();
  const epoch = watch.epoch;
  const startedAt = Date.now();
  watch.owed = null;
  const run = (async () => {
    let outcome = await active.check(machineId).catch((): StallCheckOutcome => 'failed');
    logAppEvent(`Connection: ${machineId} stall check (${reason}): ${outcome} in ${Date.now() - startedAt}ms`);
    if (watch.epoch !== epoch) return;
    if ((outcome === 'stalled' || outcome === 'failed') && watch.newestAnsweredStart >= startedAt) {
      // A command that opened its channel after this check began came back: new channels open.
      logAppEvent(`Connection: ${machineId} kept: a newer command answered while the check waited`);
      outcome = 'answered';
    }
    if (outcome === 'answered' || outcome === 'capacity') {
      // The echo's channel opened when the check began; later opens are not covered by it.
      watch.clearedBefore = Math.max(watch.clearedBefore, startedAt);
      return;
    }
    if (outcome === 'busy') {
      watch.owed ??= reason;
      return;
    }
    if (linkTransferring(machineId)) {
      watch.owed ??= reason;
      return;
    }
    if (!active.mayRecover(machineId)) return;
    const shells = active.plainShells(machineId);
    if (shells > 0) {
      offerResetInstead(machineId, `${shells} plain terminals open would end`);
      watch.clearedBefore = Date.now();
      return;
    }
    logAppEvent(`Connection: ${machineId} looks stuck (${reason}); replacing it`);
    await active.replace(machineId, `the connection stopped opening channels (${reason})`).catch(() => undefined);
  })().finally(() => {
    watch.checking = null;
    if (watch.epoch !== epoch) return;
    const left = suspectReason(watch, Date.now());
    // Commands younger than the wait keep their own timers.
    if (left !== null) scheduleRetry(machineId, watch, `${left}; checking again`);
  });
  watch.checking = run;
  return run;
}
