/**
 * The Home Screen widgets' data (a versioned snapshot, format version 2): the app writes it into the App Group
 * container after each session refresh (`widgetWriter.ts`), the widget extension only reads it. Small: the counts of
 * working and waiting agents and the attention marker; medium and large: the agents as well, waiting first; large:
 * the account usage bars where the app has them. Every size shows the data time.
 *
 * The agents are the ones the Live Activity shows, classified by its rules (`candidateFor` in `contentState.ts`):
 * finished agents are neither counted nor listed, an agent whose state has no start time in the summary is counted but
 * gets no row, and a waiting agent with a question is just waiting here (the snapshot has no question field). An agent
 * carries its leading name, resolved artwork and tint, project, state and since when; no prompt or reply text. The
 * leading name is the Live Activity row's (`leadingName`): the agent's, or the session's name where Settings ›
 * Live Activity › "Show session names" is on and the session has one.
 *
 * Kept free of React Native so the rules are testable under `bun test`.
 */

import type { AgentArtId } from '../contract/mobileSummary';
import type { UsageBar } from '../usage/usageMeters';
import { candidateFor, compareShown, dataTimeOf, leadingName, type ActivitySource, type Shown } from './contentState';

/** The snapshot's format; the widget shows its empty state for any other version. */
export const WIDGET_SNAPSHOT_VERSION = 2;
/** The large widget lists up to about eight agents (schema `maxItems`); the medium one shows its first three. */
export const MAX_WIDGET_AGENTS = 8;

export type WidgetAgent = {
  /** The name the agent's lines lead with, as `LiveActivityRow.agentName`. */
  agentName: string;
  /** Artwork and packed RGB tint already resolved by the shared Live Activity candidate. */
  agentIcon: AgentArtId;
  agentTint: number;
  project: string;
  state: 'working' | 'waiting';
  /** Working: since the stint began; waiting: since the agent waits. */
  sinceAt: string;
};

export type WidgetSnapshot = {
  schemaVersion: typeof WIDGET_SNAPSHOT_VERSION;
  /** The data time (`dataTimeOf` in `contentState.ts`): when the oldest summary with an agent to show was read. */
  writtenAt: string;
  counts: { working: number; waiting: number };
  /** True while any agent waits for the user. */
  attention: boolean;
  agents: WidgetAgent[];
  /** Only when the app has usage bars; absent otherwise, never empty bars. */
  usage?: { bars: UsageBar[] };
};

/**
 * The snapshot at `now` (epoch ms) over every given computer, with `usageBars` (the large widget's, possibly none).
 * The data time is `dataTimeOf`: the oldest read among the computers with an agent to show, which is the refresh
 * time when they all answered. `showSessionNames` is the Settings switch (`liveActivitySessionNames`): off, every agent
 * leads with its agent's name.
 */
export function buildSnapshot(
  sources: readonly ActivitySource[],
  now: number,
  usageBars: readonly UsageBar[] = [],
  showSessionNames = false,
): WidgetSnapshot {
  const counts = { working: 0, waiting: 0 };
  const shown: Shown[] = [];
  const readAt = new Map<string, number>();
  const machinesShown = new Set<string>();
  for (const source of sources) {
    readAt.set(source.machineId, source.loadedAt);
    for (const session of source.summary.sessions) {
      const candidate = candidateFor(
        source.machineId,
        session,
        source.summary.capabilities,
        now,
        source.summary.agents,
      );
      if (candidate === null || candidate.state === 'finished') continue;
      machinesShown.add(source.machineId);
      counts[candidate.state] += 1;
      if (candidate.shown !== null) shown.push(candidate.shown);
    }
  }
  const agents = shown
    .sort(compareShown)
    .slice(0, MAX_WIDGET_AGENTS)
    .map((entry): WidgetAgent => ({
      agentName: leadingName(entry, showSessionNames),
      agentIcon: entry.row.agentIcon,
      agentTint: entry.row.agentTint,
      project: entry.row.project,
      state: entry.row.state === 'waiting' ? 'waiting' : 'working',
      sinceAt: entry.row.startedAt,
    }));
  return {
    schemaVersion: WIDGET_SNAPSHOT_VERSION,
    writtenAt: new Date(dataTimeOf(readAt, machinesShown, now)).toISOString(),
    counts,
    attention: counts.waiting > 0,
    agents,
    ...(usageBars.length > 0 ? { usage: { bars: [...usageBars] } } : {}),
  };
}
