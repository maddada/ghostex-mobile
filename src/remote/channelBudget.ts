/**
 * How many commands the phone runs at once on a computer's shared SSH connection.
 *
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * OpenSSH refuses a session channel past `MaxSessions` (10 by default) on one connection. Up to seven warm
 * terminals each hold one (`MAX_WARM_SESSIONS` in src/terminal/sessions.ts), and every command opens another. The
 * Android connection has kept commands to three slots since 2026-10-06; the iPhone opened one for every command, so
 * a few reads at once (the Sessions poll, the keep-awake renewal, the round-trip check) got "Failed to open channel",
 * which read as a dropped connection: the phone tore down a working connection about once a minute, terminal Retry
 * was refused the same way, and the computer's update and skills reads found no route. On the iPhone every command
 * now waits here for one of three slots.
 * - A wait is finite and ends with `E_BUSY` (never `E_TIMEOUT`): a command that never left the phone says nothing
 *   about the connection, so it must not count as a stall or as a refusal.
 * - A slot is given back only when the native call settles, not when its caller stops waiting.
 * - Waiters belong to the connection they queued on: when it ends, they are refused, so nothing queued for the old
 *   connection runs on its replacement.
 * - These are counts of what the phone let through, not of channels open on the computer.
 * SEE-ALSO: COMMAND_CHANNEL_SLOTS in modules/ghostex-native/android/.../GhostexSshConnection.kt,
 * src/remote/channelPressure.ts (what a real refusal sets off).
 */

import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { nativeProbeLane } from './probeLane';
import { isSlowOpenFailure, noteOperationEnded, noteOperationStarted, noteSlowOpenFailure } from './stallWatch';

/** OpenSSH's default `MaxSessions` (10) less the seven warm terminals, as on Android. */
export const COMMAND_CHANNEL_SLOTS = 3;
/** The longest a command waits for a slot, however long its own run may take. */
export const MAX_ADMISSION_WAIT_MS = 20_000;

/** A command that never got a slot: the phone was busy, the connection was not judged. */
export class ChannelBusyError extends Error {
  readonly code = 'E_BUSY';
  constructor(message = 'Ghostex is still busy with other requests to this computer.') {
    super(message);
  }
}

type Waiter = { grant: () => void; refuse: (error: Error) => void };
type Budget = {
  inUse: number;
  generation: number;
  queue: Waiter[];
  coolUntil: number;
  coolTimer: ReturnType<typeof setTimeout> | null;
  /** Until this time, or the first answer on the connection, commands start one at a time (`WARM_UP_MS`). */
  warmUntil: number;
  /** The generation whose warm-up started (with its first command). */
  warmedGeneration: number;
  lastGrantAt: number;
  probeBusy: boolean;
};

/**
 * After the computer refuses a channel, the next command waits this long: the computer frees a closed channel a moment
 * after the phone sees it settle, and without the pause every queued command was let through and refused in turn.
 */
const REFUSAL_COOL_MS = 750;
/** A refused command never ran, so it is tried again (after the pause, within its own wait for a slot) this often. */
const REFUSAL_RETRIES = 2;
/**
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * Right after the iPhone connects, the environment probe, the sessions read, the keep-awake holds, widgets, push
 * registration and the chat handshake all asked at once. That burst is what most often left a packet partly sent,
 * which the iPhone's libssh2 1.11.0 then loses with the next one (src/remote/stallWatch.ts). For `WARM_UP_MS` after a
 * connection's first command, commands start one at a time: the next one starts when the one before answers or
 * `WARM_UP_SPACING_MS` after it started, whichever is first. An answer lets only the next command through, never the
 * whole queue.
 */
const WARM_UP_MS = 5_000;
const WARM_UP_SPACING_MS = 500;

const budgets = new Map<string, Budget>();
const refusalListeners = new Set<(machineId: string) => void>();
let listening = false;

function budgetFor(machineId: string): Budget {
  let budget = budgets.get(machineId);
  if (budget === undefined) {
    budget = {
      inUse: 0,
      generation: 0,
      queue: [],
      coolUntil: 0,
      coolTimer: null,
      warmUntil: 0,
      warmedGeneration: -1,
      lastGrantAt: 0,
      probeBusy: false,
    };
    budgets.set(machineId, budget);
  }
  return budget;
}

const endingListeners = new Set<(machineId: string) => void>();

/** Hears a connection that dropped (`disconnected`, `failed`) just before its waiting commands are refused. */
export function onConnectionEnding(listener: (machineId: string) => void): () => void {
  endingListeners.add(listener);
  return () => endingListeners.delete(listener);
}

function listenForConnectionEnds(): void {
  if (listening) return;
  listening = true;
  GhostexNative.addListener('onConnectionState', (event) => {
    if (event.state === 'connected') return;
    if (event.state === 'disconnected' || event.state === 'failed') {
      for (const listener of endingListeners) listener(event.machineId);
    }
    endConnectionBudget(event.machineId);
  });
}

