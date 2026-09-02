/**
 * Web preview forwards: establishing the machine's SSH local port forwards and
 * turning their failures into the copy the preview screen shows in place of a
 * blank page.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { WebPreviewCopy } from '../copy';
import { ensureConnected, summarizeFailure } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';

/**
 * The three outcomes the preview has better copy for, identified by the
 * contract error code rather than by the native message. Both platforms reject
 * with the code intact — Android through `promise.reject(CodedException)` and
 * iOS through the `Promise` form of the function, which skips the
 * `FunctionCallException` wrapper that would otherwise replace the code with
 * `ERR_FUNCTION_CALL` — so each platform's wording is free to differ without
 * changing what the user is told.
 */
type HandledCode = 'E_NOT_CONNECTED' | 'E_PORT_NOT_LISTENING' | 'E_FORWARDING_PROHIBITED';

const HANDLED_CODES: readonly HandledCode[] = [
  'E_NOT_CONNECTED',
  'E_PORT_NOT_LISTENING',
  'E_FORWARDING_PROHIBITED',
];

export type WebPreviewFailure = {
  message: string;
  hint: string;
};

/** The contract error code carried by a rejected native call, if it is one we map. */
function nativeErrorCode(error: unknown): HandledCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code !== 'string') return null;
  return HANDLED_CODES.find((handled) => handled === code) ?? null;
}

/**
 * Connect the machine if needed, then forward `remotePort`. Idempotent per
 * (machine, remotePort) for as long as the connection lives, so callers that
 * cannot know whether a forward survived a reconnect simply call this again.
 */
export async function startWebPreviewForward(machine: MachineConnectionTarget, remotePort: number): Promise<number> {
  await ensureConnected(machine);
  const { localPort } = await GhostexNative.startPortForward(machine.id, remotePort);
  return localPort;
}

/**
 * Map a forward failure onto in-screen copy. Synchronous on purpose: it runs
 * from a catch block, so anything it had to await could reject there and
 * replace the failure being reported with one nobody is waiting for.
 * `machineHasPassword` is therefore resolved by the screen while it is idle and
 * handed in, rather than read from the keychain here.
 *
 * The native "not connected" message names the machine id, which is never shown
 * to the user, so it is replaced wholesale by the connection-lost copy rather
 * than summarized.
 */
export function describeForwardFailure(
  remotePort: number,
  error: unknown,
  machineHasPassword: boolean
): WebPreviewFailure {
  switch (nativeErrorCode(error)) {
    case 'E_PORT_NOT_LISTENING':
      return { message: WebPreviewCopy.notListening(remotePort), hint: WebPreviewCopy.notListeningHint };
    case 'E_FORWARDING_PROHIBITED':
      return { message: WebPreviewCopy.forwardingProhibited, hint: '' };
    case 'E_NOT_CONNECTED':
      return { message: WebPreviewCopy.connectionLost, hint: WebPreviewCopy.connectionLostHint };
    default:
      break;
  }
  const raw = error instanceof Error ? error.message : String(error);
  return {
    message: summarizeFailure(raw, machineHasPassword),
    hint: WebPreviewCopy.connectionLostHint,
  };
}
