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
 * answer in 8 s" replaces the connection, and never while a plain shell is open (its program would end): the
 * computer's Reset connection button shows instead. An answered check clears only the commands that started before
 * it, so a later stall gets its own check at once. Frames on channels that were already open are no evidence here,
 * because this stall leaves them flowing.
 * SEE-ALSO: src/remote/connection.ts (`checkStalledConnection`), src/remote/channelBudget.ts (the lane and the
 * operation hooks), src/app/autoReconnect.ts (`installStallWatch`).
 */

import { Platform } from 'react-native';

import { logAppEvent } from '../app/appLog';
import { linkTransferring } from './linkActivity';

/** How long a command runs, or a channel open takes, before the connection is checked. */
export const STALL_SUSPECT_MS = 8_000;
/** Commands that timed out with nothing answered since the connection came up, before it is checked. */
const SILENT_TIMEOUTS_FOR_CHECK = 2;

export type StallCheckOutcome = 'answered' | 'busy' | 'capacity' | 'stalled' | 'failed';

export type StallWatchHandlers = {
  /** One bounded check in the probe lane. */
  check(machineId: string): Promise<StallCheckOutcome>;
  /** Replaces the computer's connection. */
  replace(machineId: string, reason: string): Promise<void>;
  /** Plain shells this phone holds open on the computer; their programs end with the connection. */
  plainShells(machineId: string): number;
  /** Shows the computer's Reset connection button. */
  offerReset(machineId: string): void;
};

type Operation = { startedAt: number; epoch: number; timer: ReturnType<typeof setTimeout> };
type Watch = {
  epoch: number;
  answered: number;
  timeouts: number;
  /** Operations whose native call started before this were cleared by an answered check. */
  clearedBefore: number;
  checking: Promise<void> | null;
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
    watch = { epoch: 0, answered: 0, timeouts: 0, clearedBefore: 0, checking: null, operations: new Map() };
    watches.set(machineId, watch);
  }
  return watch;
}

/** The computer connected (again): what ran on the connection before says nothing about this one. */
export function noteStallWatchConnected(machineId: string): void {
  const watch = watchFor(machineId);
  watch.epoch += 1;
  watch.answered = 0;
  watch.timeouts = 0;
  watch.clearedBefore = Date.now();
  for (const operation of watch.operations.values()) clearTimeout(operation.timer);
  watch.operations.clear();
}

/** A command's native call starts; returns the token its end reports with. */
export function noteOperationStarted(machineId: string): number {
  const id = nextOperationId++;
  if (!watching()) return id;
  const watch = watchFor(machineId);
  const startedAt = Date.now();
  const epoch = watch.epoch;
  const timer = setTimeout(() => {
    const current = watches.get(machineId);
    if (current?.operations.get(id) === undefined || current.epoch !== epoch) return;
    if (startedAt < current.clearedBefore) return;
    void checkConnection(machineId, `a command has run ${Math.round(STALL_SUSPECT_MS / 1000)} s`);
  }, STALL_SUSPECT_MS);
  watch.operations.set(id, { startedAt, epoch, timer });
  return id;
}

/** A command's native call settled: `answered` when it came back, `timeout` for E_TIMEOUT, else `failed`. */
export function noteOperationEnded(machineId: string, id: number, outcome: 'answered' | 'timeout' | 'failed'): void {
  const watch = watches.get(machineId);
  const operation = watch?.operations.get(id);
  if (watch === undefined || operation === undefined) return;
  clearTimeout(operation.timer);
  watch.operations.delete(id);
  if (operation.epoch !== watch.epoch) return;
  if (outcome === 'answered') watch.answered += 1;
  if (outcome !== 'timeout') return;
  watch.timeouts += 1;
  if (watch.answered === 0 && watch.timeouts >= SILENT_TIMEOUTS_FOR_CHECK) {
    void checkConnection(machineId, `${watch.timeouts} commands timed out and nothing answered since connecting`);
  }
}

/** Whether a "Failed to open channel" took long enough to be this stall rather than the computer refusing. */
export function isSlowOpenFailure(startedAt: number, now = Date.now()): boolean {
  return now - startedAt >= STALL_SUSPECT_MS;
}

/** A channel open failed only after `STALL_SUSPECT_MS`: not a refusal until the check says what it was. */
export function noteSlowOpenFailure(machineId: string, elapsedMs: number): void {
  if (!watching()) return;
  void checkConnection(machineId, `a channel open failed after ${Math.round(elapsedMs / 1000)} s`);
}

/** Runs the one check (triggers while it runs join it) and acts on its answer. */
function checkConnection(machineId: string, reason: string): Promise<void> {
  const active = handlers;
  if (active === null || !watching()) return Promise.resolve();
  const watch = watchFor(machineId);
  if (watch.checking !== null) return watch.checking;
  if (linkTransferring(machineId)) {
    // A heavy transfer holds the link; its own outcome (it arrives, or fails within its deadline) decides.
    logAppEvent(`Connection: ${machineId} check skipped (${reason}): a large transfer is under way`);
    return Promise.resolve();
  }
  const epoch = watch.epoch;
  const startedAt = Date.now();
  const run = (async () => {
    const outcome = await active.check(machineId).catch((): StallCheckOutcome => 'failed');
    logAppEvent(`Connection: ${machineId} stall check (${reason}): ${outcome} in ${Date.now() - startedAt}ms`);
    if (watch.epoch !== epoch) return;
    if (outcome === 'answered' || outcome === 'capacity') {
      watch.clearedBefore = Date.now();
      return;
    }
    if (outcome === 'busy') return;
    const shells = active.plainShells(machineId);
    if (shells > 0) {
      logAppEvent(
        `Connection: ${machineId} looks stuck; not replacing it by itself (${shells} plain terminals open would end)`,
      );
      active.offerReset(machineId);
      return;
    }
    logAppEvent(`Connection: ${machineId} looks stuck (${reason}); replacing it`);
    await active.replace(machineId, `the connection stopped opening channels (${reason})`).catch(() => undefined);
  })().finally(() => {
    watch.checking = null;
  });
  watch.checking = run;
  return run;
}