/** Whether commands wait for a slot here: the iPhone only, Android's connection keeps its own three. */
function budgeted(): boolean {
  return Platform.OS === 'ios';
}

/**
 * The connection ended or is being replaced: queued commands are refused with `E_BUSY` and the count starts over.
 * Commands still running on the old connection settle against it and give back nothing to the new one.
 */
export function endConnectionBudget(machineId: string): void {
  const budget = budgets.get(machineId);
  if (budget === undefined) return;
  budget.generation += 1;
  budget.inUse = 0;
  budget.coolUntil = 0;
  budget.probeBusy = false;
  const queue = budget.queue.splice(0);
  for (const waiter of queue) {
    waiter.refuse(new ChannelBusyError('The connection to the computer was replaced before this could run.'));
  }
}

/**
 * Which connection the computer's budget counts now: it moves on whenever the connection ends, dials again or is
 * replaced. What settles under an older number belongs to a connection that is gone (`probeConnection`).
 */
export function connectionGeneration(machineId: string): number {
  listenForConnectionEnds();
  return budgetFor(machineId).generation;
}

/** Commands running now through the budget (what the phone let through, not what the computer counts). */
export function commandsInFlight(machineId: string): number {
  return running.get(machineId) ?? 0;
}

/** Commands waiting for one of the phone's slots on the computer (iPhone only; Android's connection queues its own). */
export function commandsWaiting(machineId: string): number {
  return budgets.get(machineId)?.queue.length ?? 0;
}

/** Commands and uploads running now on each computer, on every platform (Android's are not budgeted here). */
const running = new Map<string, number>();

/** Counts `settled` as running on the machine until it settles. */
function tracked<T>(machineId: string, start: () => Promise<T>): Promise<T> {
  running.set(machineId, (running.get(machineId) ?? 0) + 1);
  let settled: Promise<T>;
  try {
    settled = start();
  } catch (error) {
    settled = Promise.reject(error);
  }
  const done = (): void => {
    const left = (running.get(machineId) ?? 1) - 1;
    if (left > 0) running.set(machineId, left);
    else running.delete(machineId);
  };
  settled.then(done, done);
  return settled;
}

/** Hears every channel the computer refused (`E_CHANNEL_FAILED`), from a command or a terminal. */
export function onChannelRefused(listener: (machineId: string) => void): () => void {
  refusalListeners.add(listener);
  return () => refusalListeners.delete(listener);
}

/** A channel the computer refused outside the budget (a terminal's open). */
export function reportChannelRefused(machineId: string): void {
  for (const listener of refusalListeners) listener(machineId);
}

/**
 * Whether the computer refused to open a channel, so the command or terminal never started. The native code
 * `E_CHANNEL_FAILED` alone does not say so: the iPhone also uses it for a socket that failed while a command's output
 * was being read, a refused shell request and a cancellation, after which the command may well have run. Only its
 * open failure carries the words "Failed to open channel" (SSHError.channelOpenFailed, the same in 11.2.1), so that
 * is what counts; `E_CHANNEL_REFUSED` is accepted too for a native build that names the refusal itself.
 */
export function isChannelRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (code === 'E_CHANNEL_REFUSED') return true;
  return code === 'E_CHANNEL_FAILED' && typeof message === 'string' && /\bfailed to open channel\b/iu.test(message);
}

/**
 * Lets queued commands through until the slots are full, unless the budget is cooling after a refusal or the
 * connection is still warming up (one at a time, spaced).
 */
function grantNext(budget: Budget): void {
  while (budget.inUse < COMMAND_CHANNEL_SLOTS && budget.queue.length > 0) {
    const now = Date.now();
    const warming = now < budget.warmUntil;
    const wait = Math.max(budget.coolUntil - now, warming ? budget.lastGrantAt + WARM_UP_SPACING_MS - now : 0);
    if (wait > 0) {
      budget.coolTimer ??= setTimeout(() => {
        budget.coolTimer = null;
        grantNext(budget);
      }, wait);
      return;
    }
    budget.lastGrantAt = now;
    budget.queue.shift()?.grant();
  }
}

/** The stall watch's view of a command's end. */
function operationOutcome(error: unknown): 'timeout' | 'failed' {
  return (error as { code?: unknown } | null)?.code === 'E_TIMEOUT' ? 'timeout' : 'failed';
}

/**
 * Runs the connection check in its own lane, outside the three command slots, so it never waits behind slow commands
 * (src/remote/stallWatch.ts). One check runs at a time; a second is `E_BUSY`. iPhone, and Android builds whose native
 * connection has the lane (`nativeProbeLane`); older Android builds keep their three slots, and a fourth exec there
 * waits on them.
 */
