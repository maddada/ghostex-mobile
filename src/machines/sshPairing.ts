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
 * `pairOverSsh`), and again where an action would have waited; a denial, or a request that lapsed
 * with nobody approving, stops the automatic ask until the person asks again. The request waiting
 * is saved, so a launch or reconnect meanwhile waits on it instead of asking again. Removing the phone on the computer revokes the token: the next
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
import { chatMachineLink, onChatLinkCutOff, onChatLinkHandshake, onChatLinkTokenRefused } from '../chat/rust/machine-link';
import { setHeldAnswerHandler, type RpcAnswer } from '../chat/rust/transport';
import { approvalIdOf, notePlainApprovals } from '../security/approvals';
import { SshPairingCopy } from '../copy';
import { APPROVER_KEY_ALGORITHM, approverKeyPublic, hasApproverKey } from '../security/approverKey';
import { GhostexNative } from '../../modules/ghostex-native/src';
import {
  getDeviceApiToken,
  getEasyConnectPublicKey,
  getEasyConnectSshKey,
  setDeviceApiToken,
  setDeviceTokenExpiresAt,
  setEasyConnectPublicKey,
  setEasyConnectSshKey,
  type MachineConnectionTarget,
} from './credentials';
import { saveEasyConnectAddresses } from './easyConnectDial';
import { nativeHasMachineKeys, saveRegistered } from './easyConnectLinkKeyState';
import { forgetEasyConnectRoute, hasEasyConnectRoute, saveEasyConnectRoute } from './easyConnectRoute';
import { DEVICE_KEY_ALGORITHM, deviceKeyPublic, deviceKeySign, hasDeviceKey } from './deviceKey';
import { pairingDeviceName } from './pairing';
import { matchWords, pairingStatusPayload, sameWords } from './pairingWords';
import { machineDisplayLabel, useMachinesStore } from './store';

/** What `ghostex server endpoint` lists when the computer takes `/api/pairOverSsh`. */
export const PAIR_OVER_SSH_CAPABILITY = 'pairOverSsh';

/**
 * What `ghostex server endpoint` lists when `/api/pairOverSsh` also pairs for Easy Connect, with no
 * click for the owner's own Tailscale device (CDXC:RemotePairing 2026-11-12 in
 * server/src/remote_access/tailnet_owner.rs).
 */
export const PAIR_OVER_SSH_EASY_CONNECT_CAPABILITY = 'pairOverSshEasyConnect';

/** What `ghostex server endpoint` lists when the computer takes Approve as one tap (option B). */
export const PLAIN_APPROVALS_CAPABILITY = 'plainApprovals';
const RPC_TIMEOUT_MS = 20_000;
const POLL_MS = 1_500;
const WAIT_MAX_MS = 10 * 60 * 1000;
const DECLINED_KEY = (machineId: string) => `sshPairing.declined.${machineId}`;
const SAVED_KEY = (machineId: string) => `sshPairing.state.${machineId}`;

/*
CDXC:RemotePairing 2026-11-09 WHY:
User (Android phone over Tailscale, 11.2.1): "I'm seeing these approvals on every launch even tho I'm
connecting through tailscale. Also i don't understand as a user what the heck I need to do here".
Nobody had approved the phone (the computer's security log held one "asked to pair" per launch),
and the phone forgot its request whenever the app closed, so every launch and every reconnect
asked again with new words: a new approval request on the computer each time, until "Too many
pairing attempts". The request is now saved per computer: a launch or reconnect while it still
waits goes on waiting for that same request (same words), and one that lapsed with nobody
approving is not asked again by itself; the card offers Ask again instead. Hide is saved too and
holds for that computer until something changes (Ask again, an action that waits, the outcome).
A computer the phone can't reach right now (asleep) shows no card: the card waits for its answer.
*/
/** What the phone remembers per computer between launches. */
type SavedPairing = {
  pendingId?: string;
  nonce?: string;
  words?: string[];
  expiresAtMs?: number;
  /** The computer's own name, from its answer. */
  computer?: string;
  /** The last request lapsed with nobody approving; nothing asks again by itself. */
  lapsedAtMs?: number;
  /** Hide on its card; until something changes. */
  hidden?: boolean;
  /** The waiting request also pairs for Easy Connect (sent with this phone's Easy Connect keys). */
  easyConnect?: boolean;
};

