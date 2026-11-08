/**
 * Agent events: what the computer reported (`HostEvent`), the session it belongs to as the phone's
 * session list knows it (`SessionFacts`), and the event the phone notifies about (`AttentionEvent`).
 *
 * The events that notify: finished, waiting for you (approvals such as bash or rm included), has a question, ended
 * with an error. Nothing else notifies: no session start or end, no "agent runs", no user abort. Those reach the
 * phone only as summary changes, never as one of the notifying host kinds. A message the computer could not send
 * (`sendFailed`) is a row of the attention list only, as on the desktop, which shows no banner and plays no sound for
 * it.
 *
 * Top-level sessions only: an event notifies only when its session is in that computer's session list, the sessions
 * the user sees. Coordinator threads are listed sessions and notify; the host drops true subagents before they reach
 * its feed or summary, so a subagent event that ever arrived would name no listed session.
 * Kept free of React Native so it is testable under `bun test`.
 */

import {
  hasQuestion,
  resolveAgentIconId,
  type AgentIconId,
  type GhostexMobileSummary,
} from '../contract/mobileSummary';
import { attentionAlerts } from './attentionAlerts';
import { isAccountRow, type FeedRow } from './feedContract';

export type AttentionKind = 'finished' | 'waiting' | 'question' | 'failed';

/**
 * The host kinds that can notify. An Expo push message names its event
 * with the same three values, so a push and a feed row of one event map through the same code.
 */
export const HOST_EVENT_KINDS = ['finished', 'needsInput', 'failed'] as const;

export type HostEventKind = (typeof HOST_EVENT_KINDS)[number];

/** One event the computer reported, from a feed row (and, with push, from a push message's data). */
export type HostEvent = {
  machineId: string;
  sessionId: string;
  /** Any host kind; only `HostEventKind` values can notify. */
  kind: string;
  /**
   * The feed row id. With push, a push carries it as `data.notificationId` (the identity contract in
   * `eventIdentity.ts`); '' when the source has none.
   */
  eventId: string;
  /** ISO time of the event. */
  occurredAt: string;
};

/** What the phone's session list says about the event's session. */
export type SessionFacts = {
  projectId: string;
  /** The agent's name as the session list shows it (the launcher's name, else the session's agent). */
  agentLabel: string;
  agentIconId: AgentIconId;
  projectName: string;
  /** The session's title in the list ('' when it has none). */
  title: string;
  /** Questions the agent waits on that the computer counts (Codex questions and question forms). */
  pendingQuestionCount: number;
  /**
   * An open question card waits for an answer; false also when the computer's summary does not announce the field
   * (`capabilities.awaitingAnswer`), so it is read only where the computer sends it.
   */
  awaitingAnswer: boolean;
  /** The session's current attention event (`attention.eventId`); '' outside attention or from an older computer. */
  attentionId: string;
  /** A finished turn of this session alerts under Needs you only (`attentionAlerts`); unknown alerts as before. */
  finishedNeedsYou?: boolean;
  /** When that attention began (`attention.enteredAt`, ISO); '' outside attention or when the computer omits it. */
  attentionEnteredAt: string;
};

/** The normalised event: event kind plus session identity and names, no text. */
export type AttentionEvent = {
  eventId: string;
  kind: AttentionKind;
  hostKind: HostEventKind;
  machineId: string;
  projectId: string;
  sessionId: string;
  agentName: string;
  projectName: string;
  occurredAt: string;
};

/** The session as the computer's session list has it, or undefined when it does not list it. */
export function sessionFacts(
  summary: GhostexMobileSummary | null | undefined,
  sessionId: string,
): SessionFacts | undefined {
  const session = summary?.sessions.find((entry) => entry.sessionId === sessionId);
  if (summary === null || summary === undefined || session === undefined) return undefined;
  const launcher = summary.agents.find((agent) => agent.agentId === session.agent);
  const agentLabel = [launcher?.name, session.agentName, session.agent].find(
    (name): name is string => name !== undefined && name.trim().length > 0,
  );
  return {
    projectId: session.projectId,
    agentLabel: agentLabel?.trim() ?? '',
    agentIconId: resolveAgentIconId(
      session.agentIcon,
      session.agentName.length > 0 ? session.agentName : session.agent,
    ),
    projectName: session.projectName,
    title: session.displayTitle,
    pendingQuestionCount: session.pendingQuestionCount,
    awaitingAnswer: summary.capabilities.awaitingAnswer && session.awaitingAnswer,
    attentionId: session.attentionEventId,
    attentionEnteredAt: session.attentionEnteredAt,
    finishedNeedsYou: attentionAlerts('needsYou', { ...session, attentionKind: 'finished' }),
  };
}

/**
 * A feed row as a host event; account rows are no agent events and give none, and neither does a row that arrives
 * already read: the computer writes a row read when its alert rule keeps it quiet (a coordinator's thread finishing,
 * CDXC:Notifications 2026-11-08 in packages/gx-core/src/alert_rule.rs), and a row read before it reached the phone
 * was seen already.
 */
export function hostEventFromFeedRow(machineId: string, row: FeedRow): HostEvent | null {
  if (isAccountRow(row) || row.read) return null;
  return {
    machineId,
    sessionId: row.sessionId,
    kind: row.kind,
    eventId: row.id,
    occurredAt: row.createdAt,
  };
}

/** The event to notify about, or null when this event never notifies. */
export function mapEvent(event: HostEvent, facts: SessionFacts | undefined): AttentionEvent | null {
  if (facts === undefined) return null;
  let kind: AttentionKind;
  if (event.kind === 'finished') kind = 'finished';
  else if (event.kind === 'failed') kind = 'failed';
  else if (event.kind === 'needsInput') {
    kind = hasQuestion(facts.pendingQuestionCount, facts.awaitingAnswer) ? 'question' : 'waiting';
  } else return null;
  return {
    eventId: event.eventId,
    kind,
    hostKind: event.kind,
    machineId: event.machineId,
    projectId: facts.projectId,
    sessionId: event.sessionId,
    agentName: facts.agentLabel,
    projectName: facts.projectName,
    occurredAt: event.occurredAt,
  };
}
