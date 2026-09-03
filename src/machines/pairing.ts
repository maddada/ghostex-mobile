/**
 * Easy Connect registration: turn a scanned `EasyConnectCode` into a saved
 * machine the phone can reach without a password.
 *
 * 1. Generate an ed25519 key on the phone (`GhostexNative.generateSshKey`).
 * 2. Open a tailcat forward to the computer's gxserver API port (`code.port`).
 * 3. POST `/api/pairDevice` on `http://127.0.0.1:<local>` with the one-time
 *    secret from the code; gxserver appends the public key to
 *    `~/.ssh/authorized_keys`, records the device and consumes the secret.
 * 4. Save the machine (`transport: 'tailcat'`) plus the key, and stop the
 *    pairing forward: the machine's own forward starts on first connect.
 *
 * The endpoint is unauthenticated (secret-gated, rate-limited) per §1.2 of
 * docs/2026-09-03/mobile-setup/IMPLEMENTATION-PLAN.md.
 */

import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { setPassphrase, setPublicKey, setSshKey } from './credentials';
import type { EasyConnectCode } from './pairingCodes';
import { tailcatSyntheticHost, useMachinesStore, type MachineRecord } from './store';

/** Mirrors `GXSERVER_PROTOCOL_VERSION` in the gxserver crate. */
const GXSERVER_PROTOCOL_VERSION = 1;
const PAIR_DEVICE_PATH = '/api/pairDevice';
const PAIR_DEVICE_TIMEOUT_MS = 20_000;
/**
 * One forward for every pairing attempt: a fresh id per scan would leave a whole
 * tunnel stack behind each time, and the forward is stopped when pairing ends.
 */
const PAIRING_FORWARD_ID = 'easy-connect-pairing';
const SSH_KEY_COMMENT = 'ghostex-mobile';

export type PairDeviceRequest = {
  secret: string;
  deviceName: string;
  platform: 'ios' | 'android';
  sshPublicKey: string;
};

export type PairDeviceResponse = {
  deviceId: string;
  user: string;
  computerName: string;
};

export type EasyConnectPairingFailure =
  /** The one-time secret was already used or is past `expiresAt`. */
  | 'expired'
  /** The code carries no secret, so the computer cannot register the phone's key. */
  | 'noSecret'
  /** The tunnel could not reach the computer at all. */
  | 'unreachable'
  /** gxserver answered with an error other than expiry, or the response was malformed. */
  | 'rejected';

export type EasyConnectPairingResult =
  | { ok: true; machine: MachineRecord }
  | { ok: false; reason: EasyConnectPairingFailure; message: string };

/** What this phone calls itself in the computer's Paired devices list. */
export function pairingDeviceName(): string {
  if (Platform.OS === 'ios') return Platform.isPad ? 'iPad' : 'iPhone';
  if (Platform.OS === 'android') {
    const constants = Platform.constants as { Brand?: string; Model?: string };
    const parts = [constants.Brand, constants.Model].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    );
    return parts.length > 0 ? parts.join(' ') : 'Android phone';
  }
  return 'Phone';
}

