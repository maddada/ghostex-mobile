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

/**
 * Positional CLI arguments are parsed by the Rust CLI before gxserver ever
 * sees them, and anything starting with `-` is read as a flag there. Reject
 * those at the command boundary instead of shipping a value that would be
 * silently reinterpreted.
 */
function requirePositional(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error(`Ghostex ${label} is required.`);
  if (trimmed.startsWith('-')) throw new Error(`Ghostex ${label} must not start with "-".`);
  return trimmed;
}

function positiveIntegerFlag(name: string, value: number | undefined, label: string): string {
  if (value === undefined) return '';
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Ghostex ${label} must be a positive whole number of milliseconds.`);
  }
  return ` ${name} ${value}`;
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

/**
 * Agent-aware rename: `ghostex request-session-rename --session-id <id>
 * --project-id <id> --title=<title> [--agent-name=<agent>] --json`.
 *
 * Unlike `rename-session` (a plain title write), this goes through gxserver's
 * rename request, which answers `shouldSendAgentRenameCommand` when the agent
 * CLI owns the title and the client still has to stage `/rename <title>` into
 * its TUI — the same two-step the desktop and web chat surfaces perform.
 */
export function requestSessionRenameCommand(
  sessionId: string,
  projectId: string,
  title: string,
  agentName?: string,
): string {
  const agent = agentName === undefined ? '' : agentName.trim();
  return (
    `ghostex request-session-rename --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}` +
    ` --title=${shellQuote(title)}` +
    `${agent.length === 0 ? '' : ` --agent-name=${shellQuote(agent)}`} --json`
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

export type DelayedSendTrigger = 'afterDelay' | 'agentStops' | 'allAgentsStop';

/**
 * Arms one of the gxserver renderer's Session Automations Enter triggers.
 */
export function delayedSendCommand(
  sessionId: string,
  trigger: DelayedSendTrigger,
  delayMs?: number,
): string {
  const selector =
    `ghostex delayed-send --session-id ${shellQuote(requireId(sessionId, 'session id'))}`;
  if (trigger === 'agentStops') {
    return `${selector} --when-agent-finishes --json`;
  }
  if (trigger === 'allAgentsStop') {
    return `${selector} --when-all-agents-finish --json`;
  }
  if (!Number.isFinite(delayMs) || !Number.isInteger(delayMs) || (delayMs ?? 0) <= 0) {
    throw new Error('Ghostex Delayed Send delay must be a positive whole number of milliseconds.');
  }
  return `${selector} --delay-ms ${delayMs} --json`;
}

/** Cancel Delayed Send: `ghostex delayed-send --session-id <id> --cancel --json`. */
export function cancelDelayedSendCommand(sessionId: string): string {
  return (
    `ghostex delayed-send --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ' --cancel --json'
  );
}

