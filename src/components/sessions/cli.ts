/**
 * Remote Ghostex CLI action runner for the sessions drawer: wraps a builder
 * command from src/commands/ghostexCli.ts in the login shell, executes it over
 * the machine's SSH client, and surfaces `{ok:false}` / non-zero exits as
 * summarized failure copy (sessions-drawer.md §5).
 */

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { loginShellCommand } from '../../commands/ghostexCli';
import { scanJsonObjects } from '../../contract/mobileSummary';
import { ensureConnected, INVENTORY_EXEC_TIMEOUT_MS, summarizeFailure } from '../../inventory/client';
import { hasPassword, type MachineConnectionTarget } from '../../machines/credentials';

export type CliJsonResult = {
  /** First balanced JSON object in stdout, when present. */
  json: Record<string, unknown> | null;
  stdout: string;
};

function firstJsonObject(output: string): Record<string, unknown> | null {
  return scanJsonObjects<Record<string, unknown>>(output, (text, start) => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return { done: true, result: parsed as Record<string, unknown> };
      }
    } catch {
      // Shell banners can contain brace blocks; keep scanning.
    }
    return { done: false, nextIndex: start + 1 };
  });
}

/**
 * Run a ghostex CLI command on the machine. Throws an Error whose message is
 * already summarized to the §5 failure copy when the command fails (non-zero
 * exit or `{ok:false}` payload).
 */
export async function runGhostexCli(
  machine: MachineConnectionTarget,
  command: string,
): Promise<CliJsonResult> {
  try {
    await ensureConnected(machine);
    const result = await GhostexNative.exec(
      machine.id,
      loginShellCommand(command),
      INVENTORY_EXEC_TIMEOUT_MS,
    );
    const output = `${result.stdout}\n${result.stderr}`.trim();
    const json = firstJsonObject(result.stdout);
    const ok = json === null || typeof json.ok !== 'boolean' || json.ok;
    if (result.exitCode !== 0 || !ok) {
      throw new Error(output);
    }
    return { json, stdout: result.stdout };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    const machineHasPassword = await hasPassword(machine.id);
    throw new Error(summarizeFailure(raw, machineHasPassword));
  }
}

/** Created-session id from a `{ok:true, session:{sessionId}}` payload. */
export function createdSessionId(result: CliJsonResult): string | null {
  if (result.json === null) return null;
  const session = result.json.session;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return null;
  const sessionId = (session as Record<string, unknown>).sessionId;
  if (typeof sessionId !== 'string') return null;
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}