function pairingPlatform(): PairDeviceRequest['platform'] {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

class PairDeviceError extends Error {
  constructor(
    readonly reason: EasyConnectPairingFailure,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePairDeviceResponse(body: unknown): PairDeviceResponse {
  if (!isRecord(body)) throw new PairDeviceError('rejected', 'The computer sent an unreadable reply.');
  if (body.ok === false) {
    const code = typeof body.error === 'string' ? body.error : '';
    const message =
      typeof body.message === 'string' && body.message.length > 0
        ? body.message
        : 'The computer refused the pairing code.';
    const expired = code.toLowerCase().includes('expired') || /expired/iu.test(message);
    throw new PairDeviceError(expired ? 'expired' : 'rejected', message);
  }
  const result = isRecord(body.result) ? body.result : body;
  if (
    typeof result.deviceId !== 'string' ||
    typeof result.user !== 'string' ||
    typeof result.computerName !== 'string'
  ) {
    throw new PairDeviceError('rejected', 'The computer sent an incomplete pairing reply.');
  }
  return { deviceId: result.deviceId, user: result.user, computerName: result.computerName };
}

async function postPairDevice(localPort: number, request: PairDeviceRequest): Promise<PairDeviceResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIR_DEVICE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${localPort}${PAIR_DEVICE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: `pair-${Date.now().toString(36)}`,
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        params: request,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new PairDeviceError(
      'unreachable',
      `Reached the computer, but Ghostex there did not answer. Keep Ghostex open on the computer and scan again. (${detail})`,
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new PairDeviceError(
      'rejected',
      `Ghostex on the computer answered with HTTP ${response.status} and no JSON body.`,
    );
  }
  return parsePairDeviceResponse(body);
}

async function saveEasyConnectMachine(
  code: EasyConnectCode,
  registration: PairDeviceResponse,
  rePairMachineId: string | null,
): Promise<MachineRecord> {
  const store = useMachinesStore.getState();
  const existing =
    rePairMachineId === null
      ? null
      : (store.machines.find((machine) => machine.id === rePairMachineId) ?? null);
  const reportedName = registration.computerName.length > 0 ? registration.computerName : code.name;
  // A re-pair keeps a name the user typed themselves; only a name that still
  // matches what the computer reported last time follows the new report.
  const keepsCustomName =
    existing !== null &&
    existing.name.length > 0 &&
    existing.name !== existing.computerName &&
    existing.name !== reportedName;
  const input = {
    name: keepsCustomName ? existing.name : reportedName,
    host: '',
    username: registration.user.length > 0 ? registration.user : code.user,
    port: code.sshPort,
    savePassword: false,
    transport: 'tailcat' as const,
    tailcatToken: code.address,
    deviceId: registration.deviceId,
    pairedAt: new Date().toISOString(),
    computerName: registration.computerName,
    gxserverPort: code.port,
  };
  const result =
    rePairMachineId === null
      ? await store.addMachine(input)
      : await store.updateMachine(rePairMachineId, input);
  if (!result.ok) {
    const detail = Object.values(result.errors).join(' ');
    throw new PairDeviceError('rejected', `The pairing code could not be saved. ${detail}`);
  }
  if (existing !== null) {
    // The address (and possibly the computer behind it) changed, so the host key
    // pinned under this machine's synthetic identity must not reject the new one.
    await GhostexNative.resetHostKey(tailcatSyntheticHost(existing.id), result.machine.port);
  }
  return result.machine;
}

/**
 * Register this phone on the computer behind `code` and save it as a machine.
 * `rePairMachineId` replaces that machine's address and key instead of adding
 * one (Edit machine → Re-pair).
 */
export async function pairEasyConnect(
  code: EasyConnectCode,
  options: { rePairMachineId?: string } = {},
): Promise<EasyConnectPairingResult> {
  const rePairMachineId = options.rePairMachineId ?? null;
  if (code.secret === undefined || code.secret.length === 0) {
    return {
      ok: false,
      reason: 'noSecret',
      message: 'This code has no pairing secret, so the computer cannot register this phone.',
    };
  }
  if (code.expiresAt !== undefined) {
    const expiresAt = Date.parse(code.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt < Date.now()) {
      return { ok: false, reason: 'expired', message: 'This code has expired.' };
    }
  }

  try {
    const key = await GhostexNative.generateSshKey('ed25519', SSH_KEY_COMMENT);
    let localPort: number;
    try {
      ({ localPort } = await GhostexNative.startTailcatForward(
        PAIRING_FORWARD_ID,
        code.address,
        code.port,
      ));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PairDeviceError('unreachable', detail);
    }
    try {
      const registration = await postPairDevice(localPort, {
        secret: code.secret,
        deviceName: pairingDeviceName(),
        platform: pairingPlatform(),
        sshPublicKey: key.publicKey,
      });
      const machine = await saveEasyConnectMachine(code, registration, rePairMachineId);
      await Promise.all([
        setSshKey(machine.id, key.privateKey),
        setPublicKey(machine.id, key.publicKey),
        setPassphrase(machine.id, ''),
      ]);
      return { ok: true, machine };
    } finally {
      // The machine's own forward (keyed on its id) starts on first connect;
      // the pairing forward must not outlive the registration call.
      await GhostexNative.stopTailcatForward(PAIRING_FORWARD_ID);
    }
  } catch (error) {
    if (error instanceof PairDeviceError) {
      return { ok: false, reason: error.reason, message: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: 'rejected', message };
  }
}