/** Toggle Close After Done: `ghostex close-after-done --session-id <id> --json`. */
export function closeAfterDoneCommand(sessionId: string): string {
  return (
    `ghostex close-after-done --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ' --json'
  );
}

/** Close project: `ghostex remove-project --project-id <id> --json`. */
export function removeProjectCommand(projectId: string): string {
  return `ghostex remove-project --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`;
}

/**
 * Add project: `ghostex add-project <path> [--create-if-missing] --json`.
 * `--create-if-missing` is what lets the Add Project flow register a folder the
 * user typed but has not created yet; without it gxserver keeps rejecting a
 * missing path.
 */
export function addProjectCommand(path: string, options?: { createIfMissing?: boolean }): string {
  const createIfMissing = options?.createIfMissing === true ? ' --create-if-missing' : '';
  return `ghostex add-project ${shellQuote(requirePositional(path, 'project path'))}${createIfMissing} --json`;
}

/**
 * Directory suggestions for an Add Project path input:
 * `ghostex browse-directories <partialPath> [--limit n] --json`.
 * `--cwd` is never sent: mobile has no active project, so relative paths are
 * not offered at all.
 */
export function browseDirectoriesCommand(
  partialPath: string,
  options?: { limit?: number },
): string {
  const limit = options?.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error('Ghostex browse limit must be a positive whole number.');
  }
  const limitFlag = limit === undefined ? '' : ` --limit ${limit}`;
  return (
    `ghostex browse-directories ${shellQuote(requirePositional(partialPath, 'browse path'))}` +
    `${limitFlag} --json`
  );
}

/**
 * Hosting-CLI readiness for the source picker:
 * `ghostex discover-source-control [--timeout ms] --json`.
 * `--timeout` raises the CLI's own gxserver HTTP timeout (15s by default),
 * which is shorter than the worst case of four 5s provider probes.
 */
export function discoverSourceControlCommand(options?: { timeoutMs?: number }): string {
  const timeout = positiveIntegerFlag('--timeout', options?.timeoutMs, 'discovery timeout');
  return `ghostex discover-source-control${timeout} --json`;
}

export type SourceControlLookupProvider = 'github' | 'gitlab';

/** Repository lookup: `ghostex lookup-repository <provider> <owner/repo> --json`. */
export function lookupRepositoryCommand(
  provider: SourceControlLookupProvider,
  repository: string,
  options?: { timeoutMs?: number },
): string {
  if (provider !== 'github' && provider !== 'gitlab') {
    throw new Error(`Unsupported Ghostex repository provider: ${provider as string}`);
  }
  const timeout = positiveIntegerFlag('--timeout', options?.timeoutMs, 'lookup timeout');
  return (
    `ghostex lookup-repository ${shellQuote(provider)}` +
    ` ${shellQuote(requirePositional(repository, 'repository'))}${timeout} --json`
  );
}

/**
 * Clone + register: `ghostex clone-repository <remoteUrl> <destinationPath>
 * [--wait-timeout-ms n] [--timeout ms] --json`. The CLI blocks until the
 * daemon's clone job leaves `running`; a wait timeout never cancels the clone.
 */
export function cloneRepositoryCommand(
  remoteUrl: string,
  destinationPath: string,
  options?: { waitTimeoutMs?: number; timeoutMs?: number },
): string {
  const waitTimeout = positiveIntegerFlag(
    '--wait-timeout-ms',
    options?.waitTimeoutMs,
    'clone wait timeout',
  );
  const timeout = positiveIntegerFlag('--timeout', options?.timeoutMs, 'clone request timeout');
  return (
    `ghostex clone-repository ${shellQuote(requirePositional(remoteUrl, 'repository URL'))}` +
    ` ${shellQuote(requirePositional(destinationPath, 'destination path'))}` +
    `${waitTimeout}${timeout} --json`
  );
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

// ---------------------------------------------------------------------------
// Session Chat (chat view of an agent session over SSH; the daemon owns all
// transcript decoding — these verbs are thin wrappers over its chat endpoints).
// ---------------------------------------------------------------------------

/** Extra CLI HTTP-timeout margin on top of a read's long-poll wait. */
const SESSION_CHAT_WAIT_TIMEOUT_MARGIN_MS = 15000;

export type SessionChatReadOptions = {
  limit?: number;
  beforeOffset?: number;
  /** Long-poll: hold until the chat changes or this many ms pass. */
  waitMs?: number;
  /** The fingerprint from the previous read result (required for waitMs). */
  fingerprint?: string;
};

function sessionChatSelector(sessionId: string, projectId: string): string {
  return (
    `--session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}`
  );
}

/**
 * Read: `ghostex read-session-chat --session-id <id> --project-id <id>
 * [--limit n] [--before-offset n] [--wait-ms n --fingerprint f] --json`.
 * A waiting read raises `--timeout` above the wait so the CLI's own gxserver
 * HTTP timeout (15s default) cannot cut the long-poll short.
 */
export function readSessionChatCommand(
  sessionId: string,
  projectId: string,
  options?: SessionChatReadOptions,
): string {
  const parts = [`ghostex read-session-chat ${sessionChatSelector(sessionId, projectId)}`];
  parts.push(positiveIntegerFlag('--limit', options?.limit, 'chat read limit').trim());
  const beforeOffset = options?.beforeOffset;
  if (beforeOffset !== undefined) {
    if (!Number.isInteger(beforeOffset) || beforeOffset < 0) {
      throw new Error('Ghostex chat read beforeOffset must be a non-negative whole number.');
    }
    parts.push(`--before-offset ${beforeOffset}`);
  }
  const waitMs = options?.waitMs;
  const fingerprint = options?.fingerprint?.trim() ?? '';
  if (waitMs !== undefined && fingerprint.length > 0) {
    parts.push(positiveIntegerFlag('--wait-ms', waitMs, 'chat read wait').trim());
    parts.push(`--fingerprint ${shellQuote(fingerprint)}`);
    parts.push(`--timeout ${waitMs + SESSION_CHAT_WAIT_TIMEOUT_MARGIN_MS}`);
  }
  parts.push('--json');
  return parts.filter((part) => part.length > 0).join(' ');
}

/** List skills resolved by gxserver for the session's stored agent identity. */
export function readSessionChatSkillsCommand(sessionId: string, projectId: string): string {
  return `ghostex read-session-chat-skills ${sessionChatSelector(sessionId, projectId)} --json`;
}

/** List the session project's files for the composer's "@" mentions. */
export function readSessionChatFilesCommand(sessionId: string, projectId: string): string {
  return `ghostex read-session-chat-files ${sessionChatSelector(sessionId, projectId)} --json`;
}

/** Send: `ghostex send-session-chat-message --session-id <id> --project-id <id> --text <text> --json`. */
export function sendSessionChatMessageCommand(
  sessionId: string,
  projectId: string,
  text: string,
): string {
  return (
    `ghostex send-session-chat-message ${sessionChatSelector(sessionId, projectId)}` +
    ` --text ${shellQuote(text)} --json`
  );
}

/**
 * Answer a question/approval prompt:
 * `ghostex answer-session-chat-prompt --session-id <id> --project-id <id>
 * --answer-json '<json>' --json`. The answer object carries kind plus
 * selections or approvalSend, exactly as the shared transport produced it.
 */
export function answerSessionChatPromptCommand(
  sessionId: string,
  projectId: string,
  answer: unknown,
): string {
  return (
    `ghostex answer-session-chat-prompt ${sessionChatSelector(sessionId, projectId)}` +
    ` --answer-json ${shellQuote(JSON.stringify(answer))} --json`
  );
}

/** Interrupt the running turn: `ghostex interrupt-session-chat --session-id <id> --project-id <id> --json`. */
export function interruptSessionChatCommand(sessionId: string, projectId: string): string {
  return `ghostex interrupt-session-chat ${sessionChatSelector(sessionId, projectId)} --json`;
}
