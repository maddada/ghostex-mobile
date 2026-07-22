/**
 * Ghostex CLI command builders. Mirrors the Android reference implementation
 * (GhostexSshCommandBuilder) and docs/specs/sessions-drawer.md §§3,5,6:
 * single-quote shell quoting with `'"'"'` escaping and a `"$SHELL" -lc`
 * login-shell wrapper so remote commands see the user's PATH.
 */

/** Single-quote `value` for POSIX shells, escaping embedded quotes as `'"'"'`. */
export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/** Wrap a remote command in the account's configured login shell. */
export function loginShellCommand(remoteCommand: string): string {
  return `"$SHELL" -lc ${shellQuote(remoteCommand)}`;
}

function requireId(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`Ghostex ${label} is required.`);
  return trimmed;
}

function projectFlag(projectId?: string): string {
  const trimmed = projectId === undefined ? '' : projectId.trim();
  return trimmed.length === 0 ? '' : ` --project-id ${shellQuote(trimmed)}`;
}

/** Inventory list: `ghostex sessions --json --mobile-summary`. */
export function sessionsListCommand(): string {
  return 'ghostex sessions --json --mobile-summary';
}

/** Attach: `ghostex attach --session-id <id> [--project-id <id>]`. */
export function attachCommand(sessionId: string, projectId?: string): string {
  return `ghostex attach --session-id ${shellQuote(requireId(sessionId, 'session id'))}${projectFlag(projectId)}`;
}

export type SessionAction = 'focus' | 'wake' | 'sleep' | 'kill' | 'acknowledge-session-attention';

/**
 * Lifecycle/focus actions: `ghostex <action> --session-id <id> [--project-id <id>] --json`.
 * Validated at the command boundary so UI changes can never send arbitrary
 * remote commands.
 */
export function sessionActionCommand(
  action: SessionAction,
  sessionId: string,
  projectId?: string,
): string {
  const supported: readonly SessionAction[] = [
    'focus',
    'wake',
    'sleep',
    'kill',
    'acknowledge-session-attention',
  ];
  if (!supported.includes(action)) {
    throw new Error(`Unsupported Ghostex session action: ${action as string}`);
  }
  return `ghostex ${action} --session-id ${shellQuote(requireId(sessionId, 'session id'))}${projectFlag(projectId)} --json`;
}

export function focusSessionCommand(sessionId: string, projectId?: string): string {
  return sessionActionCommand('focus', sessionId, projectId);
}

export function wakeSessionCommand(sessionId: string, projectId?: string): string {
  return sessionActionCommand('wake', sessionId, projectId);
}

export function sleepSessionCommand(sessionId: string, projectId?: string): string {
  return sessionActionCommand('sleep', sessionId, projectId);
}

export function killSessionCommand(sessionId: string, projectId?: string): string {
  return sessionActionCommand('kill', sessionId, projectId);
}

