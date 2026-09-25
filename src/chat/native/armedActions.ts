/**
 * The session's armed Delayed Send and Close After Done as the chat's working row names them: the
 * phone form of `sessionChatArmedActions` (packages/shared/session-chat-presentation/armed-actions.ts),
 * which desktop's sidebar clock rebuilds every second for `working_strip.rs`.
 *
 * The phone reads the session's row in the inventory, which carries the Delayed Send deadline and
 * label and only whether Close After Done is armed, so a Close After Done has no countdown here and a
 * send waiting on one chosen agent reads as waiting on the agent.
 */

import { useMemo } from 'react';

import { formatDeadlineCountdown, useNowTick } from '../../components/sessions/timerCountdown';
import type { GhostexSession } from '../../contract/mobileSummary';
import { useInventoryStore } from '../../inventory/store';
import type { ArmedAction } from './cards';

function delayedSendLabel(session: GhostexSession, nowMs: number): string {
  const countdown = formatDeadlineCountdown(session.delayedSendDeadlineAt, nowMs);
  if (countdown.length > 0) return `Delayed Send in ${countdown}`;
  const remaining = session.delayedSendRemainingLabel;
  if (remaining === 'Waiting for agent') return 'Delayed Send when the agent finishes';
  if (remaining === 'Waiting for agents') return 'Delayed Send when all agents finish';
  return remaining.length > 0 ? `Delayed Send in ${remaining}` : 'Delayed Send armed';
}

export function armedActions(session: GhostexSession | null, nowMs: number): ArmedAction[] {
  if (session === null) return [];
  const actions: ArmedAction[] = [];
  if (session.delayedSendDeadlineAt.length > 0 || session.delayedSendRemainingLabel.length > 0) {
    actions.push({ id: 'delayedSend', label: delayedSendLabel(session, nowMs) });
  }
  if (session.closeAfterDone) actions.push({ id: 'closeAfterDone', label: 'Close After Done armed' });
  return actions;
}

/** The armed items for one session, ticking once a second while a Delayed Send counts down. */
export function useArmedActions(machineId: string, sessionId: string): ArmedAction[] {
  const session = useInventoryStore(
    (state) => state.inventoriesByMachineId[machineId]?.summary?.sessions.find((entry) => entry.sessionId === sessionId) ?? null
  );
  const nowMs = useNowTick(session !== null && session.delayedSendDeadlineAt.length > 0);
  return useMemo(() => armedActions(session, nowMs), [nowMs, session]);
}
