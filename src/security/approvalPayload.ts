/**
 * GitHub #495: an approval request as gxserver sends it, and the exact bytes this phone's
 * approver key signs to approve it. Mirrors `approval_signing_payload` in the Ghostex repo's
 * packages/gx-protocol/src/approval.rs; the test pins the same example as the Rust test
 * `signing_payload_is_line_based_and_stable`, so the two can't drift apart.
 */

export type ApprovalRequester = {
  kind: string;
  label: string;
  projectId?: string;
  sessionId?: string;
  deviceId?: string;
};

export type ApprovalRequest = {
  id: string;
  action: string;
  target?: string;
  /** One line written by the computer, never by the asking agent. */
  summary: string;
  detail?: string;
  paramsDigest: string;
  nonce: string;
  requestedBy: ApprovalRequester;
  createdAtMs: number;
  expiresAtMs: number;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed' | string;
  decidedAtMs?: number;
  decidedBy?: string;
};

export const APPROVAL_SIGNING_DOMAIN = 'ghostex-approval-v1';

/**
 * One field per line, `\n` line ends, no trailing newline; a field with a line break (or an
 * empty required one) is refused, so no field can forge another line.
 */
export function approvalSigningPayload(serverId: string, request: ApprovalRequest): string {
  const fields: Array<[string, string, boolean]> = [
    ['serverId', serverId, true],
    ['id', request.id, true],
    ['nonce', request.nonce, true],
    ['action', request.action, true],
    ['target', request.target ?? '', false],
    ['paramsDigest', request.paramsDigest, true],
    ['expiresAtMs', String(request.expiresAtMs), true],
  ];
  const lines = [APPROVAL_SIGNING_DOMAIN];
  for (const [name, value, required] of fields) {
    if (/[\r\n]/.test(value) || (required && value.length === 0)) {
      throw new Error(`Approval field ${name} is empty or contains a line break.`);
    }
    lines.push(value);
  }
  lines.push('approve');
  return lines.join('\n');
}