/** Rename: `ghostex rename-session --session-id <id> [--project-id <id>] --title=<title> --json`. */
export function renameSessionCommand(sessionId: string, title: string, projectId?: string): string {
  return (
    `ghostex rename-session --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    `${projectFlag(projectId)} --title=${shellQuote(title)} --json`
  );
}

/** Create terminal session: `ghostex create-session --json [--project-id <id>] [--group-id <id>]`. */
export function createSessionCommand(options?: { projectId?: string; groupId?: string }): string {
  const parts = ['ghostex create-session --json'];
  const projectId = options?.projectId?.trim() ?? '';
  const groupId = options?.groupId?.trim() ?? '';
  if (projectId.length > 0) parts.push(`--project-id ${shellQuote(projectId)}`);
  if (groupId.length > 0) parts.push(`--group-id ${shellQuote(groupId)}`);
  return parts.join(' ');
}

/** Quick chat workspace + first terminal: `ghostex create-chat --json`. */
export function createChatCommand(): string {
  return 'ghostex create-chat --json';
}

/** Agent launch: `ghostex create-agent <agentId> --project-id <id> --json`. */
export function createAgentCommand(agentId: string, projectId: string): string {
  return (
    `ghostex create-agent ${shellQuote(requireId(agentId, 'agent id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`
  );
}

/** Quick action: `ghostex run-action <commandId> --project-id <id>` (always prints JSON). */
export function runActionCommand(commandId: string, projectId: string): string {
  return (
    `ghostex run-action ${shellQuote(requireId(commandId, 'quick action command id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}`
  );
}

/** Pin/unpin: `ghostex pin-session --session-id <id> --pinned <bool> --json`. */
export function pinSessionCommand(sessionId: string, pinned: boolean): string {
  return (
    `ghostex pin-session --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --pinned ${pinned ? 'true' : 'false'} --json`
  );
}

/** Tag: `ghostex tag-session --session-id <id> --tag <tag|none> --json`. */
export function tagSessionCommand(sessionId: string, tag: string): string {
  const value = tag.trim().length === 0 ? 'none' : tag.trim();
  return (
    `ghostex tag-session --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --tag ${shellQuote(value)} --json`
  );
}

/** Full reload: `ghostex reload-session --session-id <id> --json`. */
export function reloadSessionCommand(sessionId: string): string {
  return `ghostex reload-session --session-id ${shellQuote(requireId(sessionId, 'session id'))} --json`;
}

/** Restart: `ghostex restart-session --session-id <id> --json`. */
export function restartSessionCommand(sessionId: string): string {
  return `ghostex restart-session --session-id ${shellQuote(requireId(sessionId, 'session id'))} --json`;
}

/** Fork: `ghostex fork-session --session-id <id> --json` (daemon-side fork). */
export function forkSessionCommand(sessionId: string): string {
  return `ghostex fork-session --session-id ${shellQuote(requireId(sessionId, 'session id'))} --json`;
}

/** Acknowledge attention: `ghostex acknowledge-session-attention --session-id <id> --json`. */
export function acknowledgeAttentionCommand(sessionId: string): string {
  return (
    `ghostex acknowledge-session-attention --session-id` +
    ` ${shellQuote(requireId(sessionId, 'session id'))} --json`
  );
}

/** Close project: `ghostex remove-project --project-id <id> --json`. */
export function removeProjectCommand(projectId: string): string {
  return `ghostex remove-project --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`;
}

/** Add project: `ghostex add-project <path> --json`. */
export function addProjectCommand(path: string): string {
  return `ghostex add-project ${shellQuote(requireId(path, 'project path'))} --json`;
}

/**
 * Durable sidebar project collections write-back:
 * `ghostex update-sidebar-project-collections --state-json '<json>' --json`.
 * The CLI passes the FULL state through; gxserver normalizes and persists.
 */
export function updateProjectCollectionsCommand(state: unknown): string {
  return (
    'ghostex update-sidebar-project-collections --state-json ' +
    `${shellQuote(JSON.stringify(state))} --json`
  );
}

/** Reorder: `ghostex move-project --json --project-id <id> --direction <up|down>`. */
export function moveProjectCommand(projectId: string, direction: 'up' | 'down'): string {
  if (direction !== 'up' && direction !== 'down') {
    throw new Error(`Unsupported Ghostex project move direction: ${direction as string}`);
  }
  return (
    `ghostex move-project --json --project-id ${shellQuote(requireId(projectId, 'project id'))}` +
    ` --direction ${shellQuote(direction)}`
  );
}

/** Restore parked project: `ghostex restore-recent-project --project-id <id> --json`. */
export function restoreRecentProjectCommand(projectId: string): string {
  return `ghostex restore-recent-project --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`;
}

/** Machine health: `ghostex android-check --json` (works for any mobile client). */
export function androidCheckCommand(): string {
  return 'ghostex android-check --json';
}
