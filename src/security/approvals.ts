/**
 * GitHub #495: the computer's approval requests, seen and answered from this phone.
 *
 * - `listApprovals`: what waits for the owner (`/api/listApprovalRequests`).
 * - `approveRequest`: enrolls this phone's approver key with that computer the first time (which
 *   itself waits for the owner to approve the phone on the computer), then signs the request after
 *   the system prompt and approves it.
 * - `denyRequest`: no prompt; saying no only closes a door.
 *
 * Contract: ai/security-tokens-and-approvals.md in the Ghostex repo.
 *
 * CDXC:Security 2026-11-10 DECISION:
 * User (Q2140 = B): "thinking of removing all these dumb blocks because they're adding friction and a lot
 * of bugs", and "add a toggle to require touch id/pin etc for access but disabled by default, add it to
 * security". A computer that says `plainApprovals` takes Approve as one tap: no approver key, no
 * signature. When its "Require Face ID to approve" switch is on (`requirePresence`, shared with the
 * computer's Settings > Security), the phone asks for Face ID or the fingerprint first. A computer from
 * before plain approvals (Ghostex 11.2.2 and earlier) still gets the signed approval below; delete that
 * path, `ensureEnrolled` and `waitForApproval` once those computers no longer matter.
 */

import { Platform } from 'react-native';
import { create } from 'zustand';

import { chatMachineLink } from '../chat/rust/machine-link';
import type { RpcAnswer } from '../chat/rust/transport';
import type { MachineConnectionTarget } from '../machines/credentials';
import { approvalSigningPayload, type ApprovalRequest } from './approvalPayload';
import { APPROVER_KEY_ALGORITHM, approverKeyPublic, approverKeySign } from './approverKey';

const RPC_TIMEOUT_MS = 15_000;
const ENROLL_WAIT_MS = 10 * 60 * 1000;

async function rpc(machine: MachineConnectionTarget, method: string, params: Record<string, unknown>): Promise<RpcAnswer> {
  const link = chatMachineLink(machine);
  await link.route();
  return link.rpc(method, params, RPC_TIMEOUT_MS);
}

function failed(answer: RpcAnswer): Error | null {
  return answer.error === null ? null : new Error(answer.error.message);
}

/** What the computer says about approving: one tap (`plainApprovals`), and its Face ID switch. */
export type ApprovalMode = { plain: boolean; requirePresence: boolean };

/** Computers whose handshake said `plainApprovals` (machine-link's endpoint capabilities). */
export const usePlainApprovals = create<{ plain: Record<string, true> }>(() => ({ plain: {} }));

/** Records whether `machineId`'s gxserver approves plainly, from its handshake's capabilities. */
export function notePlainApprovals(machineId: string, plain: boolean): void {
  if ((usePlainApprovals.getState().plain[machineId] === true) === plain) return;
  usePlainApprovals.setState((state) => {
    const { [machineId]: _was, ...rest } = state.plain;
    return { plain: plain ? { ...rest, [machineId]: true } : rest };
  });
}

export async function approvalMode(machine: MachineConnectionTarget): Promise<ApprovalMode> {
  const answer = await rpc(machine, 'securityStatus', {});
  const error = failed(answer);
  if (error !== null) throw error;
  const result = (answer.result ?? {}) as { plainApprovals?: boolean; requirePresence?: boolean };
  return { plain: result.plainApprovals === true, requirePresence: result.requirePresence === true };
}

/** Turns the computer's "Require Face ID to approve" switch on or off (its Settings > Security). */
export async function setRequirePresence(machine: MachineConnectionTarget, on: boolean): Promise<void> {
  const error = failed(
    await rpc(machine, 'dispatchRendererCommand', {
      action: 'updateSettingsPatch',
      payload: { patch: { approvalsRequirePresence: on } },
    }),
  );
  if (error !== null) throw error;
}

export async function listApprovals(machine: MachineConnectionTarget): Promise<ApprovalRequest[]> {
  const answer = await rpc(machine, 'listApprovalRequests', {});
  const error = failed(answer);
  if (error !== null) throw error;
  const requests = (answer.result as { requests?: ApprovalRequest[] } | null)?.requests;
  return Array.isArray(requests) ? requests : [];
}

