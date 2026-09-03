/**
 * Test connection for the machine form: open SSH with the form's config under
 * a throwaway machine id, then on the same connection read `ghostex server
 * version` and the mobile session summary so the result can say what it
 * actually checked ("Reached X. SSH as user works. Ghostex 1.42 is installed and
 * has 4 sessions."), and tear everything down again.
 */

import { GhostexNative, type SshConfig } from '../../../modules/ghostex-native/src';
import { logAppEvent } from '../../app/appLog';
import { loginShellCommand, sessionsListCommand } from '../../commands/ghostexCli';
import { parseMobileSummary } from '../../contract/mobileSummary';
import { FailureCopy } from '../../copy';
import { summarizeFailureDetailed, type FailureSummary } from '../../inventory/client';

/**
 * Machine id every test runs under. Stable on purpose: a fresh id per press
 * would leave one tailcat forward (a whole tunnel stack) behind for each press.
 */
export const TEST_MACHINE_ID = 'machine-form-test';

const VERSION_COMMAND = 'ghostex server version';
const EXEC_TIMEOUT_MS = 15000;

export type ConnectionTestOutcome =
  | {
      ok: true;
      /** Null when the login shell could not run `ghostex` for this user. */
      version: string | null;
      sessionCount: number;
    }
  | ({ ok: false } & FailureSummary);

export type ConnectionTestPlan = {
  config: SshConfig;
  hasPassword: boolean;
  /** Set when the test pinned a host key under an identity that will not exist after save. */
  throwawayPinnedHost: string | null;
  tailcat: boolean;
};

/** `ghostex server version` prints the version on its own line; ignore shell noise around it. */
function parseVersion(stdout: string): string | null {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^v?\d+\.\d+/u.test(lines[index])) return lines[index].replace(/^v/u, '');
  }
  return null;
}

const CLI_MISSING_TEXT = /command not found|not found|No such file/iu;

/**
 * Null only when the login shell cannot resolve `ghostex` (the "installed for
 * this user?" answer); any other non-zero exit is a real error and throws.
 */
async function readVersion(): Promise<string | null> {
  const result = await GhostexNative.exec(
    TEST_MACHINE_ID,
    loginShellCommand(VERSION_COMMAND),
    EXEC_TIMEOUT_MS,
  );
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    if (CLI_MISSING_TEXT.test(output)) return null;
    throw new Error(output.length > 0 ? output : `${VERSION_COMMAND} exited with code ${result.exitCode}`);
  }
  const version = parseVersion(result.stdout);
  if (version === null) throw new Error(output.length > 0 ? output : FailureCopy.noJson);
  return version;
}

async function readSessionCount(): Promise<number> {
  const result = await GhostexNative.exec(
    TEST_MACHINE_ID,
    loginShellCommand(sessionsListCommand()),
    EXEC_TIMEOUT_MS,
  );
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    throw new Error(output.length > 0 ? output : FailureCopy.emptyOutput);
  }
  const summary = parseMobileSummary(result.stdout);
  if (summary === null) throw new Error(output.length > 0 ? output : FailureCopy.noJson);
  return summary.sessions.length;
}

/** Cleanup after a test must never replace the outcome being reported. */
async function cleanupQuietly(step: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    logAppEvent(`Test connection cleanup (${step}) failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runConnectionTest(plan: ConnectionTestPlan): Promise<ConnectionTestOutcome> {
  try {
    await GhostexNative.connect(TEST_MACHINE_ID, plan.config);
    try {
      const version = await readVersion();
      const sessionCount = version === null ? 0 : await readSessionCount();
      return { ok: true, version, sessionCount };
    } finally {
      await cleanupQuietly('disconnect', () => GhostexNative.disconnect(TEST_MACHINE_ID));
    }
  } catch (error) {
    // The test client may never have registered; a failed disconnect is not the outcome.
    await cleanupQuietly('disconnect', () => GhostexNative.disconnect(TEST_MACHINE_ID));
    return { ok: false, ...summarizeFailureDetailed(error, plan.hasPassword) };
  } finally {
    if (plan.tailcat) {
      // Unlike a saved machine, the test forward must not outlive the test: it owns a
      // full tunnel stack, and the next press reuses this same id.
      await cleanupQuietly('stop forward', () => GhostexNative.stopTailcatForward(TEST_MACHINE_ID));
    }
    if (plan.throwawayPinnedHost !== null) {
      // Drop the host key this test pinned under the shared test identity, so testing a
      // different machine next cannot be rejected as a host-key mismatch.
      const host = plan.throwawayPinnedHost;
      await cleanupQuietly('reset host key', () => GhostexNative.resetHostKey(host, plan.config.port));
    }
  }
}
