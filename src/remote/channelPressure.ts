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
 */

import { create } from 'zustand';

import { logAppEvent } from '../app/appLog';
import { commandsWaiting, onChannelRefused } from './channelBudget';

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
  /** The computer's name for log lines. */
  label(machineId: string): string;
  /** Detaches off-screen agent terminals of this computer down to `keep`; returns how many it detached. */
  detachIdleTerminals(machineId: string, keep: number): Promise<number>;
  /** Terminals this phone holds open on the computer: agent terminals and plain shells. */
  openTerminals(machineId: string): { agents: number; shells: number };
  /** Commands the phone runs there right now. */
  commandsInFlight(machineId: string): number;
  /** Replaces the computer's connection. */
  reset(machineId: string): Promise<void>;
};

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
 * (a channel whose close never reached it still counts there).
 */
export function channelSnapshot(machineId: string): string {
  const active = handlers;
  const name = active?.label(machineId) ?? machineId;
  const terminals = active?.openTerminals(machineId) ?? { agents: 0, shells: 0 };
  return (
    `Channels: ${name}, admitted by this phone: ${terminals.agents} agent terminals, ${terminals.shells} plain ` +
    `terminals, ${active?.commandsInFlight(machineId) ?? 0} commands running, ${commandsWaiting(machineId)} waiting; ` +
    `${refusedThisRun.get(machineId) ?? 0} refused this run`
  );
}

export function installChannelPressure(next: ChannelPressureHandlers): void {
  if (handlers === null) onChannelRefused((machineId) => void noteChannelRefusal(machineId));
  handlers = next;
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
  let pressure = pressures.get(machineId);
  if (pressure === undefined) {
    pressure = { stageOneAt: null, lastRefusalAt: null, refusals: [], lastResetAt: null };
    pressures.set(machineId, pressure);
  }
  const name = active.label(machineId);
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
  const shellsOpen = active.openTerminals(machineId).shells > 0;
  const tooSoon = pressure.lastResetAt !== null && now - pressure.lastResetAt < RESET_MIN_GAP_MS;
  const running = active.commandsInFlight(machineId);
  if (shellsOpen || tooSoon || running > 0) {
    logAppEvent(
      `Connection: ${name} keeps refusing channels; not resetting by itself (${
        shellsOpen
          ? 'a plain terminal is open'
          : tooSoon
            ? 'it was reset less than 5 minutes ago'
            : `${running} commands or uploads still running`
      })`,
    );
    // Work still running defers the reset to the next refusal, which checks again; the button is there meanwhile.
    setNeedsReset(machineId, true);
    return;
  }
  pressure.lastResetAt = now;
  pressure.stageOneAt = null;
  pressure.lastRefusalAt = null;
  pressure.refusals = [];
  logAppEvent(`Connection: freeing up the connection to ${name}`);
  await active.reset(machineId).catch(() => undefined);
}
