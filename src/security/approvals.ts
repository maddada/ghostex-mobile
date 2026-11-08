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
 */

import { Platform } from 'react-native';

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
  const { keyId, serverId } = await ensureEnrolled(machine, onWaitingForComputer);
  const signature = await approverKeySign(approvalSigningPayload(serverId, request), request.summary);
  const error = failed(await rpc(machine, 'approveApprovalRequest', { id: request.id, keyId, signature }));
  if (error !== null) throw error;
}
