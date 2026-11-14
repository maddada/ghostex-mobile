/**
 * What a computer refusing new channels sets off, when the phone's own budget (`channelBudget.ts`) was not enough:
 * channels the phone cannot see are still held there (a terminal or command whose close never reached the computer).
 *
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * A refusal is not a dead connection, so it never replaces one by itself, but channels held on the computer don't
 * come back while the connection lives. The escape is bounded:
 * 1. On a refusal, off-screen agent terminals are detached (their tabs stay and attach again when shown; the agent
 *    keeps running in its zmx session). Plain shells are never closed: their programs end with the channel.
 * 2. Three more refusals within any minute while the shortage lasts (bursts counted once, the detach given a few
 *    seconds to take effect): one planned reset of the connection, but only while no plain shell is open
 *    on that computer, and at most once every five minutes.
 *    A command or upload still running on the connection defers it to the next refusal.
 * 3. Otherwise nothing resets by itself: the computer's notice offers Reset connection and says what it restarts.
 * Only real refusals from the computer count here, never a command that waited too long for a slot (`E_BUSY`).
 *
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * A command whose close the computer never answers (its program still runs there) holds a channel on the computer
 * and, in iPhone builds with the SSH send queue, one of the phone's native command slots, however well the connection
 * answers checks. Those builds report it (`sshChannelStats`, read every `STUCK_CHECK_EVERY_MS` while the app is in
 * front): once one has been stuck `STUCK_CLOSE_RESET_MS`, the same planned reset as step 2 runs under the same rules
 * (no plain shell open, no command running, at most once every five minutes), else the Reset connection button shows.
 * Only a new connection frees the computer's side. Builds without the call never run this.
 */

import { create } from 'zustand';

import { logAppEvent } from '../app/appLog';
import { commandsWaiting, connectionGeneration, onChannelRefused, onConnectionEnding } from './channelBudget';
import { linkTransferring } from './linkActivity';

const REFUSALS_FOR_RESET = 3;
const REFUSAL_WINDOW_MS = 60_000;
const RESET_MIN_GAP_MS = 5 * 60_000;
/** Refusals this soon after the detach are the same burst, from before the freed channels came back. */
const STAGE_ONE_SETTLE_MS = 5_000;
/** Refusals this close together are one burst of commands, counted once. */
const BURST_MS = 2_000;
/** How many agent terminals stay attached on the computer after a refusal (a target, never a reason to close more). */
export const TERMINALS_KEPT_AFTER_REFUSAL = 4;

export type ChannelPressureHandlers = {
  /** Detaches off-screen agent terminals of this computer down to `keep`; returns how many it detached. */
  detachIdleTerminals(machineId: string, keep: number): Promise<number>;
  /** Terminals this phone holds open on the computer: agent terminals and plain shells. */
  openTerminals(machineId: string): { agents: number; shells: number };
  /** Commands the phone runs there right now. */
  commandsInFlight(machineId: string): number;
  /** Replaces the computer's connection; false when it declined (the recovery rules), so nothing was reset. */
  reset(machineId: string, reason: string): Promise<boolean>;
  /** Stuck command closes the native layer reports, or null where it cannot (older builds, Android, no connection). */
  stuckCloses?(machineId: string): Promise<StuckCloses | null>;
  /**
   * Whether the phone's recovery rules let it replace this computer's connection by itself now (`canRecover` in
   * src/app/autoReconnect.ts: auto-reconnect on, in front, not disconnected by hand). Read when a stuck close
   * would reset, after its stats arrived.
   */
  mayRecover?(machineId: string): boolean;
};

/** What `sshChannelStats` says about command closes the computer has not answered. */
export type StuckCloses = { stuckCommandCloses: number; oldestStuckCloseMs: number };

/** A stuck command close this old leads to the planned reset. */
const STUCK_CLOSE_RESET_MS = 60_000;
const STUCK_CHECK_EVERY_MS = 15_000;

type Pressure = {
  stageOneAt: number | null;
  lastRefusalAt: number | null;
  refusals: number[];
  lastResetAt: number | null;
};

/** Refusals this far apart mean the shortage ended: the next one starts again from the detach. */
const SHORTAGE_OVER_MS = 5 * 60_000;

/** Computers whose refusals need the user's Reset connection (the automatic reset did not, or may not, run). */
export const useChannelPressure = create<{ needsReset: Record<string, true> }>(() => ({ needsReset: {} }));

const pressures = new Map<string, Pressure>();
let handlers: ChannelPressureHandlers | null = null;
/** Channels each computer refused in this app run, for the log's snapshots. */
const refusedThisRun = new Map<string, number>();

