/**
 * Find (the GUI for `gx f`) wire contract and its calls over SSH.
 *
 * Prompt history lives on the machine that ran the agent, and the phone has no
 * HTTP path to gxserver, so every call runs the matching `ghostex` CLI verb on
 * that machine. The ranking, matcher, Codex cache and favorites file are the
 * daemon's (packages/find in the Ghostex main repo); the phone only draws what
 * it answers, so a prompt starred here is starred in `gx f` and on the desktop.
 *
 * Rows address prompts by `key`, a stable identity derived from the agent and
 * the prompt text (exactly what the favorites file hashes). A rebuild reorders
 * records, and a user can sit on a result for minutes before acting on it, so
 * every follow-up call names the key rather than a list position.
 *
 * CDXC:PromptSearch 2026-09-13 WHY:
 * The CLI prints each Find payload directly, without a nested `result` field.
 * Reading `json.result` discarded successful replies and made search fail on `.rows`.
 *
 * SEE-ALSO: server/src/agent_prompt_search.rs (the payloads), apps/desktop/src/app/window/find_prompts/ (the desktop window).
 */

import {
  readAgentPromptTextCommand,
  resolveAgentPromptLaunchCommand,
  searchAgentPromptsCommand,
  toggleAgentPromptFavoriteCommand,
} from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import type { MachineConnectionTarget } from '../machines/credentials';

/** The agents Find indexes, in filter order. */
export const FIND_PROMPT_AGENTS = ['claude', 'codex', 'pi', 'opencode', 'cursor', 'grok', 'empryo'] as const;

export type FindPromptAgent = (typeof FIND_PROMPT_AGENTS)[number];

/** The agents a prompt can be forked into, in the order the fork picker numbers them. Empryo's terminal app takes no starting prompt. */
export const FIND_PROMPT_FORK_AGENTS: readonly FindPromptAgent[] = FIND_PROMPT_AGENTS.filter((agent) => agent !== 'empryo');

export function isFindPromptAgent(value: unknown): value is FindPromptAgent {
  return typeof value === 'string' && (FIND_PROMPT_AGENTS as readonly string[]).includes(value);
}

export type FindPromptUsage = {
  cacheRead: number;
  cacheWrite: number;
  contextWindow: number;
  cost: number;
  input: number;
  output: number;
  ratePercent: number;
  total: number;
};

export type FindPromptMeta = {
  model: string;
  plan: string;
  provider: string;
  thinking: string;
  usage: FindPromptUsage;
};

export type FindPromptRow = {
  agent: FindPromptAgent;
  /** Brand color for the agent, so every host paints the same palette. */
  agentColor: string;
  /** Day bucket the server groups by; negative when the day is unknown. */
  dayKey: number;
  favorite: boolean;
  /** Byte offsets in `text` that matched the query. */
  highlights: readonly number[];
  /** Stable identity of this prompt; pass it to every follow-up call. */
  key: string;
  meta: FindPromptMeta;
  project: string;
  projectName: string;
  sessionId: string;
  /** Possibly truncated; `readFindPromptText` returns the rest. */
  text: string;
  title: string;
  truncated: boolean;
  /** Session last-active unix seconds; 0 when unknown. */
  ts: number;
};

export type FindPromptProjectFacet = { name: string; path: string };

export type FindPromptAgentFacet = { agent: FindPromptAgent; color: string; present: boolean };

export type FindPromptsSearchParams = {
  agents: readonly FindPromptAgent[];
  groupByDay: boolean;
  includeFacets: boolean;
  limit: number;
  offset: number;
  project: string | null;
  query: string;
  /** Forces an index rebuild before answering. */
  refresh: boolean;
};

export type FindPromptsSearchResult = {
  agents?: readonly FindPromptAgentFacet[];
  /** Records that passed the filters and matched the query. */
  matched: number;
  offset: number;
  /** Present when an opencode database exists but could not be read. */
  opencodeError?: string;
  /** Present when Empryo's thread index exists but could not be read. */
  empryoError?: string;
  projects?: readonly FindPromptProjectFacet[];
  rows: readonly FindPromptRow[];
  /** Every record in the index, before filtering. */
  total: number;
};

/** A live Ghostex session already owns this agent conversation: open it. */
export type FindPromptFocusPlan = { mode: 'focus'; projectId: string; sessionId: string };

/** Nothing owns it: run `commandLine` in `cwd` as a new session. */
export type FindPromptLaunchPlan = {
  mode: 'launch';
  agent: string;
  /** The command quoted into one POSIX line. */
  commandLine: string;
  cwd: string;
  /** False when the recorded project directory is gone. */
  cwdExists: boolean;
  title: string;
};

export type FindPromptLaunchResult = FindPromptFocusPlan | FindPromptLaunchPlan;

/**
 * A cold search walks every agent history store on the machine and rebuilds the
 * Codex derived cache, so the first call can run for tens of seconds; warm
 * searches answer in well under a second.
 */
