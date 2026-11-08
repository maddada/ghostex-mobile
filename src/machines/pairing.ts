/**
 * Easy Connect registration: turn a scanned `EasyConnectCode` into a saved
 * machine the phone can reach without a password.
 *
 * 1. Generate an ed25519 key on the phone (`GhostexNative.generateSshKey`).
 * 2. Open a tailcat forward to the computer's gxserver API port (`code.port`).
 * 3. POST `/api/pairDevice` on `http://127.0.0.1:<local>` with the one-time
 *    secret from the code and this phone's device key (`deviceKey.ts`); gxserver
 *    consumes the secret and makes the phone Pending (pairing v2, GitHub #495).
 * 4. Show the three words (worked out here from the secret and the device key,
 *    and checked against the computer's) until the owner approves on the
 *    computer or a paired phone, asking `/api/pairingStatus` with signed asks.
 *    The approved answer carries the device token; only then has gxserver
 *    written the phone's (restricted) SSH key line, which on a Windows
 *    administrator account waits on a UAC prompt.
 * 5. Save the machine (`transport: 'tailcat'`) plus the key, and stop the
 *    pairing forward: the machine's own forward starts on first connect.
 *
 * The endpoint is unauthenticated (secret-gated, rate-limited) per §1.2 of
 * docs/2026-09-03/mobile-setup/IMPLEMENTATION-PLAN.md.
 */

import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { machineForSameComputer } from './computerIdentity';
import {
  getEasyConnectAddresses,
  getTailcatToken,
  setDeviceApiToken,
  setDeviceTokenExpiresAt,
  setEasyConnectAddresses,
  setPassphrase,
  setPublicKey,
  setSshKey,
} from './credentials';
import { APPROVER_KEY_ALGORITHM, approverKeyPublic, hasApproverKey } from '../security/approverKey';
import { DEVICE_KEY_ALGORITHM, deviceKeyPublic, deviceKeySign, hasDeviceKey } from './deviceKey';
import { decodeSavedAddresses } from './easyConnectAddresses';
import { saveEasyConnectAddresses } from './easyConnectDial';
import type { EasyConnectCode } from './pairingCodes';
import { matchWords, pairingStatusPayload, sameWords } from './pairingWords';
import { tailcatSyntheticHost, useMachinesStore, type MachineRecord } from './store';

/** Mirrors `GXSERVER_PROTOCOL_VERSION` in the gxserver crate. */
const GXSERVER_PROTOCOL_VERSION = 1;
const PAIR_DEVICE_PATH = '/api/pairDevice';
const PAIRING_STATUS_PATH = '/api/pairingStatus';
/** How often a Pending phone asks whether the owner has decided. */
const PAIRING_POLL_MS = 1500;
/** The longest a phone waits as Pending; the computer's request lapses after 10 minutes. */
const PAIRING_WAIT_MAX_MS = 10 * 60 * 1000;
/**
 * Long enough for the person to answer the computer's administrator prompt: on
 * a Windows administrator account gxserver adds the key through a UAC prompt
 * and answers only once it is accepted or declined.
 */
const PAIR_DEVICE_TIMEOUT_MS = 180_000;
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
  /** This phone's Easy Connect client key, so the computer can allow-list it. */
  tailcatClientKey?: string;
  /** Pairing v2: this phone's own device key. */
  deviceKey: { algorithm: typeof DEVICE_KEY_ALGORITHM; publicKey: string };
  /**
   * This phone's Face ID / fingerprint approver key: approving the pairing also lets the phone
   * approve the computer's requests, with no second approval. Absent from an app build without one.
   */
  approverKey?: { algorithm: typeof APPROVER_KEY_ALGORITHM; publicKey: string; presence: 'biometric' };
};

export type PairDeviceResponse = {
  deviceId: string;
  user: string;
  computerName: string;
  /** The phone's own API token, bound to its device key. */
  deviceApiToken: string | null;
  /** When that token lapses unless the device key renews it (`deviceToken.ts`). */
  deviceTokenExpiresAtMs: number | null;
  /** Every address the computer serves, ours first (`easyConnectAddresses.ts`); absent from an older Ghostex. */
  easyConnectAddresses: unknown;
};

/** What the Scan screen shows while the phone waits as Pending. */
export type PairingPending = { words: string[]; computerName: string };

export type EasyConnectPairingFailure =
  /** The one-time secret was already used or is past `expiresAt`. */
  | 'expired'
  /** The code carries no secret, so the computer cannot register the phone's key. */
  | 'noSecret'
  /** The tunnel could not reach the computer at all. */
  | 'unreachable'
  /** gxserver answered with an error other than expiry, or the response was malformed. */
  | 'rejected'
  /** The owner denied this phone on the computer or another phone. */
  | 'denied'
  /** The person stopped waiting on the phone. */
  | 'cancelled'
  /** This app build has no device key (or the computer asked for a newer app). */
  | 'needsUpdate';

