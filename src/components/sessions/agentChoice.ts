/**
 * Which agent a project's agent button starts on the phone: the one last picked in that project, in
 * its Space, or anywhere, as the computer's Settings > Agents > Remember the agent you pick says.
 *
 * CDXC:AgentLauncher 2026-10-30 DECISION: User: the phone remembers its agent pick per project too,
 * following the same "Remember the agent you pick" setting (Per project, Per Space, Everywhere), with
 * the desktop's fallbacks: a project with no pick yet starts the last agent picked anywhere, and a
 * turned-off agent falls back to the last pick, then the first agent offered. The setting reaches the
 * phone in the computer's session summary (`newSessionAgentScope`, absent = per project). Every pick
 * is remembered for its project, its Space and as the last pick, so changing the setting later starts
 * from what was really picked; with Spaces off there is no Space, so Per Space reads as Everywhere.
 * SEE-ALSO: packages/gx-core/src/sidebar_menu/agent_choice.rs (the desktop's same rule),
 * server/src/ghostex_cli/sessions/mobile_summary.rs (`newSessionAgentScope`).
 */

/** The computer's `newSessionAgentScope`. */
export type AgentChoiceScope = 'project' | 'space' | 'everywhere';

/** Where a launch happens: the keys its project and its Space are remembered under. */
export type AgentChoicePlace = {
  /** `${machineId}:${projectId}` (a worktree counts as its parent project), or null. */
  project: string | null;
  /** `${machineId}:${spaceId}` while the computer has Spaces, otherwise null. */
  space: string | null;
};

/** What a project's launch reads: the computer's setting and where the project is remembered. */
export type AgentChoiceContext = { scope: AgentChoiceScope; place: AgentChoicePlace };

/** The phone's remembered picks. */
export type AgentChoices = {
  /** The agent picked last anywhere ('' = none yet). */
  last: string;
  byProject: Record<string, string>;
  bySpace: Record<string, string>;
};

/** How many projects (and, separately, Spaces) keep a pick; the first-named one gives way. */
export const MAX_REMEMBERED_AGENT_CHOICES = 250;

export const EMPTY_AGENT_CHOICES: AgentChoices = { last: '', byProject: {}, bySpace: {} };

/** The summary's `newSessionAgentScope`; anything else (absent on an older computer) is per project. */
export function parseAgentChoiceScope(value: unknown): AgentChoiceScope {
  return value === 'space' || value === 'everywhere' ? value : 'project';
}

/** The place of a project on a machine: its own key and the Space the drawer shows it in. */
export function agentChoicePlace(
  machineId: string,
  projectId: string,
  worktreeParentProjectId: string,
  spaceId: string | null,
): AgentChoicePlace {
  const owner = worktreeParentProjectId.length > 0 ? worktreeParentProjectId : projectId;
  return {
    project: owner.length > 0 ? `${machineId}:${owner}` : null,
    space: spaceId !== null && spaceId.length > 0 ? `${machineId}:${spaceId}` : null,
  };
}

/** The agents a launch at `place` tries, in order: the remembered one (as the setting says), then the last pick. */
export function agentChoiceCandidates(
  choices: AgentChoices,
  scope: AgentChoiceScope,
  place: AgentChoicePlace,
): string[] {
  const remembered =
    scope === 'project' && place.project !== null
      ? choices.byProject[place.project]
      : scope === 'space' && place.space !== null
        ? choices.bySpace[place.space]
        : undefined;
  const candidates: string[] = [];
  if (remembered !== undefined && remembered.length > 0) candidates.push(remembered);
  if (choices.last.length > 0 && !candidates.includes(choices.last)) candidates.push(choices.last);
  return candidates;
}

/** The agent a project's button starts: the first candidate still offered, else the first agent. */
export function resolveAgentChoice<T extends { agentId: string }>(
  agents: readonly T[],
  choices: AgentChoices,
  scope: AgentChoiceScope,
  place: AgentChoicePlace,
): T | null {
  for (const agentId of agentChoiceCandidates(choices, scope, place)) {
    const agent = agents.find((candidate) => candidate.agentId === agentId);
    if (agent !== undefined) return agent;
  }
  return agents[0] ?? null;
}

function withBounded(map: Record<string, string>, key: string | null, agentId: string): Record<string, string> {
  if (key === null) return map;
  const next = { ...map };
  if (!(key in next)) {
    const keys = Object.keys(next).sort();
    while (keys.length >= MAX_REMEMBERED_AGENT_CHOICES) {
      const dropped = keys.shift();
      if (dropped !== undefined) delete next[dropped];
    }
  }
  next[key] = agentId;
  return next;
}

/** Remembers a pick at `place`: for its project, for its Space, and as the last pick anywhere. */
export function rememberAgentChoice(choices: AgentChoices, agentId: string, place: AgentChoicePlace): AgentChoices {
  const trimmed = agentId.trim();
  if (trimmed.length === 0) return choices;
  return {
    last: trimmed,
    byProject: withBounded(choices.byProject, place.project, trimmed),
    bySpace: withBounded(choices.bySpace, place.space, trimmed),
  };
}

/** Reads a persisted map, keeping only string values. */
export function readAgentChoiceMap(value: unknown): Record<string, string> {
  const map: Record<string, string> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return map;
  for (const [key, agentId] of Object.entries(value)) {
    if (key.length > 0 && typeof agentId === 'string' && agentId.trim().length > 0) map[key] = agentId.trim();
  }
  return map;
}