const FIND_SEARCH_TIMEOUT_MS = 60000;
/** Key-addressed reads and toggles are single index lookups. */
const FIND_ACTION_TIMEOUT_MS = 20000;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function num(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseRow(value: unknown): FindPromptRow | null {
  const row = record(value);
  const key = str(row.key);
  if (key.length === 0 || !isFindPromptAgent(row.agent)) return null;
  const meta = record(row.meta);
  const usage = record(meta.usage);
  return {
    agent: row.agent,
    agentColor: str(row.agentColor),
    dayKey: typeof row.dayKey === 'number' ? row.dayKey : -1,
    favorite: row.favorite === true,
    highlights: Array.isArray(row.highlights)
      ? row.highlights.filter((offset): offset is number => typeof offset === 'number')
      : [],
    key,
    meta: {
      model: str(meta.model),
      plan: str(meta.plan),
      provider: str(meta.provider),
      thinking: str(meta.thinking),
      usage: {
        cacheRead: num(usage.cacheRead),
        cacheWrite: num(usage.cacheWrite),
        contextWindow: num(usage.contextWindow),
        cost: num(usage.cost),
        input: num(usage.input),
        output: num(usage.output),
        ratePercent: num(usage.ratePercent),
        total: num(usage.total),
      },
    },
    project: str(row.project),
    projectName: str(row.projectName),
    sessionId: str(row.sessionId),
    text: str(row.text),
    title: str(row.title),
    truncated: row.truncated === true,
    ts: num(row.ts),
  };
}

function parseSearchResult(json: Json | null): FindPromptsSearchResult {
  const result = record(json);
  if (!Array.isArray(result.rows)) throw new Error('Ghostex answered the search without any results list.');
  const rows = result.rows.map(parseRow).filter((row): row is FindPromptRow => row !== null);
  const projects = Array.isArray(result.projects)
    ? result.projects
        .map(record)
        .map((facet) => ({ name: str(facet.name), path: str(facet.path) }))
        .filter((facet) => facet.path.length > 0)
    : undefined;
  const agents = Array.isArray(result.agents)
    ? result.agents
        .map(record)
        .filter((facet) => isFindPromptAgent(facet.agent))
        .map((facet) => ({
          agent: facet.agent as FindPromptAgent,
          color: str(facet.color),
          present: facet.present === true,
        }))
    : undefined;
  const opencodeError = str(result.opencodeError);
  const empryoError = str(result.empryoError);
  return {
    agents,
    matched: num(result.matched),
    offset: num(result.offset),
    opencodeError: opencodeError.length > 0 ? opencodeError : undefined,
    empryoError: empryoError.length > 0 ? empryoError : undefined,
    projects,
    rows,
    total: num(result.total),
  };
}

export async function searchFindPrompts(
  machine: MachineConnectionTarget,
  params: FindPromptsSearchParams,
): Promise<FindPromptsSearchResult> {
  const result = await runGhostexCli(
    machine,
    searchAgentPromptsCommand({
      agents: params.agents,
      // Absent means ungrouped, which also works with a `ghostex` older than 2026-10-01 (it read `false` as true).
      groupByDay: params.groupByDay ? true : undefined,
      includeFacets: params.includeFacets,
      limit: params.limit,
      offset: params.offset,
      project: params.project ?? undefined,
      query: params.query,
      // Absent means no rebuild; an older `ghostex` read `--refresh false` as a forced rebuild on every search.
      refresh: params.refresh ? true : undefined,
    }),
    { timeoutMs: FIND_SEARCH_TIMEOUT_MS },
  );
  return parseSearchResult(result.json);
}

/** The whole prompt; rows carry a capped copy. */
export async function readFindPromptText(machine: MachineConnectionTarget, key: string): Promise<string> {
  const result = await runGhostexCli(machine, readAgentPromptTextCommand(key), {
    timeoutMs: FIND_ACTION_TIMEOUT_MS,
  });
  return str(record(result.json).text);
}

/** Stars or unstars a prompt in the favorites file `gx f` and the desktop share. */
export async function setFindPromptFavorite(
  machine: MachineConnectionTarget,
  key: string,
  favorite: boolean,
): Promise<boolean> {
  const result = await runGhostexCli(machine, toggleAgentPromptFavoriteCommand(key, favorite), {
    timeoutMs: FIND_ACTION_TIMEOUT_MS,
  });
  const answered = record(result.json).favorite;
  return typeof answered === 'boolean' ? answered : favorite;
}

/**
 * What opening a prompt means. gxserver applies the same Accept All setting
 * `gx f` reads, so the phone never passes its own.
 */
export async function resolveFindPromptLaunch(
  machine: MachineConnectionTarget,
  key: string,
  action: 'fork' | 'resume',
  forkAgent?: FindPromptAgent,
): Promise<FindPromptLaunchResult> {
  const result = await runGhostexCli(machine, resolveAgentPromptLaunchCommand(key, action, forkAgent), {
    timeoutMs: FIND_ACTION_TIMEOUT_MS,
  });
  const plan = record(result.json);
  if (plan.mode === 'focus') {
    const projectId = str(plan.projectId);
    const sessionId = str(plan.sessionId);
    if (projectId.length === 0 || sessionId.length === 0) {
      throw new Error('That session is missing its project or session id.');
    }
    return { mode: 'focus', projectId, sessionId };
  }
  const commandLine = str(plan.commandLine);
  const cwd = str(plan.cwd);
  if (plan.mode !== 'launch' || commandLine.length === 0 || cwd.length === 0) {
    throw new Error('That prompt did not resolve to a runnable command.');
  }
  return {
    mode: 'launch',
    agent: str(plan.agent),
    commandLine,
    cwd,
    cwdExists: plan.cwdExists === true,
    title: str(plan.title),
  };
}
