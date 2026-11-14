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
import { linkTransferring, transferDefers } from './linkActivity';
import { nativeProbeLane } from './probeLane';

/** How long a command runs, or a channel open takes, before the connection is checked. */
export const STALL_SUSPECT_MS = 8_000;
/** Commands that timed out with nothing answered since the connection came up, before it is checked. */
const SILENT_TIMEOUTS_FOR_CHECK = 2;
/** How often a check that could not run is tried again while a suspect remains. */
const RETRY_MS = 2_000;

/**
 * The check's answer (`ProbeOutcome` in src/remote/connection.ts), plus `lost`: the check failed and the iPhone's SSH
 * now reports this same connection closed. It sends no disconnect event for that, so the watch replaces it.
 */
export type StallCheckOutcome = 'answered' | 'busy' | 'capacity' | 'stalled' | 'failed' | 'unknown' | 'lost';

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

/**
 * The iPhone has this stall (Android's sshj sends each packet whole). Android builds with the native check lane
 * (`nativeProbeLane`) get the same watch for commands that hang; older Android builds keep today's behaviour.
 */
function watching(): boolean {
  return (Platform.OS === 'ios' || nativeProbeLane()) && handlers !== null;
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
  // A check still running belongs to the connection before: it settles into nothing and no longer blocks new ones.
  watch.checking = null;
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

/**
 * Whether a "Failed to open channel" took long enough to be this stall rather than the computer refusing. iPhone only:
 * Android has no such stall, so its refusals keep the refusal path whatever they took.
 */
export function isSlowOpenFailure(startedAt: number, now = Date.now()): boolean {
  return Platform.OS === 'ios' && now - startedAt >= STALL_SUSPECT_MS;
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
  if (transferDefers(machineId)) {
    // A heavy transfer that still delivers holds the link; its own outcome decides. Asked again once it may have
    // ended, or gone quiet for 15 s (linkActivity.ts `TRANSFER_SILENCE_MS`).
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
    if (outcome === 'stalled' && watch.newestAnsweredStart >= startedAt) {
      // A command that opened its channel after this check began came back: new channels open.
      logAppEvent(`Connection: ${machineId} kept: a newer command answered while the check waited`);
      outcome = 'answered';
    }
    // `failed` (a wrong answer, an error that is not a timeout, on a connection native still reports up) does not
    // show opens stuck. A socket that really closed comes back `lost` instead.
    if (outcome === 'answered' || outcome === 'capacity' || outcome === 'failed') {
      // The echo's channel opened when the check began; later opens are not covered by it.
      watch.clearedBefore = Math.max(watch.clearedBefore, startedAt);
      return;
    }
    if (outcome === 'lost') {
      // Nothing moves on a closed socket, a transfer included, and the plain shells' programs already ended with it.
      if (!active.mayRecover(machineId)) return;
      logAppEvent(`Connection: ${machineId} is closed on the phone (${reason}); replacing it`);
      await active.replace(machineId, `the connection closed (${reason})`).catch(() => undefined);
      return;
    }
    // `unknown`: the check found nothing by its deadline, or ran during a transfer; it proves nothing either way.
    if (outcome === 'busy' || outcome === 'unknown') {
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
    // Only this run's own pointer is cleared: a newer check (after a reset) keeps running.
    if (watch.checking === run) watch.checking = null;
    if (watch.epoch !== epoch) {
      // The connection changed while this check ran (it may have replaced it): what the new one holds is asked now.
      evaluate(machineId);
      return;
    }
    const left = suspectReason(watch, Date.now());
    // Commands younger than the wait keep their own timers.
    if (left !== null) scheduleRetry(machineId, watch, `${left}; checking again`);
  });
  watch.checking = run;
  return run;
}