async function readSaved(machineId: string): Promise<SavedPairing> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_KEY(machineId));
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as SavedPairing) : {};
  } catch {
    return {};
  }
}

/**
 * Changes what is saved for this computer, from what is saved now: Hide can land while a request
 * waits, so a write from an older copy would bring a hidden card back.
 */
async function updateSaved(machineId: string, change: (saved: SavedPairing) => SavedPairing): Promise<SavedPairing> {
  const next = change(await readSaved(machineId));
  await writeSaved(machineId, next);
  return next;
}

async function writeSaved(machineId: string, saved: SavedPairing | null): Promise<void> {
  try {
    if (saved === null) await AsyncStorage.removeItem(SAVED_KEY(machineId));
    else await AsyncStorage.setItem(SAVED_KEY(machineId), JSON.stringify(saved));
  } catch {
    // Only the next launch's memory is lost: it asks once more.
  }
}

/** `lapsed`: the request ran out with nobody approving; Ask again starts a new one. */
export type SshPairingPhase = 'asking' | 'pending' | 'paired' | 'denied' | 'lapsed' | 'failed';

export type SshPairing = {
  machineId: string;
  computer: string;
  phase: SshPairingPhase;
  words: string[];
  message?: string;
  /** The request also pairs for Easy Connect: the card says so. */
  easyConnect?: boolean;
};

type State = {
  pairings: Record<string, SshPairing>;
  hidden: Record<string, true>;
  /** Computers whose last ask the link couldn't deliver (asleep, offline): they show no card. */
  unreachable: Record<string, true>;
  /** Computers that can pair this phone for Easy Connect over its SSH login (their handshake said so). */
  easyConnectOffered: Record<string, true>;
};

export const useSshPairings = create<State>(() => ({ pairings: {}, hidden: {}, unreachable: {}, easyConnectOffered: {} }));

function setEasyConnectOffered(machineId: string, offered: boolean): void {
  if ((useSshPairings.getState().easyConnectOffered[machineId] === true) === offered) return;
  useSshPairings.setState((state) => {
    const { [machineId]: _was, ...rest } = state.easyConnectOffered;
    return { easyConnectOffered: offered ? { ...rest, [machineId]: true } : rest };
  });
}

function put(pairing: SshPairing): void {
  useSshPairings.setState((state) => ({ pairings: { ...state.pairings, [pairing.machineId]: pairing } }));
}

function forget(machineId: string): void {
  useSshPairings.setState((state) => {
    const { [machineId]: _gone, ...rest } = state.pairings;
    return { pairings: rest };
  });
}

function setHidden(machineId: string, hidden: boolean): void {
  useSshPairings.setState((state) => {
    const { [machineId]: _was, ...rest } = state.hidden;
    return { hidden: hidden ? { ...rest, [machineId]: true } : rest };
  });
}

function setReachable(machineId: string, reachable: boolean): void {
  if ((useSshPairings.getState().unreachable[machineId] !== true) === reachable) return;
  useSshPairings.setState((state) => {
    const { [machineId]: _was, ...rest } = state.unreachable;
    return { unreachable: reachable ? rest : { ...rest, [machineId]: true } };
  });
}

/** Hides a computer's part of the card until something changes; a request still waiting keeps waiting. */
export function hideSshPairing(machineId: string): void {
  setHidden(machineId, true);
  void updateSaved(machineId, (saved) => ({ ...saved, hidden: true }));
}

/** Whether this machine is one the phone signs in to over SSH (not Easy Connect, not a Cloud Box). */
export function signsInOverSsh(machine: Pick<MachineConnectionTarget, 'id' | 'transport'>): boolean {
  return machine.transport !== 'tailcat' && !isCloudBoxMachineId(machine.id);
}

/**
 * The name the person knows the computer by: the name they gave it on this phone, else the name the
 * computer gave in its answer, else its address.
 */
