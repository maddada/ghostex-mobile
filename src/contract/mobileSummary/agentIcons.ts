/**
 * The agent icon registry (spec §2).
 * Part of the mobile summary contract (`./index.ts`).
 */

import type { GhostexAgentLauncher } from './model';
import type { GhostexSession } from './session';

// ---------------------------------------------------------------------------
// Agent icon registry (spec §2).
// ---------------------------------------------------------------------------

export type AgentIconId =
  | 'amp-cli'
  | 'antigravity-cli'
  | 'browser'
  | 'claude'
  | 'codebuddy'
  | 'cursor-cli'
  | 'codex'
  | 'copilot'
  | 'dsh'
  | 'empryo'
  | 'factory-droid'
  | 'freebuff'
  | 'gemini'
  | 'grok-build'
  | 'hermes-agent'
  | 'kiro'
  | 'omp'
  | 'openclaude'
  | 'opencode'
  | 'pi'
  | 'qoder'
  | 'rovo-dev'
  | 'zcode'
  | 'terminal';

/** Brand tints mirror the desktop sidebar's AGENT_LOGO_COLORS map. */
const AGENT_ICON_TINTS: Record<AgentIconId, string> = {
  'amp-cli': '#FFFFFF',
  'antigravity-cli': '#749BFF',
  browser: '#82B7FF',
  claude: '#D97757',
  codebuddy: '#72D6FF',
  'cursor-cli': '#EDECEC',
  codex: '#FFFFFF',
  copilot: '#FFFFFF',
  dsh: '#4D6BFE',
  empryo: '#1FA31D',
  'factory-droid': '#FF7A1A',
  freebuff: '#FFFFFF',
  gemini: '#8B9AFF',
  'grok-build': '#FFFFFF',
  'hermes-agent': '#F3C46B',
  kiro: '#A6E3FF',
  omp: '#C8FF62',
  openclaude: '#f0a68a',
  opencode: '#6D96C0',
  pi: '#C8FF62',
  qoder: '#A991FF',
  'rovo-dev': '#4FC3A1',
  zcode: '#FFFFFF',
  terminal: '#FAFAFA',
};

/** Lowercased name/icon aliases → icon id (spec §2), shared by session rows and Live Activity content. */
export const AGENT_NAME_ALIASES: Readonly<Record<string, AgentIconId>> = {
  codex: 'codex',
  'codex cli': 'codex',
  claude: 'claude',
  'claude code': 'claude',
  // The "Claude (cloud)" agent behaves as Claude here (chat support, key bar, launches); only its
  // artwork differs (`resolveAgentArtId`).
  'claude-cloud': 'claude',
  'claude (cloud)': 'claude',
  openclaude: 'openclaude',
  'open claude': 'openclaude',
  cursor: 'cursor-cli',
  'cursor cli': 'cursor-cli',
  'cursor agent': 'cursor-cli',
  'cursor-agent': 'cursor-cli',
  pi: 'pi',
  'pi agent': 'pi',
  π: 'pi',
  opencode: 'opencode',
  'open code': 'opencode',
  gemini: 'gemini',
  copilot: 'copilot',
  'github copilot': 'copilot',
  droid: 'factory-droid',
  'factory droid': 'factory-droid',
  grok: 'grok-build',
  'grok build': 'grok-build',
  antigravity: 'antigravity-cli',
  'antigravity cli': 'antigravity-cli',
  agy: 'antigravity-cli',
  amp: 'amp-cli',
  'amp cli': 'amp-cli',
  hermes: 'hermes-agent',
  'hermes agent': 'hermes-agent',
  codebuddy: 'codebuddy',
  'code buddy': 'codebuddy',
  kiro: 'kiro',
  omp: 'omp',
  'oh my pi': 'omp',
  qoder: 'qoder',
  rovo: 'rovo-dev',
  'rovo dev': 'rovo-dev',
  'rovo-dev': 'rovo-dev',
  zcode: 'zcode',
  'zcode-cli': 'zcode',
  'z code': 'zcode',
  freebuff: 'freebuff',
  dsh: 'dsh',
  'dsh-tui': 'dsh',
  deepseek: 'dsh',
  'deepseek harness': 'dsh',
  browser: 'browser',
};

function isKnownAgentIconId(value: string): value is AgentIconId {
  return Object.prototype.hasOwnProperty.call(AGENT_ICON_TINTS, value);
}

/**
 * Resolve the agent icon id. The explicit `agentIcon` field wins over the
 * `agent`/`agentName` name; unknown values fall back to 'terminal'.
 */