export type EasyConnectPairingResult =
  { ok: true; machine: MachineRecord } | { ok: false; reason: EasyConnectPairingFailure; message: string };

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

/** The RPC `result`, or a `PairDeviceError` for an error answer (expiry told apart by its code). */
function readRpcResult(body: unknown): Record<string, unknown> {
  if (!isRecord(body)) throw new PairDeviceError('rejected', 'The computer sent an unreadable reply.');
  if (body.ok === false) {
    const code = typeof body.error === 'string' ? body.error : '';
    const message =
      typeof body.message === 'string' && body.message.length > 0
        ? body.message
        : 'The computer refused the pairing code.';
    if (code === 'pairingNeedsAppUpdate') throw new PairDeviceError('needsUpdate', message);
    const expired = code.toLowerCase().includes('expired') || /expired/iu.test(message);
    throw new PairDeviceError(expired ? 'expired' : 'rejected', message);
  }
  return isRecord(body.result) ? body.result : body;
}

async function postPairingRpc(
  localPort: number,
  path: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAIR_DEVICE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${localPort}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requestId: `pair-${Date.now().toString(36)}`,
        protocolVersion: GXSERVER_PROTOCOL_VERSION,
        params,
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
  return readRpcResult(body);
}

/** `/api/pairDevice`'s answer: Pending, with the words the computer shows. */
export function readPairingStarted(result: Record<string, unknown>): {
  pendingId: string;
  words: string[];
  expiresAtMs: number;
  computerName: string;
} {
  const words = Array.isArray(result.words) ? result.words.filter((word) => typeof word === 'string') : [];
  if (result.status !== 'pending' || typeof result.pendingId !== 'string' || words.length !== 3) {
    // A computer whose Ghostex predates pairing v2 answers without a Pending step.
    throw new PairDeviceError(
      'rejected',
      'Update Ghostex on the computer to 11.1.0 or later, then scan its code again.',
    );
  }
  return {
    pendingId: result.pendingId,
    words,
    expiresAtMs: typeof result.expiresAtMs === 'number' ? result.expiresAtMs : Date.now() + PAIRING_WAIT_MAX_MS,
    computerName: typeof result.computerName === 'string' ? result.computerName : '',
  };
}

