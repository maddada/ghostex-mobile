import { execRemoteCommand } from '../../remote/commands';
/**
 * Remote Ghostex CLI action runner for the sessions drawer: wraps a builder
 * command from src/commands/ghostexCli.ts in the login shell, executes it over
 * the machine's SSH client, and surfaces `{ok:false}` / non-zero exits as
 * summarized failure copy (sessions-drawer.md §5).
 */

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
 * A failed CLI run: `message` is the summarized §5 copy shown to the person, `raw` the command's
 * own output, for a caller that must read what the computer said (New Coordinator's "created, but
 * its agent did not start") and for Details.
 */
export class GhostexCliFailure extends Error {
  readonly raw: string;

  constructor(message: string, raw: string) {
    super(message);
    this.raw = raw;
  }
}

/**
 * Run a ghostex CLI command on the machine. Throws a `GhostexCliFailure` whose message is
 * already summarized to the §5 failure copy when the command fails (non-zero
 * exit or `{ok:false}` payload), with the raw output kept apart.
 */
export async function runGhostexCli(
  machine: MachineConnectionTarget,
  command: string,
  options?: { timeoutMs?: number },
): Promise<CliJsonResult> {
  try {
    await ensureConnected(machine);
    const result = await execRemoteCommand(machine.id, command, options?.timeoutMs ?? INVENTORY_EXEC_TIMEOUT_MS);
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
    throw new GhostexCliFailure(summarizeFailure(raw, machineHasPassword), raw);
  }
}

/** Created-session id from create commands or the fork command's `{fork:{session}}` result. */
export function createdSessionId(result: CliJsonResult): string | null {
  if (result.json === null) return null;
  const payload = 'fork' in result.json ? result.json.fork : result.json;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const session = (payload as Record<string, unknown>).session;
  if (typeof session !== 'object' || session === null || Array.isArray(session)) return null;
  const sessionId = (session as Record<string, unknown>).sessionId;
  if (typeof sessionId !== 'string') return null;
  const trimmed = sessionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}