export function withProbeChannel<T>(machineId: string, run: () => Promise<T>): Promise<T> {
  if (!budgeted() && !nativeProbeLane()) return run();
  listenForConnectionEnds();
  const budget = budgetFor(machineId);
  if (budget.probeBusy) return Promise.reject(new ChannelBusyError('A connection check is already running.'));
  budget.probeBusy = true;
  const generation = budget.generation;
  let settled: Promise<T>;
  try {
    settled = run();
  } catch (error) {
    settled = Promise.reject(error);
  }
  const release = (): void => {
    if (budget.generation === generation) budget.probeBusy = false;
  };
  settled.then(release, release);
  return settled;
}

/**
 * Runs one command on the machine's connection once a slot is free. `admissionMs` bounds the wait for a slot only
 * (capped at `MAX_ADMISSION_WAIT_MS`); the command's own deadline starts when it runs. A command whose channel the
 * computer refused never ran, so it waits again (after a short pause) while its wait allows.
 */
export function withCommandChannel<T>(machineId: string, admissionMs: number, run: () => Promise<T>): Promise<T> {
  if (!budgeted()) {
    // Android: its native connection keeps the slots; with the lane, the stall watch still times each command.
    if (!nativeProbeLane()) return watchRefusal(machineId, tracked(machineId, run));
    const operation = noteOperationStarted(machineId);
    const settled = watchRefusal(machineId, tracked(machineId, run));
    settled.then(
      () => noteOperationEnded(machineId, operation, 'answered'),
      (error: unknown) => noteOperationEnded(machineId, operation, operationOutcome(error)),
    );
    return settled;
  }
  listenForConnectionEnds();
  const budget = budgetFor(machineId);
  if (budget.warmedGeneration !== budget.generation) {
    budget.warmedGeneration = budget.generation;
    budget.warmUntil = Date.now() + WARM_UP_MS;
  }
  const deadline = Date.now() + Math.max(0, Math.min(admissionMs, MAX_ADMISSION_WAIT_MS));
  return new Promise<T>((resolve, reject) => {
    let retries = 0;
    const attempt = (generation: number): void => {
      const startedAt = Date.now();
      const grantedAt = budget.lastGrantAt;
      const operation = noteOperationStarted(machineId);
      const settled = tracked(machineId, run);
      settled.then(
        (value) => {
          noteOperationEnded(machineId, operation, 'answered');
          // During the warm-up the latest command's answer lets the next one start now (one, not the whole queue).
          if (budget.generation === generation && Date.now() < budget.warmUntil && grantedAt === budget.lastGrantAt) {
            budget.lastGrantAt = Math.min(budget.lastGrantAt, Date.now() - WARM_UP_SPACING_MS);
          }
          release(generation);
          resolve(value);
        },
        (error: unknown) => {
          noteOperationEnded(machineId, operation, operationOutcome(error));
          // An open that failed only after the stall watch's wait is the iPhone's stuck connection, not the computer
          // refusing: no pause, no escape path, no retry; the watch checks the connection (src/remote/stallWatch.ts).
          const slow = isChannelRefusal(error) && isSlowOpenFailure(startedAt);
          if (slow && budget.generation === generation) noteSlowOpenFailure(machineId, Date.now() - startedAt);
          // A refusal from a connection that has since been replaced says nothing about the new one.
          const refused = !slow && isChannelRefusal(error) && budget.generation === generation;
          if (refused) budget.coolUntil = Date.now() + REFUSAL_COOL_MS;
          release(generation);
          // Reported once the refused command no longer counts as running, so the reset's guard sees only other work.
          if (refused) reportChannelRefused(machineId);
          if (refused && retries < REFUSAL_RETRIES && budget.generation === generation && Date.now() < deadline) {
            retries += 1;
            enqueue();
            return;
          }
          reject(error);
        },
      );
    };
    const release = (generation: number): void => {
      if (budget.generation !== generation) return;
      budget.inUse = Math.max(0, budget.inUse - 1);
      grantNext(budget);
    };
    const enqueue = (): void => {
      const waiter: Waiter = {
        grant: () => {
          clearTimeout(timer);
          budget.inUse += 1;
          attempt(budget.generation);
        },
        refuse: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      const timer = setTimeout(
        () => {
          const index = budget.queue.indexOf(waiter);
          if (index >= 0) budget.queue.splice(index, 1);
          reject(new ChannelBusyError());
        },
        Math.max(0, deadline - Date.now()),
      );
      budget.queue.push(waiter);
      grantNext(budget);
    };
    enqueue();
  });
}

/** Android: its connection keeps its own slots; a refusal still reaches the escape path. */
function watchRefusal<T>(machineId: string, settled: Promise<T>): Promise<T> {
  return settled.catch((error: unknown) => {
    if (isChannelRefusal(error)) reportChannelRefused(machineId);
    throw error;
  });
}
