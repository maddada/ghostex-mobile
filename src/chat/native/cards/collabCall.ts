/**
 * One call to a computer's `/api/collab` (or `/api/extensionComponents`, which installs Collab)
 * from the phone, waiting out the owner's approval.
 *
 * CDXC:Collab 2026-11-08 DECISION:
 * User (#495): installing Collab (it is an extension since 11.0.1, Q1730), sharing a chat (and showing its link again), Send mode and sending
 * a guest's message need the owner's signed approval. The computer answers `approvalRequired` with
 * the request; it shows on the computer and the phone, and the computer makes the change itself once
 * it is approved. The phone says where to approve and repeats the call with `approvalId` every few
 * seconds: while the request waits it gets the same request back, and once approved, the answer
 * (for a share, its link and code).
 */

import type { MachineConnectionTarget } from '../../../machines/credentials';
import { chatMachineLink } from '../../rust/machine-link';

const CALL_TIMEOUT_MS = 15_000;
const RETRY_MS = 3_000;
/** A pending request lapses after 10 minutes on the computer. */
const GIVE_UP_MS = 11 * 60_000;

export type CollabAnswer = { result: Record<string, unknown>; error: null } | { result: null; error: string };

export async function collabCall(
  machine: MachineConnectionTarget,
  params: Record<string, unknown>,
  onWaiting?: (summary: string | null) => void,
  alive: () => boolean = () => true,
  endpoint: 'collab' | 'extensionComponents' = 'collab',
): Promise<CollabAnswer> {
  const deadline = Date.now() + GIVE_UP_MS;
  let current = params;
  try {
    for (;;) {
      const answer = await chatMachineLink(machine).rpc(endpoint, current, CALL_TIMEOUT_MS);
      if (answer.error === null) {
        onWaiting?.(null);
        return { result: (answer.result ?? {}) as Record<string, unknown>, error: null };
      }
      const approval = answer.error.approval;
      if (answer.error.code === 'approvalRequired' && approval?.id && Date.now() < deadline && alive()) {
        onWaiting?.(approval.summary ?? '');
        current = { ...params, approvalId: approval.id };
        await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
        continue;
      }
      onWaiting?.(null);
      if (answer.error.code === 'approvalDenied') return { result: null, error: "You didn't approve it." };
      if (answer.error.code === 'approvalRequired')
        return { result: null, error: 'The approval request ran out. Try again.' };
      const unknown = /unknown|not a gxserver|no gxserver endpoint/i.test(answer.error.message);
      return {
        result: null,
        error: unknown
          ? 'Update Ghostex on this computer to use Ghostex Collab from your phone.'
          : answer.error.message,
      };
    }
  } catch (failure) {
    onWaiting?.(null);
    return {
      result: null,
      error: failure instanceof Error ? failure.message : "Couldn't reach Ghostex on your computer.",
    };
  }
}

/** Links and codes the owner revealed with an approval, by share id, for this run of the app only. */
export const revealedShares = new Map<string, { link: string; code: string }>();

/** An eight-digit code in two groups, as the computer shows it. */
export function spacedCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)} ${code.slice(4)}` : code;
}