function computerName(machineId: string, fromComputer = ''): string {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record !== undefined && record.name.trim().length > 0) return machineDisplayLabel(record);
  if (fromComputer.trim().length > 0) return fromComputer.trim();
  if (record !== undefined) return machineDisplayLabel(record);
  return SshPairingCopy.theComputer;
}

const running = new Set<string>();

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Pairs this phone with `machine` over its SSH login, unless it already holds a device token there
 * or is pairing now. A request saved from an earlier launch that still waits is waited on again
 * (no new request). `auto`: the sign-in's own ask, which never asks again after the owner denied
 * it or a request lapsed, and keeps a hidden card hidden; an action that would have waited, or
 * Ask again, asks anyway and shows the card again. `easyConnect`: also pair for Easy Connect (the
 * computer offers it), which asks again of a phone already paired without it; when gxserver finds
 * the phone is the owner's own Tailscale device it approves by itself and no card shows.
 */
export async function startSshPairing(
  machine: MachineConnectionTarget,
  options: { auto: boolean; easyConnect?: boolean },
): Promise<void> {
  const easyConnect = options.easyConnect === true && !hasEasyConnectRoute(machine);
  if (!signsInOverSsh(machine) || !hasDeviceKey()) return;
  if (running.has(machine.id)) {
    // Already asking or waiting: an action that waits, or Ask again, shows its card again.
    if (!options.auto && useSshPairings.getState().hidden[machine.id] === true) {
      setHidden(machine.id, false);
      void updateSaved(machine.id, (saved) => ({ ...saved, hidden: undefined }));
    }
    return;
  }
  running.add(machine.id);
  let saved: SavedPairing = {};
  let computer = computerName(machine.id);
  let autoApproved = false;
  try {
    if (!easyConnect && (await getDeviceApiToken(machine.id))) {
      forget(machine.id);
      await writeSaved(machine.id, null);
      return;
    }
    saved = await readSaved(machine.id);
    computer = computerName(machine.id, saved.computer);
    const live =
      saved.pendingId !== undefined &&
      saved.nonce !== undefined &&
      (saved.expiresAtMs ?? 0) > Date.now() &&
      // A request saved without Easy Connect isn't the one to wait on when this ask adds it.
      (saved.easyConnect === true) === easyConnect
        ? { pendingId: saved.pendingId, words: saved.words ?? [], expiresAtMs: saved.expiresAtMs ?? 0 }
        : null;
    if (options.auto) {
      setHidden(machine.id, saved.hidden === true);
      if (live === null) {
        if (saved.pendingId !== undefined || saved.lapsedAtMs !== undefined) {
          // Lapsed while the app was closed, or before: offer Ask again, ask nothing.
          saved = await updateSaved(machine.id, (latest) => ({
            computer: latest.computer,
            hidden: latest.hidden,
            lapsedAtMs: latest.lapsedAtMs ?? Date.now(),
          }));
          put({ machineId: machine.id, computer, phase: 'lapsed', words: [] });
          return;
        }
        if ((await AsyncStorage.getItem(DECLINED_KEY(machine.id)).catch(() => null)) !== null) return;
      }
    } else {
      setHidden(machine.id, false);
      saved = await updateSaved(machine.id, (latest) => ({ ...latest, hidden: undefined, lapsedAtMs: undefined }));
    }
    const link = chatMachineLink(machine);
    let pending = live;
    if (pending === null) {
      put({ machineId: machine.id, computer, phase: 'asking', words: [] });
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
      if (easyConnect) {
        const keys = await easyConnectKeys(machine.id);
        params.easyConnect = true;
        params.sshPublicKey = keys.sshPublicKey;
        params.tailcatClientKey = keys.tailcatClientKey;
      }
      await link.route();
      const started = await link.rpc('pairOverSsh', params, RPC_TIMEOUT_MS);
      if (started.error !== null) {
        if (started.error.code === 'unreachable') {
          // Asleep or offline: no card; the next sign-in asks again.
          setReachable(machine.id, false);
          forget(machine.id);
          return;
        }
        put({ machineId: machine.id, computer, phase: 'failed', words: [], message: started.error.message });
        return;
      }
      setReachable(machine.id, true);
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
      const named = typeof result.computerName === 'string' ? result.computerName.trim() : '';
      computer = computerName(machine.id, named);
      const expiresAtMs = Math.min(
        typeof result.expiresAtMs === 'number' ? result.expiresAtMs : Date.now() + WAIT_MAX_MS,
        Date.now() + WAIT_MAX_MS,
      );
      pending = { pendingId, words, expiresAtMs };
      autoApproved = result.autoApproved === true;
      saved = await updateSaved(machine.id, (latest) => ({
        ...latest,
        pendingId,
        nonce,
        words,
        expiresAtMs,
        computer: named.length > 0 ? named : latest.computer,
        lapsedAtMs: undefined,
        easyConnect: easyConnect ? true : undefined,
      }));
    }
    // The owner's own Tailscale device: approved without a click, so nothing to show or compare.
    if (autoApproved) forget(machine.id);
    else put({ machineId: machine.id, computer, phase: 'pending', words: pending.words, easyConnect });
    const { pendingId, words } = pending;
    let lastTimestamp = 0;
    while (Date.now() < pending.expiresAtMs) {
      if (!autoApproved || lastTimestamp > 0) await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      if (!easyConnect && (await getDeviceApiToken(machine.id))) {
        // Paired another way meanwhile (scanned the computer's code, say).
        forget(machine.id);
        await writeSaved(machine.id, null);
        return;
      }
      const timestampMs = Math.max(Date.now(), lastTimestamp + 1);
      lastTimestamp = timestampMs;
      const signature = await deviceKeySign(pairingStatusPayload(pendingId, timestampMs));
      const asked = await link.rpc('pairingStatus', { pendingId, timestampMs, signature }, RPC_TIMEOUT_MS);
      if (asked.error !== null) {
        if (asked.error.code === 'unreachable') setReachable(machine.id, false);
        continue;
      }
      setReachable(machine.id, true);
      const status = record(asked.result);
      if (status.status === 'approved' && typeof status.deviceApiToken === 'string' && typeof status.deviceId === 'string') {
        await Promise.all([
          setDeviceApiToken(machine.id, status.deviceApiToken),
          setDeviceTokenExpiresAt(
            machine.id,
            typeof status.deviceTokenExpiresAtMs === 'number' ? String(status.deviceTokenExpiresAtMs) : '',
          ),
          AsyncStorage.removeItem(DECLINED_KEY(machine.id)).catch(() => undefined),
          writeSaved(machine.id, null),
        ]);
        useMachinesStore.getState().setMachineDeviceId(machine.id, status.deviceId);
        if (easyConnect) await saveSecondRoute(machine.id, status.easyConnectAddresses);
        // The next request shakes hands again, now with this phone's own token.
        link.forgetEndpoint();
        setHidden(machine.id, false);
        if (autoApproved) {
          forget(machine.id);
          return;
        }
        put({ machineId: machine.id, computer, phase: 'paired', words, easyConnect });
        setTimeout(() => {
          if (useSshPairings.getState().pairings[machine.id]?.phase === 'paired') forget(machine.id);
        }, 6_000);
        return;
      }
      if (status.status === 'denied') {
        await Promise.all([
          AsyncStorage.setItem(DECLINED_KEY(machine.id), String(Date.now())).catch(() => undefined),
          writeSaved(machine.id, null),
        ]);
        setHidden(machine.id, false);
        put({ machineId: machine.id, computer, phase: 'denied', words });
        return;
      }
      if (status.status === 'expired') break;
    }
    await updateSaved(machine.id, (latest) => ({ computer: latest.computer, hidden: latest.hidden, lapsedAtMs: Date.now() }));
    put({ machineId: machine.id, computer, phase: 'lapsed', words: [] });
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
  // Removing the phone on the computer ended its Easy Connect route with it.
  if (hasEasyConnectRoute(machine)) await forgetEasyConnectRoute(machine.id);
  forget(machine.id);
  return true;
}

/**
 * The keys this phone pairs for Easy Connect with: an SSH key of the route's own (kept from an earlier
 * ask that is still unanswered, so the request stays the same), and this computer's own Easy Connect
 * key when this app build has one (`easyConnectLinkKey.ts`), the phone's shared key otherwise.
 */
async function easyConnectKeys(machineId: string): Promise<{ sshPublicKey: string; tailcatClientKey: string }> {
  let [privateKey, sshPublicKey] = await Promise.all([getEasyConnectSshKey(machineId), getEasyConnectPublicKey(machineId)]);
  if (!privateKey || !sshPublicKey) {
    const key = await GhostexNative.generateSshKey('ed25519', SSH_KEY_COMMENT);
    privateKey = key.privateKey;
    sshPublicKey = key.publicKey;
    // Saved before asking: an approval that lands after a restart still matches this key.
    await Promise.all([setEasyConnectSshKey(machineId, privateKey), setEasyConnectPublicKey(machineId, sshPublicKey)]);
  }
  const tailcatClientKey = nativeHasMachineKeys()
    ? await GhostexNative.tailcatMachineClientKey!(machineId)
    : await GhostexNative.tailcatClientPublicKey();
  return { sshPublicKey, tailcatClientKey };
}

/** After an approval that included Easy Connect: the route, and this computer's own key as accepted. */
async function saveSecondRoute(machineId: string, addresses: unknown): Promise<void> {
  const [privateKey, publicKey] = await Promise.all([getEasyConnectSshKey(machineId), getEasyConnectPublicKey(machineId)]);
  if (!privateKey || !publicKey) return;
  if (nativeHasMachineKeys()) {
    const accepted = await GhostexNative.tailcatMachineClientKey!(machineId);
    await saveRegistered((current) => ({ ...current, [machineId]: accepted }));
  }
  await saveEasyConnectRoute(machineId, { privateKey, publicKey }, () =>
    saveEasyConnectAddresses(machineId, addresses, null),
  );
}

/** The comment on the SSH key line the computer writes for this phone's Easy Connect route. */
const SSH_KEY_COMMENT = 'ghostex-mobile';

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
      if (phase === 'denied' || phase === 'lapsed' || phase === 'failed') break;
    }
  }
  return { error: { ...error, code: 'approvalLapsed', message: SshPairingCopy.actionLapsed(computer), approval: null } };
}

