import type { GhostexAttentionKind } from '../contract/mobileSummary';

/** Settings › Notifications › Alert me for: every attention, or only the ones that wait on you. */
export type AttentionAlertsFor = 'all' | 'needsYou';

/**
 * Whether an attention alerts (the attention sound, and a Finished notification) under Alert me for, the rule the
 * desktop applies (`attention_alerts` in packages/gx-core/src/alert_rule.rs).
 *
 * CDXC:Notifications 2026-11-07 DECISION:
 * User, approving PR #457 ("Needs you only"): "yes, phone too". Needs you only alerts for an attention that waits on
 * you: a question, approval or other wait (`needsInput`), or a finished turn whose handover has a Blocked or Needs
 * you section, unless the session is a coordinator's thread, which reports to its coordinator. An attention from a
 * computer that sends no kind alerts as before.
 *
 * CDXC:Notifications 2026-11-08 DECISION:
 * User: "please don't show notifications or play sound for worker threads under a coordinator finishing ever. also
 * for a coordinator, we should always only show notification and play sound when he needs you (pink dot basically or
 * blocked red dot) not when he finishes." The computer decides first (`attention.alerts`, which also knows when
 * Autopilot answers an approval); a computer that predates it is judged here by the same rule: a thread's finished
 * turn never alerts, a coordinator's only when its handover needs you, under All too. Alert me for narrows the rest.
 */
export function attentionAlerts(
  alertsFor: AttentionAlertsFor,
  session: {
    attentionKind: GhostexAttentionKind;
    attentionHandoverNeedsYou: boolean;
    coordinatorSessionId: string;
    isCoordinator?: boolean;
    attentionAlerts?: boolean | null;
  },
): boolean {
  if (session.attentionAlerts === false) return false;
  if (session.attentionKind !== 'finished') return true;
  const thread = session.coordinatorSessionId.trim().length > 0;
  if (thread) return false;
  if (session.attentionAlerts !== true && session.isCoordinator === true) return session.attentionHandoverNeedsYou;
  return alertsFor === 'all' || session.attentionHandoverNeedsYou;
}
