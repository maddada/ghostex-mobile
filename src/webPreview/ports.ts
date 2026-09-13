/**
 * Web preview port discovery: runs `ghostex ports --json` on the machine over
 * the same SSH transport and failure mapping as the session inventory
 * (src/inventory/client.ts), and folds the CLI's per-(port, address) rows into
 * one row per port, which is the only thing the phone can forward.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { loginShellCommand, portsListCommand } from '../commands/ghostexCli';
import { scanJsonObjects } from '../contract/mobileSummary';
import { FailureCopy, WebPreviewCopy } from '../copy';
import {
  INVENTORY_EXEC_TIMEOUT_MS,
  ensureConnected,
  isOutdatedMachineFailure,
  summarizeFailure,
} from '../inventory/client';
import { hasPassword, type MachineConnectionTarget } from '../machines/credentials';

export type PortWebMetadata = {
  scheme: 'http' | 'https';
  status: number;
  kind: 'page' | 'service';
  title: string | null;
  server: string | null;
  contentType: string | null;
  faviconDataUrl: string | null;
};

/** One listening TCP port on the machine, merged across its bind addresses. */
export type RemoteListeningPort = {
  port: number;
  /** Every address the port was seen bound to, in CLI order. */
  addresses: string[];
  /** Process name, when the CLI could read it. */
  command: string | null;
  pid: number | null;
  web: PortWebMetadata | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function parseWebMetadata(value: unknown): PortWebMetadata | null {
  if (!isRecord(value) || (value.scheme !== 'http' && value.scheme !== 'https')) return null;
  if ((value.kind !== 'page' && value.kind !== 'service') || typeof value.status !== 'number') return null;
  const icon = optionalString(value.faviconDataUrl);
  return {
    scheme: value.scheme,
    status: value.status,
    kind: value.kind,
    title: optionalString(value.title),
    server: optionalString(value.server),
    contentType: optionalString(value.contentType),
    faviconDataUrl: icon !== null && icon.length <= 24 * 1024 && /^data:image\/(png|jpeg|gif|webp);base64,/.test(icon) ? icon : null,
  };
}

/**
 * Fold the CLI rows into one entry per port. A server bound to both `127.0.0.1`
 * and `[::1]`, or two processes sharing a port through SO_REUSEPORT, is still a
 * single thing the user can preview, and the forward reaches the same listener
 * either way. The first row that names a process wins, because the CLI already
 * sorted by (port, address).
 */
function mergeByPort(rows: unknown[]): RemoteListeningPort[] {
  const byPort = new Map<number, RemoteListeningPort>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const port = optionalInteger(row.port);
    if (port === null || port < 1 || port > 65535) continue;
    const address = optionalString(row.address);
    const existing = byPort.get(port);
    if (existing === undefined) {
      byPort.set(port, {
        port,
        addresses: address === null ? [] : [address],
        command: optionalString(row.command),
        pid: optionalInteger(row.pid),
        web: parseWebMetadata(row.web),
      });
      continue;
    }
    if (address !== null && !existing.addresses.includes(address)) existing.addresses.push(address);
    if (existing.command === null) existing.command = optionalString(row.command);
    if (existing.web === null) existing.web = parseWebMetadata(row.web);
    if (existing.pid === null) existing.pid = optionalInteger(row.pid);
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port);
}

/** The `{ "ports": [...] }` payload, skipping any shell/profile banner text. */
function parsePortsPayload(stdout: string): RemoteListeningPort[] | null {
  return scanJsonObjects<RemoteListeningPort[]>(stdout, (text, start) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { done: false, nextIndex: start + 1 };
    }
    if (isRecord(parsed) && Array.isArray(parsed.ports)) {
      return { done: true, result: mergeByPort(parsed.ports) };
    }
    return { done: false, nextIndex: start + text.length };
  });
}

/**
 * List the machine's listening ports. Throws an Error whose message is already
 * user-facing copy; a machine whose Ghostex predates the `ports` verb gets the
 * specific "update Ghostex, or enter a port manually" line instead of the
 * generic outdated-machine one, because manual entry still works here.
 */
export async function fetchRemotePorts(machine: MachineConnectionTarget, includeWebMetadata = false): Promise<RemoteListeningPort[]> {
  try {
    await ensureConnected(machine);
    const result = await GhostexNative.exec(
      machine.id,
      loginShellCommand(portsListCommand(includeWebMetadata)),
      includeWebMetadata ? 30000 : INVENTORY_EXEC_TIMEOUT_MS
    );
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.exitCode !== 0) {
      throw new Error(output.length > 0 ? output : FailureCopy.emptyOutput);
    }
    const ports = parsePortsPayload(result.stdout);
    if (ports === null) {
      throw new Error(output.length > 0 ? output : FailureCopy.noJson);
    }
    return ports;
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    if (isOutdatedMachineFailure(raw)) throw new Error(WebPreviewCopy.oldCli);
    throw new Error(summarizeFailure(raw, await hasPassword(machine.id)));
  }
}
