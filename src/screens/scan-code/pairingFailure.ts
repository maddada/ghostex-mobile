/**
 * What the failure screen says for a pairing that did not finish: the real reason (nobody approved in time is
 * not a used-up code), and the next step in the computer's own words.
 */

import { PairingCopy } from '../../copy';
import type { EasyConnectPairingFailure } from '../../machines/pairing';

export type ScanFailure = {
  reason: Exclude<EasyConnectPairingFailure, 'cancelled'>;
  /** pairing.ts's own sentence for it. */
  message: string;
  computer: string;
  waitedMs?: number;
};

export type FailureText = { title: string; body: string; details: string | null };

export function failureText(failure: ScanFailure): FailureText {
  const copy = PairingCopy.failure;
  const { computer, message } = failure;
  switch (failure.reason) {
    case 'timedOut': {
      const minutes = failure.waitedMs === undefined ? null : Math.round(failure.waitedMs / 60_000);
      return { title: copy.timedOut.title, body: copy.timedOut.body(computer, minutes), details: null };
    }
    case 'dropped':
      return { title: copy.dropped.title, body: copy.dropped.body(computer), details: null };
    case 'expired':
      return { title: copy.expired.title, body: copy.expired.body, details: null };
    case 'denied':
      return { title: copy.denied.title, body: copy.denied.body(computer), details: null };
    case 'noSecret':
      return { title: copy.noSecret.title, body: copy.noSecret.body, details: null };
    case 'wordsMismatch':
      return { title: copy.wordsMismatch.title, body: copy.wordsMismatch.body, details: null };
    case 'needsUpdate':
      return { title: copy.needsUpdate.title, body: message, details: null };
    case 'computerTooOld':
      return { title: copy.computerTooOld.title, body: message, details: null };
    case 'unreachable':
      return { title: copy.unreachable.title(computer), body: copy.unreachable.body, details: message };
    case 'rejected':
      // gxserver's refusals (too many tries, a declined administrator prompt) are written for the person.
      return { title: copy.rejected.title(computer), body: message, details: null };
  }
}
