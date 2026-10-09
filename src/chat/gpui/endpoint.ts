/**
 * Where a computer's gxserver is for the GPUI chat: the Rust chat host inside the phone library
 * (the desktop's own `gx_chat`) opens its chat socket and direct calls to it, the way the desktop's
 * remote chats reach a computer through their tunnel.
 *
 * The computer tells its port and bearer token over SSH (`ghostex server endpoint`), and the phone
 * forwards its loopback to that port through the SSH session it already holds (the Web Preview's
 * `startPortForward`). The answer is cached per computer; a failed chat drops it so the next open
 * resolves again.
 */
import { GhostexNative } from '../../../modules/ghostex-native/src';
import { execRemoteCommand } from '../../remote/commands';
import { ensureConnected } from '../../inventory/client';
import type { MachineConnectionTarget } from '../../machines/credentials';

export type GpuiMachineEndpoint = {
  machineId: string;
  /** `http://127.0.0.1:<local forward port>` on the phone. */
  baseUrl: string;
  authToken: string;
};

const ENDPOINT_TIMEOUT_MS = 20_000;

/**
 * The address the computer's end of the forward dials: gxserver binds `127.0.0.1` only, as the
 * desktop's tunnels (`server/src/ghostex_cli/rpc.rs`) know. The forward's default `localhost` broke
 * every request to a Windows computer (CDXC:Mobile 2026-10-09 in `GhostexSshConnection.kt`).
 */
export const GXSERVER_FORWARD_HOST = '127.0.0.1';

const resolved = new Map<string, Promise<GpuiMachineEndpoint>>();

/** The forward and token for `machine`, resolving them on first use. */
export function gpuiMachineEndpoint(machine: MachineConnectionTarget): Promise<GpuiMachineEndpoint> {
  let pending = resolved.get(machine.id);
  if (!pending) {
    pending = resolveEndpoint(machine);
    resolved.set(machine.id, pending);
    pending.catch(() => resolved.delete(machine.id));
  }
  return pending;
}

/** Drops a cached endpoint (the forward died, the computer's gxserver restarted on a new port). */
export function forgetGpuiMachineEndpoint(machineId: string): void {
  resolved.delete(machineId);
}

/**
 * What `ghostex server endpoint` answered: the daemon's port, token and wire protocol; a computer
 * whose Ghostex predates the verb; or a verb that ran but found no daemon to describe.
 */
export type ServerEndpointAnswer =
  | { kind: 'endpoint'; port: number; authToken: string; protocolVersion: number | null; capabilities: string[] }
  | { kind: 'unsupported'; message: string }
  | { kind: 'failed'; message: string };

/**
 * Asks the computer where its gxserver is, over one SSH exec. Throws only when SSH itself fails;
 * the phone's chat link (`../rust/machine-link.ts`) uses the answer as its handshake.
 */
export async function readServerEndpoint(machine: MachineConnectionTarget): Promise<ServerEndpointAnswer> {
  await ensureConnected(machine);
  const exec = await execRemoteCommand(machine.id, 'ghostex server endpoint', ENDPOINT_TIMEOUT_MS);
  const answer = lastJsonObject(exec.stdout);
  const port = typeof answer?.port === 'number' ? answer.port : null;
  const authToken = typeof answer?.authToken === 'string' ? answer.authToken : null;
  if (port !== null && authToken !== null) {
    const protocolVersion = typeof answer?.protocolVersion === 'number' ? answer.protocolVersion : null;
    // Older daemons print no list; they promise nothing beyond the port and token.
    const capabilities = Array.isArray(answer?.capabilities)
      ? answer.capabilities.filter((entry): entry is string => typeof entry === 'string')
      : [];
    return { kind: 'endpoint', port, authToken, protocolVersion, capabilities };
  }
  const detail = `${exec.stderr}`.trim() || `${exec.stdout}`.trim();
  if (/Unknown gxserver command: endpoint|Unknown command/u.test(detail)) {
    return {
      kind: 'unsupported',
      message:
        'The computer runs an older Ghostex without `ghostex server endpoint`; update it to use the GPUI transcript.',
    };
  }
  return {
    kind: 'failed',
    message: `Could not read the computer's gxserver endpoint${detail ? `: ${detail.slice(0, 200)}` : '.'}`,
  };
}

async function resolveEndpoint(machine: MachineConnectionTarget): Promise<GpuiMachineEndpoint> {
  const answer = await readServerEndpoint(machine);
  if (answer.kind !== 'endpoint') throw new Error(answer.message);
  const { localPort } = await GhostexNative.startPortForward(machine.id, answer.port, GXSERVER_FORWARD_HOST);
  return { machineId: machine.id, baseUrl: `http://127.0.0.1:${localPort}`, authToken: answer.authToken };
}

function lastJsonObject(stdout: string): Record<string, unknown> | null {
  const lines = `${stdout}`.trim().split('\n').reverse();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (typeof parsed === 'object' && parsed !== null) return parsed as Record<string, unknown>;
    } catch {
      // not the answer line
    }
  }
  return null;
}
