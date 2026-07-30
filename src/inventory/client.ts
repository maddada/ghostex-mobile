/**
 * Inventory client: runs `ghostex sessions --json --mobile-summary` over the
 * native SSH transport and maps failures to the human copy from
 * docs/specs/sessions-drawer.md §5 (matchers mirrored from the Android
 * reference implementation GhostexSessionInventoryClient).
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { loginShellCommand, sessionsListCommand } from '../commands/ghostexCli';
import {
  parseMobileSummary,
  scanJsonObjects,
  type GhostexMobileSummary,
} from '../contract/mobileSummary';
import { FailureCopy } from '../copy';
import { resolveSshConfig, type MachineConnectionTarget } from '../machines/credentials';

export const INVENTORY_EXEC_TIMEOUT_MS = 20000;

export type InventoryFetchResult = {
  summary: GhostexMobileSummary;
  /** Raw JSON text of the matched summary object; used for change-skip. */
  fingerprint: string;
};

/** Ensure the machine's SSH client is connected, connecting if needed. */
export async function ensureConnected(machine: MachineConnectionTarget): Promise<void> {
  const connected = await GhostexNative.isConnected(machine.id);
  if (connected) return;
  const config = await resolveSshConfig(machine);
  await GhostexNative.connect(machine.id, config);
}

/**
 * Fetch and parse the mobile summary for one machine. Throws an Error whose
 * message is the raw failure text (callers summarize via summarizeFailure).
 */
export async function fetchInventory(machine: MachineConnectionTarget): Promise<InventoryFetchResult> {
  await ensureConnected(machine);
  const result = await GhostexNative.exec(
    machine.id,
    loginShellCommand(sessionsListCommand()),
    INVENTORY_EXEC_TIMEOUT_MS,
  );
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.exitCode !== 0) {
    throw new Error(output.length > 0 ? output : FailureCopy.emptyOutput);
  }
  const summary = parseMobileSummary(result.stdout);
  if (summary === null) {
    throw new Error(output.length > 0 ? output : FailureCopy.noJson);
  }
  const fingerprint = fingerprintForOutput(result.stdout);
  return { summary, fingerprint };
}

/** The matched summary JSON text (falls back to the whole stdout). */
function fingerprintForOutput(stdout: string): string {
  const matched = scanJsonObjects<string>(stdout, (text, start) => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        Array.isArray((parsed as Record<string, unknown>).sessions)
      ) {
        return { done: true, result: text };
      }
      return { done: false, nextIndex: start + text.length };
    } catch {
      return { done: false, nextIndex: start + 1 };
    }
  });
  return matched ?? stdout;
}

/**
 * Failed CLI JSON (`{ok:false}` / `{bridgeOk:false}`) may follow shell/profile
 * snippets with unmatched braces; prefer its error/message field over raw text.
 */
function extractCliError(output: string): string | null {
  return scanJsonObjects<string | null>(output, (text, start) => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        const ok = typeof record.ok === 'boolean' ? record.ok : true;
        const bridgeOk = typeof record.bridgeOk === 'boolean' ? record.bridgeOk : true;
        if (!ok || !bridgeOk) {
          const error = typeof record.error === 'string' ? record.error.trim() : '';
          const message = typeof record.message === 'string' ? record.message.trim() : '';
          const resolved = error.length > 0 ? error : message;
          if (resolved.length > 0) return { done: true, result: resolved };
        }
      }
    } catch {
      // Shell/profile text can contain brace blocks; keep scanning.
    }
    return { done: false, nextIndex: start + text.length };
  });
}

/**
 * True when the failure text means "this machine's Ghostex predates the feature
 * being used". A CLI that does not know a verb answers `Unknown command: <verb>`
 * followed by its entire usage dump, and a daemon that does not know an endpoint
 * answers `No gxserver endpoint for <METHOD> <path>`. Neither text belongs in a
 * phone banner: the actionable part is "update Ghostex on the machine".
 */
export function isOutdatedMachineFailure(text: string | null | undefined): boolean {
  const lower = (text ?? '').toLowerCase();
  return lower.includes('unknown command:') || lower.includes('no gxserver endpoint for');
}

/**
 * Map raw SSH/CLI failure text to actionable copy (sessions-drawer.md §5).
 * Unmatched text is truncated to 220 chars + "...".
 */
export function summarizeFailure(raw: string | null | undefined, hasPassword: boolean): string {
  let text = (raw ?? '').trim();
  const cliError = extractCliError(text);
  if (cliError !== null) text = cliError;
  const lowerText = text.toLowerCase();
  if (
    text.includes('Host key verification failed') ||
    text.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')
  ) {
    return FailureCopy.hostKey;
  }
  if (text.includes('Permission denied')) {
    return hasPassword
      ? FailureCopy.permissionDeniedWithPassword
      : FailureCopy.permissionDeniedWithoutPassword;
  }
  if (text.includes('Connection refused')) return FailureCopy.refused;
  if (
    text.includes('Could not resolve') ||
    text.includes('Name or service not known') ||
    text.includes('No address associated with hostname') ||
    text.includes('No route to host') ||
    text.includes('Connection timed out') ||
    text.includes('Operation timed out')
  ) {
    return FailureCopy.unreachable;
  }
  if (
    lowerText.includes('ghostex: command not found') ||
    lowerText.includes('command not found: ghostex') ||
    lowerText.includes('ghostex not found')
  ) {
    return FailureCopy.noCli;
  }
  if (lowerText.includes('unknown command: android-check')) return FailureCopy.oldCli;
  if (isOutdatedMachineFailure(text)) return FailureCopy.outdatedForFeature;
  if (
    lowerText.includes('session persistence is set to') &&
    !lowerText.includes('session persistence is set to zmx')
  ) {
    return FailureCopy.persistenceNotZmx;
  }
  if (lowerText.includes('zmx') && (lowerText.includes('not found') || lowerText.includes('not configured'))) {
    return FailureCopy.zmxMissing;
  }
  if (text.length === 0) return FailureCopy.emptyOutput;
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

/** Recovery matcher: summarized message asks for a password (sessions-drawer.md §4). */
export function shouldPromptForPassword(message: string): boolean {
  return message.includes('SSH needs a key or password') || message.includes('SSH rejected');
}

/** Recovery matcher: summarized message asks for a host-key reset. */
export function shouldPromptForHostKeyReset(message: string): boolean {
  return message.includes('SSH host key verification failed');
}
