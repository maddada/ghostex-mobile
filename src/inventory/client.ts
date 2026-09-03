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
 * Expo wraps every native throw in its own exception chain before it reaches JS:
 * `FunctionCallException: Calling the 'connect' function has failed (at
 * ExpoModulesCore/ConcurrentFunctionDefinition.swift:88)\n→ Caused by:
 * GhostexException: <the real message>`. Both platforms build that chain with the
 * exact same fixed separator (`Exception.swift` on iOS, `CodedException.kt` on
 * Android), so the innermost cause is recoverable by splitting on it. Everything
 * above the last separator is bridge plumbing that no user can act on, and it eats
 * ~110 characters of the 220-character summary budget below.
 */
const EXPO_CAUSE_SEPARATOR = /\n?→ Caused by: /;
/** The chain also prefixes each link with its native class name... */
const NATIVE_EXCEPTION_PREFIX = /^[A-Za-z_][A-Za-z0-9_.]*Exception: /;
/** ...and appends the source location the link was thrown from. */
const NATIVE_EXCEPTION_ORIGIN = / \(at [^()\s]+:\d+\)$/;

/** The innermost cause of an Expo bridge exception chain, or `text` unchanged. */
export function unwrapNativeException(text: string): string {
  const links = text.split(EXPO_CAUSE_SEPARATOR);
  const innermost = links[links.length - 1]?.trim() ?? text;
  return innermost.replace(NATIVE_EXCEPTION_PREFIX, '').replace(NATIVE_EXCEPTION_ORIGIN, '').trim();
}

/**
 * Why a connection failed, coarse enough to pick a checklist on the "Can't
 * reach" screen and the "Other reasons" rows under it.
 */
export type FailureReasonCode =
  | 'timeout'
  | 'noRoute'
  | 'sshRefused'
  | 'authFailed'
  | 'hostKeyChanged'
  | 'ghostexMissing'
  | 'unknown';

export type FailureSummary = {
  /** Actionable copy (sessions-drawer.md §5); unmatched text is truncated to 220 chars. */
  message: string;
  reasonCode: FailureReasonCode;
  /** ISO timestamp of the last successful connection, when the caller knows it. */
  lastReachedAt?: string;
};

/**
 * Contract error codes (GhostexErrors.kt / GhostexErrors.swift) a rejected
 * native call carries as `error.code`; the primary reason signal.
 */
const NATIVE_CODE_REASONS: Readonly<Record<string, FailureReasonCode>> = {
  E_AUTH_FAILED: 'authFailed',
  E_HOST_KEY_MISMATCH: 'hostKeyChanged',
  E_REFUSED: 'sshRefused',
  E_UNREACHABLE: 'noRoute',
  E_TIMEOUT: 'timeout',
};

function nativeReasonCode(error: unknown): FailureReasonCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? (NATIVE_CODE_REASONS[code] ?? null) : null;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return error === null || error === undefined ? '' : String(error);
}

/**
 * Map a failure (a rejected native call, an Error, or raw CLI text) to
 * actionable copy plus a reason code. The native `code` decides the reason when
 * present; the message regexes below only classify text that carries no code.
 * Pass `lastReachedAt` (the machine's `lastConnectedAt`) so the summary can say
 * when the computer last answered.
 */
export function summarizeFailureDetailed(
  error: unknown,
  hasPassword: boolean,
  lastReachedAt?: string | null,
): FailureSummary {
  const classified = classifyFailure(error, hasPassword);
  return lastReachedAt === undefined || lastReachedAt === null
    ? classified
    : { ...classified, lastReachedAt };
}

/** Map raw SSH/CLI failure text to actionable copy (sessions-drawer.md §5). */
export function summarizeFailure(raw: unknown, hasPassword: boolean): string {
  return classifyFailure(raw, hasPassword).message;
}

/** "Connection timed out" / "Operation timed out" / "connect timed out"; never `--timeout` from a usage dump. */
const TIMED_OUT_TEXT = /\b(?:connection|operation|connect|read|dial|handshake)\s+timed out\b/iu;

function classifyFailure(
  error: unknown,
  hasPassword: boolean,
): Pick<FailureSummary, 'message' | 'reasonCode'> {
  let text = unwrapNativeException(errorText(error).trim());
  const cliError = extractCliError(text);
  if (cliError !== null) text = cliError;
  const lowerText = text.toLowerCase();
  const nativeCode = nativeReasonCode(error);
  const reason = (byText: FailureReasonCode): FailureReasonCode => nativeCode ?? byText;

  if (
    nativeCode === 'hostKeyChanged' ||
    text.includes('Host key verification failed') ||
    text.includes('REMOTE HOST IDENTIFICATION HAS CHANGED')
  ) {
    return { message: FailureCopy.hostKey, reasonCode: 'hostKeyChanged' };
  }
  if (nativeCode === 'authFailed' || text.includes('Permission denied')) {
    return {
      message: hasPassword
        ? FailureCopy.permissionDeniedWithPassword
        : FailureCopy.permissionDeniedWithoutPassword,
      reasonCode: 'authFailed',
    };
  }
  if (nativeCode === 'sshRefused' || text.includes('Connection refused')) {
    return { message: FailureCopy.refused, reasonCode: 'sshRefused' };
  }
  // CLI-side failures come as plain text (no native code) and can embed a usage
  // dump, so they are recognised before any substring match on the transport words.
  if (
    lowerText.includes('ghostex: command not found') ||
    lowerText.includes('command not found: ghostex') ||
    lowerText.includes('ghostex not found')
  ) {
    return { message: FailureCopy.noCli, reasonCode: 'ghostexMissing' };
  }
  if (lowerText.includes('unknown command: android-check')) {
    return { message: FailureCopy.oldCli, reasonCode: 'ghostexMissing' };
  }
  if (isOutdatedMachineFailure(text)) {
    return { message: FailureCopy.outdatedForFeature, reasonCode: 'ghostexMissing' };
  }
  if (nativeCode === 'timeout' || TIMED_OUT_TEXT.test(text)) {
    return { message: FailureCopy.timedOut, reasonCode: 'timeout' };
  }
  if (
    nativeCode === 'noRoute' ||
    text.includes('Could not resolve') ||
    text.includes('Name or service not known') ||
    text.includes('No address associated with hostname') ||
    text.includes('No route to host') ||
    lowerText.includes('network is unreachable')
  ) {
    return { message: FailureCopy.unreachable, reasonCode: 'noRoute' };
  }
  if (
    lowerText.includes('session persistence is set to') &&
    !lowerText.includes('session persistence is set to zmx')
  ) {
    return { message: FailureCopy.persistenceNotZmx, reasonCode: reason('unknown') };
  }
  if (lowerText.includes('zmx') && (lowerText.includes('not found') || lowerText.includes('not configured'))) {
    return { message: FailureCopy.zmxMissing, reasonCode: reason('unknown') };
  }
  if (text.length === 0) return { message: FailureCopy.emptyOutput, reasonCode: reason('unknown') };
  return {
    message: text.length > 220 ? `${text.slice(0, 220)}...` : text,
    reasonCode: reason('unknown'),
  };
}

/** Recovery matcher: summarized message asks for a password (sessions-drawer.md §4). */
export function shouldPromptForPassword(message: string): boolean {
  return message.includes('SSH needs a key or password') || message.includes('SSH rejected');
}

/** Recovery matcher: summarized message asks for a host-key reset. */
export function shouldPromptForHostKeyReset(message: string): boolean {
  return message.includes('SSH host key verification failed');
}