export async function denyRequest(machine: MachineConnectionTarget, id: string): Promise<void> {
  const error = failed(await rpc(machine, 'denyApprovalRequest', { id }));
  if (error !== null) throw error;
}

/** What the computer said its id is (part of every signed approval). */
async function serverStatus(machine: MachineConnectionTarget): Promise<{ serverId: string; keys: Array<{ keyId: string; publicKey: string }> }> {
  const answer = await rpc(machine, 'securityStatus', {});
  const error = failed(answer);
  if (error !== null) throw error;
  const result = answer.result as { serverId?: string; approverKeys?: Array<{ keyId: string; publicKey: string }> };
  if (typeof result?.serverId !== 'string') throw new Error('The computer did not say which Ghostex it is.');
  return { serverId: result.serverId, keys: result.approverKeys ?? [] };
}

/**
 * gxserver names the request in its `approvalRequired` message (`approvalId "apr_…"`); the
 * phone's link keeps only the code and message of an error.
 */
export function approvalIdOf(message: string): string | null {
  return /approvalId "(apr_[A-Za-z0-9_-]+)"/.exec(message)?.[1] ?? null;
}

async function waitForApproval(machine: MachineConnectionTarget, id: string): Promise<boolean> {
  const deadline = Date.now() + ENROLL_WAIT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const answer = await rpc(machine, 'readApprovalRequest', { id });
    const status = (answer.result as { request?: ApprovalRequest } | null)?.request?.status;
    if (status === 'approved') return true;
    if (status === 'denied' || status === 'expired' || status === 'consumed') return false;
  }
  return false;
}

/**
 * This phone's approver key id on `machine`, enrolling it the first time. `onWaiting` runs while
 * the computer asks its owner to approve adding this phone.
 */
async function ensureEnrolled(machine: MachineConnectionTarget, onWaiting: () => void): Promise<{ keyId: string; serverId: string }> {
  const publicKey = await approverKeyPublic();
  const status = await serverStatus(machine);
  const known = status.keys.find((key) => key.publicKey === publicKey);
  if (known !== undefined) return { keyId: known.keyId, serverId: status.serverId };
  const key = {
    keyId: '',
    deviceId: `phone-${publicKey.slice(0, 12)}`,
    label: 'Phone',
    platform: Platform.OS,
    algorithm: APPROVER_KEY_ALGORITHM,
    publicKey,
    presence: 'biometric',
    addedAtMs: 0,
  };
  let answer = await rpc(machine, 'enrollApproverKey', { key });
  if (answer.error !== null && answer.error.code === 'approvalRequired') {
    const id = approvalIdOf(answer.error.message);
    if (id === null) throw new Error(answer.error.message);
    onWaiting();
    if (!(await waitForApproval(machine, id))) throw new Error('Adding this phone as an approver was not approved.');
    answer = await rpc(machine, 'enrollApproverKey', { key, approvalId: id });
  }
  const error = failed(answer);
  if (error !== null) throw error;
  const keyId = (answer.result as { key?: { keyId?: string } } | null)?.key?.keyId;
  if (typeof keyId !== 'string') throw new Error('The computer did not keep this phone’s key.');
  return { keyId, serverId: status.serverId };
}

/** Signs `request` after the system prompt and approves it on `machine`. */
export async function approveRequest(
  machine: MachineConnectionTarget,
  request: ApprovalRequest,
  onWaitingForComputer: () => void = () => {},
): Promise<void> {
  const mode = await approvalMode(machine);
  if (mode.plain) {
    // The computer's Face ID switch: the system prompt first (the approver key's own prompt, over a
    // payload nobody checks), then the same one-tap approval.
    if (mode.requirePresence) await approverKeySign(`ghostex-approve-check\n${request.id}`, request.summary);
    const error = failed(await rpc(machine, 'approveApprovalRequest', { id: request.id }));
    if (error !== null) throw error;
    return;
  }
  const { keyId, serverId } = await ensureEnrolled(machine, onWaitingForComputer);
  const signature = await approverKeySign(approvalSigningPayload(serverId, request), request.summary);
  const error = failed(await rpc(machine, 'approveApprovalRequest', { id: request.id, keyId, signature }));
  if (error !== null) throw error;
}
