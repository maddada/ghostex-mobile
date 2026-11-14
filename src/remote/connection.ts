import { GhostexNative, type SshConfig } from '../../modules/ghostex-native/src';
import { getTailcatToken, resolveSshConfig, type MachineConnectionTarget } from '../machines/credentials';
import { forgetRemoteEnvironment } from './commands';
import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { isDemoMachine } from '../demo/identity';
import {
  checkEasyConnectOn,
  easyConnectDialCandidates,
  noteEasyConnectDial,
  refreshEasyConnectAddressesSoon,
} from '../machines/easyConnectDial';
import { noteConnectedThrough } from '../machines/duplicateComputers';
import { applyEasyConnectLinkKey } from '../machines/easyConnectLinkKeyState';
import { linkTransferring, noteLinkProgress, waitForLinkProgressOrIdle } from './linkActivity';
import { onPairingChanged, pairingEpoch, samePairing } from '../machines/pairingEpoch';
import {
  easyConnectConfig,
  fallbackChoice,
  hasEasyConnectRoute,
  knownEasyConnectOn,
  setActiveRoute,
  tailscaleOnPhone,
  withTailscaleHeadStart,
} from '../machines/easyConnectRoute';
import { routeDialOrder, triesOtherRoute } from '../machines/routeChoice';
import { logAppEvent } from '../app/appLog';
import { GXSERVER_FORWARD_HOST, knownGxserverPort } from '../chat/rust/serverEndpoint';
import {
  connectionGeneration,
  endConnectionBudget,
  isChannelRefusal,
  reportChannelRefused,
  withProbeChannel,
} from './channelBudget';
import { nativeProbeLane } from './probeLane';
import {
  isSlowOpenFailure,
  offerResetInstead,
  plainShellsOpen,
  STALL_SUSPECT_MS,
  type StallCheckOutcome,
} from './stallWatch';
import { channelSnapshot } from './channelPressure';
import { clearDialBackoff, dialWaitError, noteDialFailure, noteDialSuccess, unansweredDialCode } from './dialBackoff';
import { noteConnected } from './connectionTrace';
import { whereTheAppIs } from '../app/foregroundClock';

type Attempt = { promise: Promise<void>; reset: boolean; verify: boolean };
const attempts = new Map<string, Attempt>();
const revisions = new Map<string, number>();

export function cancelConnectionAttempt(machineId: string): void {
  revisions.set(machineId, (revisions.get(machineId) ?? 0) + 1);
  attempts.delete(machineId);
  forgetRemoteEnvironment(machineId);
}

/** Ends a computer's connection and its Easy Connect tunnel; never throws. */
async function dropConnection(machineId: string): Promise<void> {
  endConnectionBudget(machineId);
  await GhostexNative.disconnect(machineId).catch(() => undefined);
  await GhostexNative.stopTailcatForward(machineId).catch(() => undefined);
}

/*
 * CDXC:RemotePairing 2026-11-11 WHY:
 * An entry paired again or given another address is another pairing, maybe another computer: the
 * connect running under the address before is ended with its connection and tunnel, so nothing of
 * the computer before is dialled, reused or saved under the entry (machines/pairingEpoch.ts).
 */
onPairingChanged((machineId) => {
  cancelConnectionAttempt(machineId);
  clearDialBackoff(machineId, 'paired again');
  void dropConnection(machineId);
});

/**
 * CDXC:RemoteMachines 2026-09-14 WHY:
 * Inventory, chat and terminal opens share one connection attempt per computer.
 * Explicit Retry supersedes old work so a hung request cannot hold the recovery path hostage.
 */
