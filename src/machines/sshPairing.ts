/**
 * Pairing over SSH (GitHub #495, Ghostex 11.1.0): a computer this phone signs in to over Tailscale,
 * the local network or plain SSH reaches gxserver with the token file the SSH login reads, which
 * Ghostex treats like an agent on that computer: answering an agent's question, Stop and typing
 * wait for the owner's approval there. So the phone pairs through that same login, as strongly as
 * an Easy Connect phone:
 *
 * 1. It sends its own device key (`deviceKey.ts`) to `/api/pairOverSsh` over the link (the token
 *    file's bearer) and becomes Pending; the answer carries a nonce and three words.
 * 2. It works the words out itself from the nonce and its key, stops on a mismatch, and shows them
 *    (`SshPairingNotices.tsx`) until the owner approves on the computer with Touch ID, or on a
 *    phone already paired with Face ID, asking `/api/pairingStatus` signed with the device key.
 * 3. The approved answer's device token is saved like an Easy Connect phone's, and the link shakes
 *    hands again with it (`--no-token`), so those actions stop asking. Renewal is `deviceToken.ts`'s.
 *
 * It starts by itself the first time the phone signs in to such a computer (a computer that offers
 * `pairOverSsh`), and again where an action would have waited; a denial stops the automatic ask
 * until the person asks again. Removing the phone on the computer revokes the token: the next
 * refused call drops it and the phone is back on the token file (`dropRevokedSshDeviceToken`).
 *
 * CDXC:RemotePairing 2026-11-08 DECISION: User (GitHub #495, Q1850-Q1852): "Trust this phone" for
 * Tailscale / LAN / SSH phones, with the matching words.
 * SEE-ALSO: server/src/remote_access/pair_device.rs `begin_ssh_pairing` in the Ghostex repo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { create } from 'zustand';

import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { chatMachineLink, onChatLinkHandshake, onChatLinkTokenRefused } from '../chat/rust/machine-link';
import { setHeldAnswerHandler, type RpcAnswer } from '../chat/rust/transport';
import { approvalIdOf } from '../security/approvals';
import { SshPairingCopy } from '../copy';
import { APPROVER_KEY_ALGORITHM, approverKeyPublic, hasApproverKey } from '../security/approverKey';
import { getDeviceApiToken, setDeviceApiToken, setDeviceTokenExpiresAt, type MachineConnectionTarget } from './credentials';
import { DEVICE_KEY_ALGORITHM, deviceKeyPublic, deviceKeySign, hasDeviceKey } from './deviceKey';
import { pairingDeviceName } from './pairing';
import { matchWords, pairingStatusPayload, sameWords } from './pairingWords';
import { machineDisplayLabel, useMachinesStore } from './store';

/** What `ghostex server endpoint` lists when the computer takes `/api/pairOverSsh`. */
export const PAIR_OVER_SSH_CAPABILITY = 'pairOverSsh';
const RPC_TIMEOUT_MS = 20_000;
const POLL_MS = 1_500;
const WAIT_MAX_MS = 10 * 60 * 1000;
const DECLINED_KEY = (machineId: string) => `sshPairing.declined.${machineId}`;

export type SshPairingPhase = 'asking' | 'pending' | 'paired' | 'denied' | 'expired' | 'failed';

export type SshPairing = {
  machineId: string;
  computer: string;
  phase: SshPairingPhase;
  words: string[];
  message?: string;
};

type State = { pairings: Record<string, SshPairing>; hidden: Record<string, true> };

export const useSshPairings = create<State>(() => ({ pairings: {}, hidden: {} }));

function put(pairing: SshPairing): void {
  useSshPairings.setState((state) => ({
    pairings: { ...state.pairings, [pairing.machineId]: pairing },
    hidden: Object.fromEntries(Object.entries(state.hidden).filter(([id]) => id !== pairing.machineId)),
  }));
}

/** Hides a pairing's card; a pairing still waiting keeps waiting. */
export function hideSshPairing(machineId: string): void {
  useSshPairings.setState((state) => ({ hidden: { ...state.hidden, [machineId]: true } }));
}

/** Whether this machine is one the phone signs in to over SSH (not Easy Connect, not a Cloud Box). */
export function signsInOverSsh(machine: Pick<MachineConnectionTarget, 'id' | 'transport'>): boolean {
  return machine.transport !== 'tailcat' && !isCloudBoxMachineId(machine.id);
}