export function resolveAgentIconId(agentIcon?: string, agentName?: string): AgentIconId {
  const icon = (agentIcon ?? '').trim().toLowerCase();
  if (icon.length > 0) {
    if (isKnownAgentIconId(icon)) return icon;
    const aliased = AGENT_NAME_ALIASES[icon];
    if (aliased !== undefined) return aliased;
  }
  const name = (agentName ?? '').trim().toLowerCase();
  if (name.length > 0) {
    const aliased = AGENT_NAME_ALIASES[name];
    if (aliased !== undefined) return aliased;
    if (isKnownAgentIconId(name)) return name;
  }
  return 'terminal';
}

/** A custom agent's generated id (`custom-<slug>-<suffix>`), which no row or notification may show as a name. */
export function isCustomAgentId(value: string): boolean {
  return value.trim().toLowerCase().startsWith('custom-');
}

/** The built-in agents' names by icon (gxserver `DEFAULT_SIDEBAR_AGENTS`), for a session whose computer names none. */
const AGENT_ICON_NAMES: Partial<Record<AgentIconId, string>> = {
  'amp-cli': 'Amp CLI',
  'antigravity-cli': 'Antigravity CLI',
  claude: 'Claude',
  codebuddy: 'CodeBuddy',
  'cursor-cli': 'Cursor CLI',
  codex: 'Codex',
  copilot: 'Copilot',
  dsh: 'DeepSeek Harness',
  empryo: 'Empryo',
  'factory-droid': 'Factory Droid',
  freebuff: 'Freebuff',
  gemini: 'Gemini',
  'grok-build': 'Grok Build',
  'hermes-agent': 'Hermes Agent',
  kiro: 'Kiro CLI',
  omp: 'OMP',
  openclaude: 'OpenClaude',
  opencode: 'OpenCode',
  pi: 'Pi Agent',
  qoder: 'Qoder',
  'rovo-dev': 'Rovo Dev',
  zcode: 'ZCode',
};

/**
 * The name a row or notification shows for a session's agent: its launcher's name (Settings > Agents), else the
 * session's own agent name or id; '' for a session without an agent (a plain terminal).
 *
 * CDXC:AgentProviders 2026-11-08 FIX: User, on the bell's row titled "custom-claude-70-dl0rpxbt39e0-…": "Name of
 * coordinator here looks wrong please fix". A custom agent removed from Settings > Agents left its sessions with only
 * its `custom-…` id, and every fallback printed it. A raw custom id is never a name: such a session is named by its
 * base agent, the one its icon declares ("Claude"), from the launcher list when given, else from the built-in names.
 * Computers after 11.1.0 send that name themselves (custom_agent_display_name in server/src/presentation/util.rs);
 * this keeps older ones from showing the id.
 */
export function sessionAgentName(
  session: Pick<GhostexSession, 'agent' | 'agentName' | 'agentIcon'>,
  agents: readonly GhostexAgentLauncher[] = [],
): string {
  const launcher = agents.find((agent) => agent.agentId === session.agent);
  const named = [launcher?.name, session.agentName, session.agent]
    .map((name) => (name ?? '').trim())
    .find((name) => name.length > 0 && !isCustomAgentId(name));
  if (named !== undefined) return named;
  if (session.agent.trim().length === 0 && session.agentName.trim().length === 0) return '';
  const icon = resolveAgentIconId(session.agentIcon, undefined);
  const base = agents.find(
    (agent) => !isCustomAgentId(agent.agentId) && resolveAgentIconId(agent.icon, agent.agentId) === icon,
  );
  return base?.name?.trim() || AGENT_ICON_NAMES[icon] || 'Agent';
}

/**
 * The artwork a row, menu or dialog draws for an agent: its icon id, except the Claude (cloud)
 * agent, which resolves to Claude for behaviour but draws an orange cloud.
 *
 * CDXC:ClaudeCloud 2026-10-29 DECISION:
 * User: "please change the icon for claude cloud to an orange cloud icon instead (same color as claude #D67556". The desktop draws it from gx-core `sidebar_menu/agent_logos.rs`; the phone matches with `IconClaudeCloud` in #D67556.
 */
export type AgentArtId = AgentIconId | 'claude-cloud';

export function resolveAgentArtId(agentIcon?: string, agentName?: string): AgentArtId {
  const icon = (agentIcon ?? '').trim().toLowerCase();
  const name = (agentName ?? '').trim().toLowerCase();
  if (icon === 'claude-cloud' || (icon.length === 0 && (name === 'claude-cloud' || name === 'claude (cloud)'))) {
    return 'claude-cloud';
  }
  return resolveAgentIconId(agentIcon, agentName);
}

export function agentIconTint(iconId: AgentArtId): string {
  return iconId === 'claude-cloud' ? '#D67556' : AGENT_ICON_TINTS[iconId];
}