/** `/api/pairingStatus`'s approved answer as the registration the machine is saved from. */
export function readApprovedPairing(result: Record<string, unknown>): PairDeviceResponse {
  if (
    typeof result.deviceId !== 'string' ||
    typeof result.deviceApiToken !== 'string' ||
    typeof result.user !== 'string' ||
    typeof result.computerName !== 'string'
  ) {
    throw new PairDeviceError('rejected', 'The computer sent an incomplete pairing reply.');
  }
  return {
    deviceId: result.deviceId,
    user: result.user,
    computerName: result.computerName,
    deviceApiToken: result.deviceApiToken,
    deviceTokenExpiresAtMs: typeof result.deviceTokenExpiresAtMs === 'number' ? result.deviceTokenExpiresAtMs : null,
    easyConnectAddresses: result.easyConnectAddresses,
  };
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

/** Asks, signed with the device key, until the owner approves or denies, or the request lapses. */
async function waitForApproval(
  localPort: number,
  pendingId: string,
  expiresAtMs: number,
  signal: AbortSignal | undefined,
): Promise<PairDeviceResponse> {
  const giveUpAt = Math.min(expiresAtMs, Date.now() + PAIRING_WAIT_MAX_MS);
  let lastTimestamp = 0;
  for (;;) {
    if (signal?.aborted) throw new PairDeviceError('cancelled', 'Pairing was cancelled on this phone.');
    // The computer only takes ever-newer timestamps.
    const timestampMs = Math.max(Date.now(), lastTimestamp + 1);
    lastTimestamp = timestampMs;
    const signature = await deviceKeySign(pairingStatusPayload(pendingId, timestampMs));
    const result = await postPairingRpc(localPort, PAIRING_STATUS_PATH, { pendingId, timestampMs, signature });
    if (result.status === 'approved') return readApprovedPairing(result);
    if (result.status === 'denied') {
      throw new PairDeviceError('denied', 'The computer denied this phone. Scan a new code to try again.');
    }
    if (result.status === 'expired' || Date.now() >= giveUpAt) {
      throw new PairDeviceError(
        'expired',
        'Nobody approved this phone in time. Show a new code on the computer and scan again.',
      );
    }
    await sleep(PAIRING_POLL_MS, signal);
  }
}

/**
 * The saved Easy Connect machine for the computer behind `address`, if any. Pairing that computer
 * again re-pairs this record instead of adding a second one: two records mean two tunnels to one
 * computer, which break each other (CDXC:RemotePairing 2026-11-05 in computerIdentity.ts).
 */
async function savedMachineForComputer(address: string): Promise<string | null> {
  const { machines } = useMachinesStore.getState();
  const tailcat = machines.filter((machine) => machine.transport === 'tailcat');
  const tokens = new Map<string, string | null>(
    await Promise.all(tailcat.map(async (machine) => [machine.id, await getTailcatToken(machine.id)] as const)),
  );
  // A computer's second address has its own server key, so a record saved with the other address is
  // found through the address list the computer gave it.
  const lists = new Map<string, string[]>(
    await Promise.all(
      tailcat.map(async (machine) => {
        const saved = decodeSavedAddresses(await getEasyConnectAddresses(machine.id));
        return [machine.id, (saved?.addresses ?? []).map((entry) => entry.address)] as const;
      }),
    ),
  );
  return (
    machineForSameComputer(
      tailcat,
      (id) => tokens.get(id) ?? null,
      address,
      null,
      (id) => lists.get(id) ?? [],
    )?.id ?? null
  );
}

async function saveEasyConnectMachine(
  code: EasyConnectCode,
  registration: PairDeviceResponse,
  requestedRePairId: string | null,
): Promise<MachineRecord> {
  const rePairMachineId = requestedRePairId ?? (await savedMachineForComputer(code.address));
  const store = useMachinesStore.getState();
  const existing =
    rePairMachineId === null ? null : (store.machines.find((machine) => machine.id === rePairMachineId) ?? null);
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
    rePairMachineId === null ? await store.addMachine(input) : await store.updateMachine(rePairMachineId, input);
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
  options: {
    rePairMachineId?: string;
    /** The phone is Pending: show these words until the owner decides. */
    onPending?: (pending: PairingPending) => void;
    /** Stops waiting (the person left the screen or tapped Cancel). */
    signal?: AbortSignal;
  } = {},
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

  if (!hasDeviceKey()) {
    return {
      ok: false,
      reason: 'needsUpdate',
      message: 'Update Ghostex on this phone: computers now pair phones with their own device key.',
    };
  }

  try {
    const secret = code.secret;
    const devicePublicKey = await deviceKeyPublic();
    const key = await GhostexNative.generateSshKey('ed25519', SSH_KEY_COMMENT);
    // An app build without the saved key still pairs; the computer just cannot allow-list it.
    const tailcatClientKey = await GhostexNative.tailcatClientPublicKey().catch(() => undefined);
    let localPort: number;
    try {
      ({ localPort } = await GhostexNative.startTailcatForward(PAIRING_FORWARD_ID, code.address, code.port));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new PairDeviceError('unreachable', detail);
    }
    try {
      const request: PairDeviceRequest = {
        secret,
        deviceName: pairingDeviceName(),
        platform: pairingPlatform(),
        sshPublicKey: key.publicKey,
        tailcatClientKey,
        deviceKey: { algorithm: DEVICE_KEY_ALGORITHM, publicKey: devicePublicKey },
      };
      // Making the approver key shows no prompt; only signing with it does.
      const approverPublicKey = hasApproverKey() ? await approverKeyPublic().catch(() => null) : null;
      if (approverPublicKey !== null) {
        request.approverKey = { algorithm: APPROVER_KEY_ALGORITHM, publicKey: approverPublicKey, presence: 'biometric' };
      }
      const started = readPairingStarted(await postPairingRpc(localPort, PAIR_DEVICE_PATH, request));
      /*
      CDXC:RemotePairing 2026-11-08 DECISION:
      User (GitHub #495, Q1721): the phone shows three words the owner compares with the
      computer's before approving. The phone works them out itself from the QR's nonce and its own
      device key; a computer that names other words isn't the one in this QR (or something between
      changed the key), so the phone stops instead of asking the owner to approve a mismatch.
      */
      const words = matchWords(secret, devicePublicKey);
      if (!sameWords(words, started.words)) {
        throw new PairDeviceError(
          'rejected',
          'The computer showed different words from this phone, so pairing stopped. Show a new code on the computer and scan again.',
        );
      }
      options.onPending?.({ words, computerName: started.computerName || code.name });
      const registration = await waitForApproval(localPort, started.pendingId, started.expiresAtMs, options.signal);
      const machine = await saveEasyConnectMachine(code, registration, rePairMachineId);
      await Promise.all([
        setSshKey(machine.id, key.privateKey),
        setPublicKey(machine.id, key.publicKey),
        setPassphrase(machine.id, ''),
        // A re-pair with a computer that sent none drops the old one, which that computer revoked.
        setDeviceApiToken(machine.id, registration.deviceApiToken ?? ''),
        setDeviceTokenExpiresAt(
          machine.id,
          registration.deviceTokenExpiresAtMs === null ? '' : String(registration.deviceTokenExpiresAtMs),
        ),
      ]);
      // The QR carries one address; the reply names the fallback too. A computer that sends no list
      // leaves the phone dialing the scanned address alone, as before.
      if (!(await saveEasyConnectAddresses(machine.id, registration.easyConnectAddresses))) {
        await setEasyConnectAddresses(machine.id, '');
      }
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