function computerName(machineId: string, fallback = ''): string {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record !== undefined) return machineDisplayLabel(record);
  return fallback.length > 0 ? fallback : SshPairingCopy.theComputer;
}

const running = new Set<string>();

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Pairs this phone with `machine` over its SSH login, unless it already holds a device token there
 * or is pairing now. `auto`: the first sign-in's ask, skipped after the owner denied it once (an
 * action that would have waited, or Ask again, asks anyway).
 */
export async function startSshPairing(machine: MachineConnectionTarget, options: { auto: boolean }): Promise<void> {
  if (!signsInOverSsh(machine) || !hasDeviceKey() || running.has(machine.id)) return;
  if (await getDeviceApiToken(machine.id)) return;
  if (options.auto && (await AsyncStorage.getItem(DECLINED_KEY(machine.id)).catch(() => null)) !== null) return;
  running.add(machine.id);
  const computer = computerName(machine.id);
  try {
    put({ machineId: machine.id, computer, phase: 'asking', words: [] });
    const link = chatMachineLink(machine);
    const devicePublicKey = await deviceKeyPublic();
    const params: Record<string, unknown> = {
      deviceName: pairingDeviceName(),
      platform: pairingPlatform(),
      deviceKey: { algorithm: DEVICE_KEY_ALGORITHM, publicKey: devicePublicKey },
    };
    // Approving the pairing also lets this phone approve the computer's requests with Face ID.
    const approverPublicKey = hasApproverKey() ? await approverKeyPublic().catch(() => null) : null;
    if (approverPublicKey !== null) {
      params.approverKey = { algorithm: APPROVER_KEY_ALGORITHM, publicKey: approverPublicKey, presence: 'biometric' };
    }
    await link.route();
    const started = await link.rpc('pairOverSsh', params, RPC_TIMEOUT_MS);
    if (started.error !== null) {
      put({ machineId: machine.id, computer, phase: 'failed', words: [], message: started.error.message });
      return;
    }
    const result = record(started.result);
    const nonce = typeof result.nonce === 'string' ? result.nonce : '';
    const pendingId = typeof result.pendingId === 'string' ? result.pendingId : '';
    const theirs = Array.isArray(result.words) ? result.words.filter((word): word is string => typeof word === 'string') : [];
    const words = matchWords(nonce, devicePublicKey);
    // A computer naming other words isn't pairing this phone's key; never ask the owner to approve that.
    if (pendingId.length === 0 || !sameWords(words, theirs)) {
      put({ machineId: machine.id, computer, phase: 'failed', words: [], message: SshPairingCopy.mismatch });
      return;
    }
    put({ machineId: machine.id, computer, phase: 'pending', words });
    const expiresAtMs = typeof result.expiresAtMs === 'number' ? result.expiresAtMs : Date.now() + WAIT_MAX_MS;
    const giveUpAt = Math.min(expiresAtMs, Date.now() + WAIT_MAX_MS);
    let lastTimestamp = 0;
    while (Date.now() < giveUpAt) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      const timestampMs = Math.max(Date.now(), lastTimestamp + 1);
      lastTimestamp = timestampMs;
      const signature = await deviceKeySign(pairingStatusPayload(pendingId, timestampMs));
      const asked = await link.rpc('pairingStatus', { pendingId, timestampMs, signature }, RPC_TIMEOUT_MS);
      if (asked.error !== null) continue;
      const status = record(asked.result);
      if (status.status === 'approved' && typeof status.deviceApiToken === 'string' && typeof status.deviceId === 'string') {
        await Promise.all([
          setDeviceApiToken(machine.id, status.deviceApiToken),
          setDeviceTokenExpiresAt(
            machine.id,
            typeof status.deviceTokenExpiresAtMs === 'number' ? String(status.deviceTokenExpiresAtMs) : '',
          ),
          AsyncStorage.removeItem(DECLINED_KEY(machine.id)).catch(() => undefined),
        ]);
        useMachinesStore.getState().setMachineDeviceId(machine.id, status.deviceId);
        // The next request shakes hands again, now with this phone's own token.
        link.forgetEndpoint();
        put({ machineId: machine.id, computer, phase: 'paired', words });
        setTimeout(() => hideSshPairing(machine.id), 6_000);
        return;
      }
      if (status.status === 'denied') {
        await AsyncStorage.setItem(DECLINED_KEY(machine.id), String(Date.now())).catch(() => undefined);
        put({ machineId: machine.id, computer, phase: 'denied', words });
        return;
      }
      if (status.status === 'expired') break;
    }
    put({ machineId: machine.id, computer, phase: 'expired', words });
  } catch (error) {
    put({
      machineId: machine.id,
      computer,
      phase: 'failed',
      words: [],
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running.delete(machine.id);
  }
}

/** Whether this phone is paired with `machine` over SSH now. */
export function pairedOverSsh(machineId: string): boolean {
  return useSshPairings.getState().pairings[machineId]?.phase === 'paired';
}

/**
 * The computer refused this phone's device token (it was removed there, or its pairing was
 * denied later): drop it, so the next handshake falls back to the token file, at agent level.
 * Only for an SSH machine, whose token file is the way back; an Easy Connect phone pairs again.
 */
export async function dropRevokedSshDeviceToken(machine: MachineConnectionTarget, refusedToken: string): Promise<boolean> {
  if (!signsInOverSsh(machine)) return false;
  const stored = await getDeviceApiToken(machine.id);
  if (!stored || stored !== refusedToken) return false;
  await Promise.all([setDeviceApiToken(machine.id, ''), setDeviceTokenExpiresAt(machine.id, '')]);
  useMachinesStore.getState().setMachineDeviceId(machine.id, undefined);
  useSshPairings.setState((state) => {
    const { [machine.id]: _gone, ...rest } = state.pairings;
    return { pairings: rest };
  });
  return true;
}

/** Same answer pairing.ts gives the computer. */
function pairingPlatform(): 'ios' | 'android' {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** The chat requests gxserver holds for a phone on the token file (server/src/server/security_gates.rs). */
const HELD_METHODS = new Set([
  'answerSessionChatPrompt',
  'interruptSessionChat',
  'sendSessionText',
  'sendSessionEnter',
  'sendSessionMessage',
]);
const HELD_POLL_MS = 2_000;

/**
 * A chat request the computer held for the owner's approval because this phone signs in over SSH
 * and isn't paired there yet: the pairing card shows where the action would have waited, and the
 * request goes again once this phone has paired (with its own token, nothing to approve) or the
 * owner approved that one request on the computer (with its `approvalId`). A denial or a lapse
 * answers in plain words.
 */
async function withSshPairing(
  machine: MachineConnectionTarget,
  method: string,
  params: unknown,
  answer: RpcAnswer,
  send: (params: unknown) => Promise<RpcAnswer>,
): Promise<RpcAnswer> {
  const error = answer.error;
  if (error === null || !HELD_METHODS.has(method) || !signsInOverSsh(machine)) return answer;
  const approvalId = error.approval?.id ?? approvalIdOf(error.message);
  const computer = computerName(machine.id);
  void startSshPairing(machine, { auto: false });
  const giveUpAt = Date.now() + WAIT_MAX_MS;
  while (Date.now() < giveUpAt) {
    await new Promise((resolve) => setTimeout(resolve, HELD_POLL_MS));
    if (pairedOverSsh(machine.id)) return send(params);
    if (approvalId !== null) {
      const read = await chatMachineLink(machine).rpc('readApprovalRequest', { id: approvalId }, RPC_TIMEOUT_MS);
      const status = record(record(read.result).request).status;
      if (status === 'approved') {
        const base = typeof params === 'object' && params !== null && !Array.isArray(params) ? params : {};
        return send({ ...base, approvalId });
      }
      if (status === 'denied') {
        return { error: { ...error, code: 'approvalDenied', message: SshPairingCopy.actionDenied(computer), approval: null } };
      }
      if (status === 'expired' || status === 'consumed' || read.error?.code === 'notFound') break;
    } else {
      const phase = useSshPairings.getState().pairings[machine.id]?.phase;
      if (phase === 'denied' || phase === 'expired' || phase === 'failed') break;
    }
  }
  return { error: { ...error, code: 'approvalLapsed', message: SshPairingCopy.actionLapsed(computer), approval: null } };
}

// Registered when the app loads this module (SshPairingNotices.tsx, mounted at the app's root).
setHeldAnswerHandler(withSshPairing);
onChatLinkHandshake((machine, capabilities) => {
  if (capabilities.includes(PAIR_OVER_SSH_CAPABILITY)) void startSshPairing(machine, { auto: true });
});
onChatLinkTokenRefused((machine, token) => {
  void dropRevokedSshDeviceToken(machine, token);
});

