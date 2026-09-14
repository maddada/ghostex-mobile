import { GhostexNative } from '../../modules/ghostex-native/src';
import { resolveSshConfig, type MachineConnectionTarget } from '../machines/credentials';
import { forgetRemoteEnvironment } from './commands';

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
  options: { verify?: boolean; reset?: boolean } = {}
): Promise<void> {
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
    if (options.reset) {
      forgetRemoteEnvironment(machine.id);
      await GhostexNative.disconnect(machine.id);
      assertCurrent();
    } else if (await GhostexNative.isConnected(machine.id)) {
      assertCurrent();
      if (!options.verify) return;
      try {
        // echo is understood by POSIX shells, Windows cmd and PowerShell.
        const probe = await GhostexNative.exec(machine.id, 'echo __GHOSTEX_CONNECTED__', 5_000);
        assertCurrent();
        if (probe.exitCode === 0 && probe.stdout.includes('__GHOSTEX_CONNECTED__')) return;
      } catch {
        assertCurrent();
      }
    }
    assertCurrent();
    const config = await resolveSshConfig(machine);
    assertCurrent();
    forgetRemoteEnvironment(machine.id);
    await GhostexNative.connect(machine.id, config);
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

export function reconnectMachine(machine: MachineConnectionTarget): Promise<void> {
  return ensureConnected(machine, { reset: true });
}