/**
 * The log's channel snapshot of one computer: what this phone admitted there, which is not the computer's own count
 * (a channel whose close never reached it still counts there). Lines name the computer by its id, which the export
 * turns into a stable "computer 7f3a": a name could be too short for the scrub ("pi") or turn two computers into the
 * same "<private>".
 */
export function channelSnapshot(machineId: string): string {
  const active = handlers;
  const name = machineId;
  const terminals = active?.openTerminals(machineId) ?? { agents: 0, shells: 0 };
  return (
    `Channels: ${name}, admitted by this phone: ${terminals.agents} agent terminals, ${terminals.shells} plain ` +
    `terminals, ${active?.commandsInFlight(machineId) ?? 0} commands running, ${commandsWaiting(machineId)} waiting; ` +
    `${refusedThisRun.get(machineId) ?? 0} refused this run`
  );
}

/** Snapshots taken as a connection dropped, before its waiting commands were refused; read once, shortly after. */
const endSnapshots = new Map<string, { at: number; text: string }>();
const END_SNAPSHOT_FRESH_MS = 1_000;

export function installChannelPressure(next: ChannelPressureHandlers): void {
  if (handlers === null) {
    onChannelRefused((machineId) => void noteChannelRefusal(machineId));
    onConnectionEnding((machineId) =>
      endSnapshots.set(machineId, { at: Date.now(), text: channelSnapshot(machineId) }),
    );
  }
  handlers = next;
}

/**
 * The snapshot of a connection that just dropped: the one taken before its waiting commands were refused when that
 * already happened, else a fresh one (nothing was cleared yet). Logging only.
 */
export function channelSnapshotAtEnd(machineId: string, now = Date.now()): string {
  const taken = endSnapshots.get(machineId);
  endSnapshots.delete(machineId);
  return taken !== undefined && now - taken.at <= END_SNAPSHOT_FRESH_MS ? taken.text : channelSnapshot(machineId);
}

/** Shows the computer's Reset connection button (the stall watch's answer while a plain shell is open). */
export function offerConnectionReset(machineId: string): void {
  setNeedsReset(machineId, true);
}

function setNeedsReset(machineId: string, needed: boolean): void {
  const current = useChannelPressure.getState().needsReset;
  if ((current[machineId] === true) === needed) return;
  const next = { ...current };
  if (needed) next[machineId] = true;
  else delete next[machineId];
  useChannelPressure.setState({ needsReset: next });
}

/** The computer connected again (a reset, the user's Retry or a reconnect): its refusals start over. */
export function clearChannelPressure(machineId: string): void {
  const pressure = pressures.get(machineId);
  if (pressure !== undefined) {
    pressure.stageOneAt = null;
    pressure.lastRefusalAt = null;
    pressure.refusals = [];
  }
  setNeedsReset(machineId, false);
}

export async function noteChannelRefusal(machineId: string, now = Date.now()): Promise<void> {
  const active = handlers;
  if (active === null) return;
  const pressure = pressureFor(machineId);
  const name = machineId;
  refusedThisRun.set(machineId, (refusedThisRun.get(machineId) ?? 0) + 1);
  logAppEvent(`Connection: ${name} refused a new channel. ${channelSnapshot(machineId)}`);
  // The detach stands while the shortage lasts; it ends on a new connection (`clearChannelPressure`) or when the
  // computer has refused nothing for a while. Only the refusals after it roll off with the minute.
  const shortageOver = pressure.lastRefusalAt === null || now - pressure.lastRefusalAt > SHORTAGE_OVER_MS;
  pressure.lastRefusalAt = now;
  if (pressure.stageOneAt === null || shortageOver) {
    pressure.stageOneAt = now;
    pressure.refusals = [];
    const detached = await active.detachIdleTerminals(machineId, TERMINALS_KEPT_AFTER_REFUSAL);
    logAppEvent(`Connection: ${name}: detached ${detached} off-screen agent terminals to free channels`);
    return;
  }
  if (now - pressure.stageOneAt < STAGE_ONE_SETTLE_MS) return;
  const last = pressure.refusals[pressure.refusals.length - 1];
  if (last !== undefined && now - last < BURST_MS) return;
  pressure.refusals = [...pressure.refusals.filter((at) => now - at <= REFUSAL_WINDOW_MS), now];
  if (pressure.refusals.length < REFUSALS_FOR_RESET) return;
  await plannedReset(machineId, pressure, now, 'keeps refusing channels', 'the computer kept refusing channels');
}

function pressureFor(machineId: string): Pressure {
  let pressure = pressures.get(machineId);
  if (pressure === undefined) {
    pressure = { stageOneAt: null, lastRefusalAt: null, refusals: [], lastResetAt: null };
    pressures.set(machineId, pressure);
  }
  return pressure;
}