export function ensureConnected(
  machine: MachineConnectionTarget,
  options: {
    verify?: boolean;
    reset?: boolean;
    /** Why the caller asks, for the log line written when this replaces a connection. */
    reason?: string;
    /** The person asked for this: it dials even while the computer waits after unanswered dials (dialBackoff.ts). */
    dialNow?: boolean;
  } = {},
): Promise<void> {
  // A Cloud Box has no SSH: its chat link reaches it through `cloudBoxes/boxLink.ts`.
  // The demo computer has no SSH either: its inventory is bundled on the phone.
  if (isCloudBoxMachineId(machine.id) || isDemoMachine(machine)) return Promise.resolve();
  if (options.reset === true || options.dialNow === true)
    clearDialBackoff(machine.id, options.reason ?? 'asked by the person');
  const existing = attempts.get(machine.id);
  if (existing && (!options.reset || existing.reset)) {
    return options.verify && !existing.verify && !existing.reset
      ? existing.promise.then(() =>
          ensureConnected(machine, { verify: true, ...(options.reason ? { reason: options.reason } : {}) }),
        )
      : existing.promise;
  }
  const revision = (revisions.get(machine.id) ?? 0) + 1;
  revisions.set(machine.id, revision);
  const epoch = pairingEpoch(machine.id);
  const assertCurrent = (): void => {
    if (revisions.get(machine.id) !== revision) {
      throw new Error('Connection attempt was replaced by a newer retry.');
    }
    if (!samePairing(machine.id, epoch)) {
      throw new Error('The computer was paired again while this connection attempt ran.');
    }
  };
  // A connection that came up after its attempt was replaced or the entry paired again is not kept:
  // the next ensureConnected would otherwise find it connected and use it (pairingEpoch.ts).
  const assertKept = async (): Promise<void> => {
    try {
      assertCurrent();
    } catch (error) {
      await dropConnection(machine.id);
      throw error;
    }
  };
  const promise = (async () => {
    let replaceExisting = options.reset === true;
    let replacedBecause = options.reason ?? 'reset';
    if (!replaceExisting && (await GhostexNative.isConnected(machine.id))) {
      assertCurrent();
      if (!options.verify) return;
      const startedAt = Date.now();
      const probe = await probeConnection(machine.id, startedAt);
      logAppEvent(`Connection: ${machine.id} check ${probe} in ${Date.now() - startedAt}ms`);
      // Busy or out of channels is a working connection: replacing it would only end what runs on it
      // (CDXC:RemoteMachines 2026-11-13 in src/remote/channelBudget.ts).
      if (probe === 'answered' || probe === 'busy' || probe === 'capacity' || probe === 'unknown') return;
      assertCurrent();
      /**
       * CDXC:RemoteMachines 2026-11-13 WHY:
       * The check's echo has its own lane now (src/remote/stallWatch.ts), so a stuck iPhone connection reaches
       * `stalled` here where it used to come back `busy` and be kept. Replacing it ends every plain shell's program,
       * so an automatic check (resume, network change, a failed read) follows the stall watch's rule: with a plain
       * shell open the connection is kept and the computer's Reset connection button shows. That holds for Easy
       * Connect too: it runs the same libssh2 session, and an echo that timed out does not prove its tunnel died. A
       * check that failed outright (`failed`: the socket is gone) still replaces it, and the user's Retry or Reset
       * (`reset: true`) never gets here and still replaces it.
       */
      const shells = plainShellsOpen(machine.id);
      if (probe === 'stalled' && shells > 0) {
        offerResetInstead(machine.id, `check ${probe}; ${shells} plain terminals open would end`);
        return;
      }
      if (probe === 'stalled' && machine.transport === 'tailcat') {
        /**
         * CDXC:RemotePairing 2026-11-07 WHY:
         * A probe that got no answer at all means the Easy Connect tunnel under SSH stalled (iOS
         * suspended the app, the network changed). Kept, the bridge would spend its own reuse check
         * (a disco ping of up to 4 s) finding the same thing before it builds a new tunnel, so the
         * phone waited about 9 s before it even began to reconnect (#490). A probe that failed at
         * once (the SSH socket closed) leaves the tunnel for the bridge to reuse.
         */
        await GhostexNative.stopTailcatForward(machine.id).catch(() => undefined);
        assertCurrent();
      }
      /**
       * CDXC:RemoteMachines 2026-09-22 WHY:
       * A connection that fails the probe is dead and must be torn down before the
       * replacement is dialed, not left in place until a new one lands. Native
       * isConnected keeps answering true for it, so if the reconnect fails (an
       * Easy Connect tunnel that died while iOS had the app suspended, a computer
       * that is briefly offline) every scheduled retry, which does not probe,
       * would return here as "connected" and the phone would never reconnect
       * until the app was killed.
       */
      replaceExisting = true;
      replacedBecause = `its check ${probe}${options.reason ? `, asked by ${options.reason}` : ''}`;
    }
    // A computer that did not answer its last dials is not dialled again before its wait ends (dialBackoff.ts).
    const waiting = dialWaitError(machine.id);
    if (waiting !== null) throw waiting;
    const dialStartedAt = Date.now();
    if (replaceExisting) {
      if (await GhostexNative.isConnected(machine.id).catch(() => false)) {
        // Before `endConnectionBudget` below refuses what waits on the old connection.
        logAppEvent(
          `Connection: ${machine.id} replaced by the phone (${replacedBecause}; app ${whereTheAppIs()}). ${channelSnapshot(machine.id)}`,
        );
      }
      forgetRemoteEnvironment(machine.id);
      endConnectionBudget(machine.id);
      await GhostexNative.disconnect(machine.id);
    }
    assertCurrent();
    const config = await resolveSshConfig(machine);
    assertCurrent();
    forgetRemoteEnvironment(machine.id);
    try {
      await dial(machine, config, epoch, assertCurrent, assertKept);
    } catch (error) {
      const code = unansweredDialCode(error);
      if (code !== null && samePairing(machine.id, epoch)) {
        noteDialFailure(machine.id, code, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
    noteDialSuccess(machine.id);
    noteConnected(machine, Date.now() - dialStartedAt);
  })();
  const attempt = { promise, reset: options.reset === true, verify: options.verify === true };
  attempts.set(machine.id, attempt);
  const clear = (): void => {
    if (attempts.get(machine.id) === attempt) attempts.delete(machine.id);
  };
  void promise.then(clear, clear);
  return promise;
}

/** Dials `machine` over the route it is set up for; throws the dial's failure. */
async function dial(
  machine: MachineConnectionTarget,
  config: SshConfig,
  epoch: number,
  assertCurrent: () => void,
  assertKept: () => Promise<void>,
): Promise<void> {
  if (machine.transport === 'tailcat') {
    const pairedAddress = await connectEasyConnect(machine, config, assertCurrent, assertKept);
    await assertKept();
    refreshEasyConnectAddressesSoon(machine, { epoch, pairedAddress });
  } else if (hasEasyConnectRoute(machine)) {
    await connectEitherRoute(machine, config, assertCurrent, assertKept);
    await assertKept();
    refreshEasyConnectAddressesSoon(machine, { epoch, pairedAddress: null, secondRoute: true });
    // Whether Easy Connect is still on there, so a computer that turned it off is not dialled
    // through it next time (CDXC:RemotePairing 2026-11-13 in machines/routeChoice.ts).
    setTimeout(() => {
      // Paired again or edited meanwhile: the answer would be another computer's.
      if (samePairing(machine.id, epoch)) void checkEasyConnectOn(machine);
    }, EASY_CONNECT_CHECK_DELAY_MS);
  } else {
    await GhostexNative.connect(machine.id, config);
  }
  await assertKept();
}

/** Waits after a connect before asking whether Easy Connect is on there, so the connect's own work goes first. */
const EASY_CONNECT_CHECK_DELAY_MS = 3_000;

/**
 * Dials a Tailscale or SSH computer that also has Easy Connect: Tailscale first, Easy Connect when
 * it doesn't answer, or Easy Connect first when Tailscale is off on this phone (routeChoice.ts,
 * CDXC:RemotePairing 2026-11-12). Throws the first route's failure when neither connects.
 */
async function connectEitherRoute(
  machine: MachineConnectionTarget,
  config: SshConfig,
  assertCurrent: () => void,
  assertKept: () => Promise<void>,
): Promise<void> {
  // Easy Connect only where the person chose to fall back to it (CDXC:RemotePairing 2026-11-13 in
  // machines/easyConnectRoute.ts) and the computer said its switch is on, checked before any relay
  // is probed; otherwise only the route the person set up, with its full time (CDXC:RemotePairing
  // 2026-11-13 in machines/routeChoice.ts).
  const easyConnectUsable =
    (await fallbackChoice(machine.id)) === 'yes' &&
    (await knownEasyConnectOn(machine.id)) === true &&
    (await easyConnectConfig(machine, config)) !== null &&
    (await easyConnectDialCandidates(machine.id)).length > 0;
  assertCurrent();
  if (!easyConnectUsable) {
    await GhostexNative.connect(machine.id, config);
    await GhostexNative.stopTailcatForward(machine.id).catch(() => undefined);
    setActiveRoute(machine.id, 'tailscale');
    return;
  }
  const order = routeDialOrder(await tailscaleOnPhone());
  assertCurrent();
  let firstError: unknown = null;
  for (const [index, route] of order.entries()) {
    const startedAt = Date.now();
    try {
      if (route === 'tailscale') {
        // A short head start only when Easy Connect is next; as the last try it keeps its full time.
        await GhostexNative.connect(machine.id, index === 0 ? withTailscaleHeadStart(config) : config);
        // The Easy Connect tunnel of an earlier connect is not needed on Tailscale.
        await GhostexNative.stopTailcatForward(machine.id).catch(() => undefined);
      } else {
        const routeConfig = await easyConnectConfig(machine, config);
        if (routeConfig === null) throw new Error('No Easy Connect key is saved for this computer.');
        if ((await easyConnectDialCandidates(machine.id)).length === 0) {
          throw new Error('No Easy Connect address is saved for this computer.');
        }
        await connectEasyConnect(machine, routeConfig, assertCurrent, assertKept);
      }
      setActiveRoute(machine.id, route);
      logAppEvent(`Connection: ${machine.id} connected over ${route} in ${Date.now() - startedAt}ms`);
      return;
    } catch (error) {
      firstError ??= error;
      const code = (error as { code?: unknown } | null)?.code;
      logAppEvent(
        `Connection: ${machine.id} could not connect over ${route} (${typeof code === 'string' ? code : 'error'})`,
      );
      if (!triesOtherRoute(code)) throw error;
      assertCurrent();
      // A half-built connection must not be what the other route's connect finds.
      await GhostexNative.disconnect(machine.id).catch(() => undefined);
    }
  }
  setActiveRoute(machine.id, null);
  throw firstError;
}

/**
 * Dials an Easy Connect machine at each of its addresses in turn (ours first, then the public
 * relays; CDXC:RemotePairing 2026-11-06 in machines/easyConnectAddresses.ts) until one connects,
 * and throws the last failure when none does.
 */
async function connectEasyConnect(
  machine: MachineConnectionTarget,
  config: SshConfig,
  assertCurrent: () => void,
  assertKept: () => Promise<void>,
): Promise<string | null> {
  // What a connect proves counts for the pairing it began under (machines/provenComputer.ts).
  const pairedAddress = await getTailcatToken(machine.id);
  const candidates = await easyConnectDialCandidates(machine.id);
  assertCurrent();
  // This computer's own key once it accepted one, the phone's shared key otherwise (easyConnectLinkKeyState.ts).
  await applyEasyConnectLinkKey(machine.id);
  assertCurrent();
  if (candidates.length === 0) {
    await GhostexNative.connect(machine.id, config);
    return pairedAddress;
  }
  for (let index = 0; ; index += 1) {
    const candidate = candidates[index]!;
    const next = candidates[index + 1] ?? null;
    const startedAt = Date.now();
    try {
      await GhostexNative.connect(machine.id, { ...config, tailcatToken: candidate.address });
    } catch (error) {
      noteEasyConnectDial(machine.id, candidate, { ok: false, elapsedMs: Date.now() - startedAt, next, error });
      if (next === null) throw error;
      assertCurrent();
      // A half-built connection must not be what the next address's connect finds.
      await GhostexNative.disconnect(machine.id).catch(() => undefined);
      continue;
    }
    // Paired again while it dialled: this connection is the computer's before, and is not kept.
    await assertKept();
    noteEasyConnectDial(machine.id, candidate, { ok: true, elapsedMs: Date.now() - startedAt });
    // This record reached the computer behind this address: an older record of the same computer stops now.
    noteConnectedThrough(machine.id, pairedAddress, candidate.address, (staleMachineId) => {
      cancelConnectionAttempt(staleMachineId);
      void GhostexNative.disconnect(staleMachineId).catch(() => undefined);
      void GhostexNative.stopTailcatForward(staleMachineId).catch(() => undefined);
    });
    return pairedAddress;
  }
}

/**
 * Whether the shared connection still answers, in order of precedence:
 * - `answered`: the echo came back (or, while a heavy transfer is under way, anything came back after `since`: the
 *   probe would only queue behind it; CDXC:RemoteMachines 2026-11-10 in src/remote/linkActivity.ts).
 * - `busy`: another check holds the probe lane (`E_BUSY`); this echo never left, so it says nothing. The echo runs in
 *   its own lane, never behind the command slots: three slow commands used to make every check `busy`, which kept an
 *   iPhone connection whose opens were stuck (src/remote/stallWatch.ts).
 * - `capacity`: the computer refused the echo's channel while the connection is up. A known gxserver forward is asked
 *   for the log only: its answer proves the link alive, and its silence (gxserver down, forwarding off) proves
 *   nothing about SSH. The refusal itself already went to the escape path (`channelPressure.ts`).
 * - `stalled`: the echo went out and got no answer in time, or its channel failed to open only after
 *   `STALL_SUSPECT_MS` (the iPhone's stuck open, not the computer refusing).
 * - `failed`: any other error, a wrong answer, or a channel refused on a connection that is gone or was replaced
 *   while the echo waited (that refusal is the old connection's and is reported against nothing).
 * - `unknown`: the check found nothing by its own deadline (`PROBE_GRACE_MS` past the echo's), or the echo got no
 *   answer while a heavy transfer was under way. It never replaces a connection by itself.
 * It never runs the chat handshake or dials: it asks only what already exists, so it cannot wait on the
 * `ensureConnected` it runs inside.
 */
export type ProbeOutcome = 'answered' | 'busy' | 'capacity' | 'stalled' | 'failed' | 'unknown';

/**
 * How long past the echo's own bound the whole check may take before it answers `unknown`.
 *
 * CDXC:RemoteMachines 2026-11-14 WHY:
 * The check had no deadline of its own: it waited for heavy transfers to end, and on the iPhone the echo's native
 * timeout needs the connection's actor, which a terminal's start can hold for up to 20 s. Exports showed a 5 s check
 * answering after 30 to 50 s. Now the check settles by its deadline whatever native does; `unknown` keeps the
 * connection, and the echo keeps the probe lane until its native call really ends, so a check that follows meanwhile
 * answers `busy` at once.
 */
const PROBE_GRACE_MS = 2_000;

async function probeConnection(machineId: string, since: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'unknown'>((resolve) => {
    timer = setTimeout(() => resolve('unknown'), timeoutMs + PROBE_GRACE_MS);
  });
  const checked = runProbe(machineId, since, timeoutMs);
  // What the abandoned check finds later is no longer anyone's answer.
  checked.catch(() => undefined);
  try {
    const outcome = await Promise.race([checked, late]);
    if (outcome === 'unknown') {
      logAppEvent(
        `Connection: ${machineId} check unknown after ${Date.now() - startedAt}ms (${linkTransferring(machineId) ? 'a large transfer is under way' : 'no answer by its deadline'}). ${channelSnapshot(machineId)}`,
      );
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

async function runProbe(machineId: string, since: number, timeoutMs: number): Promise<ProbeOutcome> {
  if ((await waitForLinkProgressOrIdle(machineId, since)) === 'progress') return 'answered';
  const outcome = await echoProbe(machineId, timeoutMs);
  // Uploads tell JavaScript nothing until they end, so an echo queued behind one proves nothing stuck.
  return outcome === 'stalled' && linkTransferring(machineId) ? 'unknown' : outcome;
}

async function echoProbe(machineId: string, timeoutMs: number): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  const generation = connectionGeneration(machineId);
  try {
    // echo is understood by POSIX shells, Windows cmd and PowerShell.
    const probe = await withProbeChannel(machineId, () =>
      // Android builds with the native lane run the check outside the command slots (src/remote/probeLane.ts).
      nativeProbeLane()
        ? GhostexNative.exec(machineId, 'echo __GHOSTEX_CONNECTED__', timeoutMs, 'probe')
        : GhostexNative.exec(machineId, 'echo __GHOSTEX_CONNECTED__', timeoutMs),
    );
    const answered = probe.exitCode === 0 && probe.stdout.includes('__GHOSTEX_CONNECTED__');
    if (answered) noteLinkProgress(machineId);
    return answered ? 'answered' : 'failed';
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (code === 'E_BUSY') return 'busy';
    if (isChannelRefusal(error) && isSlowOpenFailure(startedAt)) return 'stalled';
    if (isChannelRefusal(error)) {
      // Native isConnected names the computer, not the connection: a replacement that came up while the echo waited
      // answers true, so the generation is compared before and after asking.
      if (connectionGeneration(machineId) !== generation) return 'failed';
      if (!(await GhostexNative.isConnected(machineId).catch(() => false))) return 'failed';
      if (connectionGeneration(machineId) !== generation) return 'failed';
      // The echo's lane is outside the command budget, which reported refusals for it before; the escape path
      // (src/remote/channelPressure.ts) still needs to hear a fast one.
      reportChannelRefused(machineId);
      const http = await askKnownGxserver(machineId);
      logAppEvent(`Connection: ${machineId} refused the check's channel; gxserver over the forward: ${http}`);
      return 'capacity';
    }
    return code === 'E_TIMEOUT' ? 'stalled' : 'failed';
  }
}

/**
 * `GET /api/health` over the gxserver port a handshake already learned, or `no forward` when none did. It may open a
 * local listener for that port (never a new SSH connection or a handshake), and the whole question, the native
 * listener included, is bounded by `PROBE_TIMEOUT_MS`. It only feeds the log.
 */
async function askKnownGxserver(machineId: string): Promise<'answered' | 'no answer' | 'no forward'> {
  const port = knownGxserverPort(machineId);
  if (port === null) return 'no forward';
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'no answer'>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve('no answer');
    }, PROBE_TIMEOUT_MS);
  });
  const asked = (async (): Promise<'answered'> => {
    const { localPort } = await GhostexNative.startPortForward(machineId, port, GXSERVER_FORWARD_HOST);
    const response = await fetch(`http://127.0.0.1:${localPort}/api/health`, { signal: controller.signal });
    await response.text();
    return 'answered';
  })().catch((): 'no answer' => 'no answer');
  try {
    return await Promise.race([asked, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const PROBE_TIMEOUT_MS = 5_000;

/**
 * The stall watch's check (src/remote/stallWatch.ts): the same echo, bounded by `STALL_SUSPECT_MS`. A `failed` check
 * whose connection native now reports closed, with no newer connection since, is `lost`: the iPhone's SSH marks a
 * dead socket without sending a disconnect event, so nothing else would replace it.
 */
export async function checkStalledConnection(machineId: string): Promise<StallCheckOutcome> {
  const generation = connectionGeneration(machineId);
  const deadline = Date.now() + STALL_SUSPECT_MS + PROBE_GRACE_MS;
  const outcome = await probeConnection(machineId, Date.now(), STALL_SUSPECT_MS);
  if (outcome !== 'failed' || connectionGeneration(machineId) !== generation) return outcome;
  // The same deadline covers asking native whether the socket closed: on the iPhone that call waits for the
  // connection's actor, which a terminal's start can hold for 20 s (CDXC:RemoteMachines 2026-11-14 at PROBE_GRACE_MS).
  const connected = await withinDeadline(
    GhostexNative.isConnected(machineId).catch(() => null),
    deadline - Date.now(),
  );
  if (connected === 'late') {
    logAppEvent(`Connection: ${machineId} check unknown: no answer from the phone's SSH by the check's deadline`);
    return 'unknown';
  }
  if (connected !== false || connectionGeneration(machineId) !== generation) return outcome;
  return 'lost';
}

/** `task`'s answer, or `late` when it has none within `ms` (what it answers later is dropped). */
async function withinDeadline<T>(task: Promise<T>, ms: number): Promise<T | 'late'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<'late'>((resolve) => {
    timer = setTimeout(() => resolve('late'), Math.max(0, ms));
  });
  try {
    return await Promise.race([task, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function reconnectMachine(machine: MachineConnectionTarget, reason = 'Retry'): Promise<void> {
  return ensureConnected(machine, { reset: true, reason });
}