// Registered when the app loads this module (SshPairingNotices.tsx, mounted at the app's root).
setHeldAnswerHandler(withSshPairing);
onChatLinkHandshake((machine, capabilities) => {
  // A handshake means the computer answers now; its card may show again.
  setReachable(machine.id, true);
  const plain = capabilities.includes(PLAIN_APPROVALS_CAPABILITY);
  notePlainApprovals(machine.id, plain);
  const easyConnect = capabilities.includes(PAIR_OVER_SSH_EASY_CONNECT_CAPABILITY) && signsInOverSsh(machine);
  setEasyConnectOffered(machine.id, easyConnect);
  /*
  CDXC:RemotePairing 2026-11-12 DECISION:
  User (Q2716 = A, Q2719): the first time a phone added by hand (Tailscale address, user, password
  or key) signs in, it also pairs for Easy Connect, with no click when it is the owner's own
  Tailscale device (gxserver checks; anything else gets the usual Approve with the three words),
  including on a computer that approves plainly, where nothing else asks.
  */
  if (easyConnect && !hasEasyConnectRoute(machine)) {
    void startSshPairing(machine, { auto: true, easyConnect: true });
    return;
  }
  // A computer that approves plainly lets a phone on its SSH login do everything, approving
  // included, so there is nothing to pair: no "Approve this phone?" there (CDXC:Security 2026-11-10
  // in `security/approvals.ts`).
  if (plain) {
    forget(machine.id);
    return;
  }
  if (capabilities.includes(PAIR_OVER_SSH_CAPABILITY)) void startSshPairing(machine, { auto: true });
});
onChatLinkCutOff((machineId) => setReachable(machineId, false));
onChatLinkTokenRefused((machine, token) => {
  void dropRevokedSshDeviceToken(machine, token);
});