/** Step 2's reset, shared with stuck closes: the same guards, the same five-minute gap. */
async function plannedReset(
  machineId: string,
  pressure: Pressure,
  now: number,
  what: string,
  reason: string,
): Promise<void> {
  const active = handlers;
  if (active === null) return;
  const name = machineId;
  const shellsOpen = active.openTerminals(machineId).shells > 0;
  const tooSoon = pressure.lastResetAt !== null && now - pressure.lastResetAt < RESET_MIN_GAP_MS;
  const running = active.commandsInFlight(machineId);
  const recoveryOff = active.mayRecover !== undefined && !active.mayRecover(machineId);
  // A heavy transfer (a chat snapshot, a large read over the forward) is not a command, but a reset would cut it too;
  // the stall watch waits for it the same way.
  const transferring = linkTransferring(machineId);
  if (recoveryOff || shellsOpen || tooSoon || running > 0 || transferring) {
    logAppEvent(
      `Connection: ${name} ${what}; not resetting by itself (${
        recoveryOff
          ? 'the recovery rules do not allow it now'
          : shellsOpen
            ? 'a plain terminal is open'
            : tooSoon
              ? 'it was reset less than 5 minutes ago'
              : transferring
                ? 'a large transfer is under way'
                : `${running} commands or uploads still running`
      })`,
    );
    // Work still running defers the reset to the next trigger, which checks again; the button is there meanwhile.
    setNeedsReset(machineId, true);
    return;
  }
  // Only a reset that starts counts for the five-minute gap and clears the refusals (gx-xgs.10.11).
  const before = { ...pressure, refusals: [...pressure.refusals] };
  pressure.lastResetAt = now;
  pressure.stageOneAt = null;
  pressure.lastRefusalAt = null;
  pressure.refusals = [];
  const started = await active.reset(machineId, reason).catch(() => true);
  if (started) {
    logAppEvent(`Connection: freed up the connection to ${name}`);
    return;
  }
  Object.assign(pressure, before);
  logAppEvent(`Connection: ${name} ${what}; not resetting by itself (the recovery rules do not allow it now)`);
  setNeedsReset(machineId, true);
}

/** Computers whose stats read is still waiting for its native answer (one at a time per computer). */
const stuckReads = new Set<string>();

/**
 * One look at a computer's stuck command closes; a close stuck `STUCK_CLOSE_RESET_MS` leads to the planned reset.
 * The answer counts only for the connection it was asked on (`connectionGeneration`): a connection replaced while the
 * native read was pending is not reset or flagged for the one before. The recovery rules are read once the answer is
 * in; when they forbid an automatic reset, the Reset connection button shows while the app is in front.
 */
export async function checkStuckCloses(machineId: string, now = Date.now()): Promise<void> {
  const read = handlers?.stuckCloses;
  if (read === undefined || stuckReads.has(machineId)) return;
  stuckReads.add(machineId);
  const generation = connectionGeneration(machineId);
  let stats: StuckCloses | null;
  try {
    stats = await read(machineId).catch(() => null);
  } finally {
    stuckReads.delete(machineId);
  }
  if (connectionGeneration(machineId) !== generation) return;
  if (stats === null || stats.stuckCommandCloses === 0 || stats.oldestStuckCloseMs < STUCK_CLOSE_RESET_MS) return;
  const active = handlers;
  if (active === null) return;
  if (active.mayRecover !== undefined && !active.mayRecover(machineId)) {
    logAppEvent(`Connection: ${machineId} has commands the computer never finished closing; not resetting by itself`);
    if (stuckInFront()) setNeedsReset(machineId, true);
    return;
  }
  const what =
    `has ${stats.stuckCommandCloses} commands whose close it has not answered ` +
    `(oldest ${Math.round(stats.oldestStuckCloseMs / 1000)} s)`;
  await plannedReset(machineId, pressureFor(machineId), now, what, 'commands the computer never finished closing');
}

let stuckTimer: ReturnType<typeof setInterval> | null = null;
let stuckInFront: () => boolean = () => true;

/** Reads the stuck closes of `machineIds()` every `STUCK_CHECK_EVERY_MS` while `inFront()`. */
export function startStuckCloseChecks(machineIds: () => string[], inFront: () => boolean): void {
  if (stuckTimer !== null) return;
  stuckInFront = inFront;
  stuckTimer = setInterval(() => {
    if (!inFront()) return;
    for (const machineId of machineIds()) void checkStuckCloses(machineId);
  }, STUCK_CHECK_EVERY_MS);
}
