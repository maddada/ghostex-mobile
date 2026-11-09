import { GhostexNative, type SshConfig } from '../../modules/ghostex-native/src';
import { resolveSshConfig, type MachineConnectionTarget } from '../machines/credentials';
import { forgetRemoteEnvironment } from './commands';
import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { isDemoMachine } from '../demo/identity';
import {
  easyConnectDialCandidates,
  noteEasyConnectDial,
  refreshEasyConnectAddressesSoon,
} from '../machines/easyConnectDial';
import { noteLinkProgress, waitForLinkProgressOrIdle } from './linkActivity';

type Attempt = { promise: Promise<void>; reset: boolean; verify: boolean };
const attempts = new Map<string, Attempt>();
const revisions = new Map<string, number>();

export function cancelConnectionAttempt(machineId: string): void {
  revisions.set(machineId, (revisions.get(machineId) ?? 0) + 1);
  attempts.delete(machineId);
  forgetRemoteEnvironment(machineId);
}

/**
 * CDXC:RemoteMachines 2026-09-14 WHY:
 * Inventory, chat and terminal opens share one connection attempt per computer.
 * Explicit Retry supersedes old work so a hung request cannot hold the recovery path hostage.
 */
export function ensureConnected(
  machine: MachineConnectionTarget,
  options: { verify?: boolean; reset?: boolean } = {},
): Promise<void> {
  // A Cloud Box has no SSH: its chat link reaches it through `cloudBoxes/boxLink.ts`.
  // The demo computer has no SSH either: its inventory is bundled on the phone.
  if (isCloudBoxMachineId(machine.id) || isDemoMachine(machine)) return Promise.resolve();
  const existing = attempts.get(machine.id);
  if (existing && (!options.reset || existing.reset)) {
    return options.verify && !existing.verify && !existing.reset
      ? existing.promise.then(() => ensureConnected(machine, { verify: true }))
      : existing.promise;
  }
  const revision = (revisions.get(machine.id) ?? 0) + 1;
  revisions.set(machine.id, revision);
  const assertCurrent = (): void => {
    if (revisions.get(machine.id) !== revision) {
      throw new Error('Connection attempt was replaced by a newer retry.');
    }
  };
  const promise = (async () => {
    let replaceExisting = options.reset === true;
    if (!replaceExisting && (await GhostexNative.isConnected(machine.id))) {
      assertCurrent();
      if (!options.verify) return;
      const probe = await probeConnection(machine.id, Date.now());
      if (probe === 'answered') return;
      assertCurrent();
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
    }
    if (replaceExisting) {
      forgetRemoteEnvironment(machine.id);
      await GhostexNative.disconnect(machine.id);
    }
    assertCurrent();
    const config = await resolveSshConfig(machine);
    assertCurrent();
    forgetRemoteEnvironment(machine.id);
    if (machine.transport === 'tailcat') {
      await connectEasyConnect(machine, config, assertCurrent);
      refreshEasyConnectAddressesSoon(machine);
    } else {
      await GhostexNative.connect(machine.id, config);
    }
    assertCurrent();
  })();
  const attempt = { promise, reset: options.reset === true, verify: options.verify === true };
  attempts.set(machine.id, attempt);
  const clear = (): void => {
    if (attempts.get(machine.id) === attempt) attempts.delete(machine.id);
  };
  void promise.then(clear, clear);
  return promise;
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
): Promise<void> {
  const candidates = await easyConnectDialCandidates(machine.id);
  assertCurrent();
  if (candidates.length === 0) {
    await GhostexNative.connect(machine.id, config);
    return;
  }
  for (let index = 0; ; index += 1) {
    const candidate = candidates[index]!;
    const next = candidates[index + 1] ?? null;
    const startedAt = Date.now();
    try {
      await GhostexNative.connect(machine.id, { ...config, tailcatToken: candidate.address });
      noteEasyConnectDial(machine.id, candidate, { ok: true, elapsedMs: Date.now() - startedAt });
      return;
    } catch (error) {
      noteEasyConnectDial(machine.id, candidate, { ok: false, elapsedMs: Date.now() - startedAt, next, error });
      if (next === null) throw error;
      assertCurrent();
      // A half-built connection must not be what the next address's connect finds.
      await GhostexNative.disconnect(machine.id).catch(() => undefined);
    }
  }
}

/**
 * Whether the shared connection still answers: `answered`, `stalled` (no answer within the probe's
 * time) or `failed` (an error or a wrong answer). While a heavy transfer is under way the probe
 * would only queue behind it, so the transfer's own outcome answers first: anything that comes back
 * after `since` counts as `answered`, and only a link left idle is probed (CDXC:RemoteMachines
 * 2026-11-10 in src/remote/linkActivity.ts).
 */
async function probeConnection(machineId: string, since: number): Promise<'answered' | 'stalled' | 'failed'> {
  if ((await waitForLinkProgressOrIdle(machineId, since)) === 'progress') return 'answered';
  try {
    // echo is understood by POSIX shells, Windows cmd and PowerShell.
    const probe = await GhostexNative.exec(machineId, 'echo __GHOSTEX_CONNECTED__', PROBE_TIMEOUT_MS);
    const answered = probe.exitCode === 0 && probe.stdout.includes('__GHOSTEX_CONNECTED__');
    if (answered) noteLinkProgress(machineId);
    return answered ? 'answered' : 'failed';
  } catch (error) {
    return (error as { code?: unknown } | null)?.code === 'E_TIMEOUT' ? 'stalled' : 'failed';
  }
}

const PROBE_TIMEOUT_MS = 5_000;

export function reconnectMachine(machine: MachineConnectionTarget): Promise<void> {
  return ensureConnected(machine, { reset: true });
}
