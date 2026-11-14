/**
 * Each computer's connection: the heavy transfers under way on it, and when it last delivered
 * anything. The connection's liveness checks read it before they judge a quiet link.
 *
 * - Progress: anything that came back over the connection (a command's output, a chat answer or
 *   frame, a finished upload) proves it alive (`noteLinkProgress`).
 * - Heavy transfers: an upload, a chat snapshot the phone subscribed to, a large chat read. While one
 *   is under way the link may say nothing for a long time and still work (`beginLinkTransfer`).
 *   Small commands (the Sessions poll) do not count: a link that cannot answer them is not busy.
 *
 * CDXC:RemoteMachines 2026-11-10 WHY:
 * All of a computer's traffic shares one SSH connection, so on a slow link (a relayed Easy Connect
 * path, weak cellular) a big chat snapshot or an upload holds everything queued behind it. The quiet
 * chat's `GET /api/health` and the reconnect's `echo` probe waited behind that transfer, ran out
 * after 5 s, and the phone tore down a connection that was working: the upload or the snapshot was
 * lost, and the reconnect asked for the same snapshot again, a loop of "Reconnecting…" on a slow
 * link (user report, 2026-11-09). A probe only means something on an idle link; while a heavy
 * transfer runs, its own outcome (it arrives, or fails within its own deadline) says whether the
 * connection lives.
 * SEE-ALSO: src/remote/connection.ts (`ensureConnected`'s probe), src/chat/rust/machine-link.ts
 * (`checkQuiet`).
 */

type Transfer = { until: number; startedAt: number };

const transfers = new Map<string, Set<Transfer>>();
const lastProgressAt = new Map<string, number>();
const progressListeners = new Map<string, Set<() => void>>();
const idleListeners = new Map<string, Set<() => void>>();

function notify(listeners: Map<string, Set<() => void>>, machineId: string): void {
  const set = listeners.get(machineId);
  if (set === undefined) return;
  listeners.delete(machineId);
  for (const listener of set) listener();
}

function listen(listeners: Map<string, Set<() => void>>, machineId: string, listener: () => void): () => void {
  let set = listeners.get(machineId);
  if (set === undefined) {
    set = new Set();
    listeners.set(machineId, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}

/** Something came back over `machineId`'s connection. */
export function noteLinkProgress(machineId: string): void {
  lastProgressAt.set(machineId, Date.now());
  notify(progressListeners, machineId);
}

/** When `machineId`'s connection last delivered anything (0 when never). */
export function linkProgressAt(machineId: string): number {
  return lastProgressAt.get(machineId) ?? 0;
}

function liveTransfers(machineId: string): Set<Transfer> | undefined {
  const set = transfers.get(machineId);
  if (set === undefined) return undefined;
  const now = Date.now();
  for (const transfer of set) if (transfer.until <= now) set.delete(transfer);
  if (set.size === 0) transfers.delete(machineId);
  return transfers.get(machineId);
}

/** Whether a heavy transfer is under way on `machineId`'s connection. */
export function linkTransferring(machineId: string): boolean {
  return liveTransfers(machineId) !== undefined;
}

/**
 * How long a heavy transfer keeps a liveness check waiting after the link last delivered anything (or the newest
 * transfer began).
 *
 * CDXC:RemoteMachines 2026-11-14 WHY:
 * A check used to wait as long as any transfer lasted (an upload may run 10 minutes), so a 5 s check took 30 to 50 s
 * in Sebastian's exports while the connection may already have been dead. After 15 s with nothing delivered the check
 * runs anyway. Uploads report no progress to JavaScript, so a check that runs while a transfer is under way never
 * calls the link stalled (a slow upload is not a dead link): it can only find it answering, gone or unknown
 * (src/remote/connection.ts `probeConnection`).
 */
export const TRANSFER_SILENCE_MS = 15_000;

/** Whether a heavy transfer still keeps checks waiting: one is under way and the link spoke within the last 15 s. */
export function transferDefers(machineId: string, now = Date.now()): boolean {
  const set = liveTransfers(machineId);
  if (set === undefined) return false;
  let newestStart = 0;
  for (const transfer of set) newestStart = Math.max(newestStart, transfer.startedAt);
  return now - Math.max(linkProgressAt(machineId), newestStart) < TRANSFER_SILENCE_MS;
}

/**
 * Registers one heavy transfer on `machineId`'s connection for at most `maxMs`, its own deadline,
 * so one whose caller never ends it cannot keep the link exempt for good. Returns its end: pass
 * `true` when it delivered something, which counts as progress. Ending twice does nothing.
 */
export function beginLinkTransfer(machineId: string, maxMs: number): (delivered: boolean) => void {
  const transfer: Transfer = { until: Date.now() + maxMs, startedAt: Date.now() };
  let set = transfers.get(machineId);
  if (set === undefined) {
    set = new Set();
    transfers.set(machineId, set);
  }
  set.add(transfer);
  let ended = false;
  const end = (delivered: boolean): void => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    transfers.get(machineId)?.delete(transfer);
    if (delivered) noteLinkProgress(machineId);
    if (liveTransfers(machineId) === undefined) notify(idleListeners, machineId);
  };
  const timer = setTimeout(() => end(false), maxMs);
  return end;
}

/** Runs `task` as one heavy transfer on `machineId`'s connection. */
export async function trackLinkTransfer<T>(machineId: string, maxMs: number, task: () => Promise<T>): Promise<T> {
  const end = beginLinkTransfer(machineId, maxMs);
  try {
    const result = await task();
    end(true);
    return result;
  } catch (error) {
    end(false);
    throw error;
  }
}

/** Runs `task` over `machineId`'s connection; an answer counts as progress. */
export async function noteLinkAnswer<T>(machineId: string, task: Promise<T>): Promise<T> {
  const result = await task;
  noteLinkProgress(machineId);
  return result;
}

/**
 * While heavy transfers are under way on `machineId`'s connection, waits until anything comes back
 * after `since` (`progress`), every transfer has ended without delivering (`idle`), or the transfers
 * stopped deferring checks (`silent`: one is still under way, but nothing came for `TRANSFER_SILENCE_MS`).
 * Answers at once when something already came back, or nothing heavy is under way.
 */
export function waitForLinkProgressOrIdle(machineId: string, since: number): Promise<'progress' | 'idle' | 'silent'> {
  if (linkProgressAt(machineId) > since) return Promise.resolve('progress');
  if (!linkTransferring(machineId)) return Promise.resolve('idle');
  if (!transferDefers(machineId)) return Promise.resolve('silent');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (answer: 'progress' | 'idle' | 'silent'): void => {
      if (settled) return;
      settled = true;
      stopProgress();
      stopIdle();
      clearInterval(sweep);
      resolve(answer);
    };
    const stopProgress = listen(progressListeners, machineId, () => finish('progress'));
    const stopIdle = listen(idleListeners, machineId, () => finish('idle'));
    // A transfer past its deadline is swept here too, so the wait never outlives the longest one.
    const sweep = setInterval(() => {
      if (!linkTransferring(machineId)) finish('idle');
      else if (!transferDefers(machineId)) finish('silent');
    }, 1_000);
  });
}
