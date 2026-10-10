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

/**
 * CDXC:Cli 2026-09-30 WHY:
 * The desktop app writes the `ghostex` wrapper into /opt/homebrew/bin, /usr/local/bin or ~/.local/bin (the Homebrew cask links it into its own bin), but a non-interactive SSH login shell on macOS often has neither Homebrew's bin nor ~/.local/bin on PATH, so every phone command failed with "ghostex: command not found" (GitHub PR #181). Those folders are appended after the user's own PATH, so a `ghostex` the user put earlier still wins; the desktop's installer is left alone because moving the public wrapper would break the terminal command instead.
 * SEE-ALSO: `gpui_common_cli_install_dirs` in apps/desktop/src/app/helpers/os_cli/cli_install.rs, the folders the desktop installs into.
 */
const GHOSTEX_CLI_PATH_FALLBACK = '$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin';

/** Wrap a remote command in the account's configured login shell. */
export function loginShellCommand(remoteCommand: string): string {
  return `"$SHELL" -lc ${shellQuote(`export PATH="$PATH:${GHOSTEX_CLI_PATH_FALLBACK}"; ${remoteCommand}`)}`;
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

/**
 * Quick terminal in a folder, optionally running a command:
 * `ghostex terminal --cwd <dir> [--title <t>] -- <command...>`.
 *
 * The daemon registers (or reuses) the project at that folder itself, which is
 * what lets Find open a resumed agent in a folder the phone has never seen.
 */
export function quickTerminalCommand(
  cwd: string,
  options?: { command?: string; title?: string },
): string {
  const folder = cwd.trim();
  if (folder.length === 0) throw new Error('Ghostex quick terminal folder is required.');
  const parts = ['ghostex terminal --json', `--cwd ${shellQuote(folder)}`];
  const title = options?.title?.trim() ?? '';
  if (title.length > 0) parts.push(`--title ${shellQuote(title)}`);
  const command = options?.command?.trim() ?? '';
  if (command.length > 0) parts.push(`-- ${command}`);
  return parts.join(' ');
}

/** Quick chat workspace + first terminal: `ghostex create-chat --json`. */
export function createChatCommand(): string {
  return 'ghostex create-chat --json';
}

/**
 * Agent launch: `ghostex create-agent <agentId> --project-id <id> --json`.
 *
 * `firstInputDraft` stages text in the new session's CLI input once the
 * provider starts and never submits it, so the value is passed verbatim —
 * including a trailing space, which separates a staged handoff link from
 * whatever the user types next.
 *
 * `replaceEmptySessions` marks the user's own new-session action: gxserver then
 * closes the project's other sessions that are still fully empty. An older
 * `ghostex` ignores the flag.
 */
export function createAgentCommand(
  agentId: string,
  projectId: string,
  firstInputDraft?: string,
  deferStart = false,
  replaceEmptySessions = false,
): string {
  const draft = firstInputDraft ?? '';
  return (
    `ghostex create-agent ${shellQuote(requireId(agentId, 'agent id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}` +
    (draft.trim().length === 0 ? '' : ` --first-input-draft ${shellQuote(draft)}`) +
    (deferStart ? ' --defer-start' : '') +
    (replaceEmptySessions ? ' --replace-empty-sessions' : '') +
    ' --json'
  );
}

/** The New Coordinator form's choices: agents, their model lineups and the defaults `create` applies. */
export function coordinatorOptionsCommand(): string {
  return 'ghostex coordinator options --json';
}

export type CreateCoordinatorInput = {
  projectId: string;
  agentId: string;
  /** '' leaves the coordinator unnamed: gxserver saves the placeholder "Coordinator". */
  title: string;
  goal: string;
  /** The first request, queued for the coordinator once it starts. */
  task: string;
  model: string;
  effort: string;
};

/**
 * `ghostex coordinator create`: the same verb (and so the same title, model and effort rules)
 * the desktop's New Coordinator dialog follows. Empty fields are left out.
 */
export function createCoordinatorCommand(input: CreateCoordinatorInput): string {
  // `--flag=value`, so a goal or request that starts with "-" is never read as a flag.
  const optional = (flag: string, value: string): string =>
    value.trim().length === 0 ? '' : ` ${flag}=${shellQuote(value.trim())}`;
  return (
    'ghostex coordinator create' +
    ` --project-id ${shellQuote(requireId(input.projectId, 'project id'))}` +
    ` --agent ${shellQuote(requireId(input.agentId, 'agent id'))}` +
    optional('--title', input.title) +
    optional('--goal', input.goal) +
    optional('--task', input.task) +
    optional('--model', input.model) +
    optional('--effort', input.effort) +
    ' --json'
  );
}

/**
 * `ghostex coordinator promote`: makes an existing Claude, Codex, ZCode or Empryo session a coordinator without
 * restarting or interrupting it (the desktop's Advanced > Make Coordinator).
 */
export function promoteCoordinatorCommand(globalRef: string): string {
  return `ghostex coordinator promote ${shellQuote(requireId(globalRef, 'session reference'))} --json`;
}

/** Quick action: `ghostex run-action <commandId> --project-id <id>` (always prints JSON). */
export function runActionCommand(commandId: string, projectId: string): string {
  return (
    `ghostex run-action ${shellQuote(requireId(commandId, 'quick action command id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}`
  );
}

/** Park or unpark through the computer's session lifecycle. */
export function parkSessionCommand(sessionId: string, projectId: string, parked: boolean): string {
  return `ghostex park-session ${sessionChatSelector(sessionId, projectId)} --parked ${parked ? 'true' : 'false'} --json`;
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

/*
 * Session note ("what to do next in this thread"). gxserver keys the note by
 * the session's agent conversation id, not by the ghostex session id, so the
 * phone only ever names the session and lets the daemon resolve the identity —
 * a note written here is the same note the desktop sidebar shows.
 *
 * `read` / `save` are always sent as explicit subactions. Without one the CLI
 * decides from the presence of `--note`, and a note that legitimately starts
 * with `--` must never be able to change which endpoint runs.
 */

/** Read: `ghostex session-note read --session-id <id> --project-id <id> --json`. */
export function sessionNoteReadCommand(sessionId: string, projectId: string): string {
  return (
    `ghostex session-note read --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`
  );
}

/**
 * Save: `ghostex session-note save --session-id <id> --project-id <id>
 * --note=<text> --json`. An EMPTY note clears it, so it is valid input and must
 * not be filtered out. The note rides `inlineTextFlag`'s `=` form for the
 * reason documented there: user prose can open with `--`, and multi-line notes
 * are carried verbatim by the single-quoted shell wrapper.
 */
export function sessionNoteSaveCommand(
  sessionId: string,
  projectId: string,
  note: string,
): string {
  return (
    `ghostex session-note save --session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}` +
    ` ${inlineTextFlag('--note', note)} --json`
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

/**
 * Keep-awake lease: `ghostex hold-sessions-awake --sessions-json <json>
 * --ttl-ms <n> --holder-id <id> [--release] --json`.
 *
 * The machine's Auto Sleep sweep ("Sleep inactive agents") runs in whichever
 * Ghostex client owns that machine's sidebar, and that client cannot see that
 * this phone is attached to a session. The lease is how the phone tells the
 * daemon, so an automatic sleep is declined for as long as the tab is on
 * screen. One call carries every attached session on the machine.
 */
export function holdSessionsAwakeCommand(
  sessions: readonly { projectId: string; sessionId: string }[],
  options: { holderId: string; ttlMs?: number; release?: boolean },
): string {
  if (sessions.length === 0) throw new Error('Ghostex keep-awake requires at least one session.');
  const payload = sessions.map((session) => ({
    projectId: requireId(session.projectId, 'project id'),
    sessionId: requireId(session.sessionId, 'session id'),
  }));
  return (
    `ghostex hold-sessions-awake --sessions-json ${shellQuote(JSON.stringify(payload))}` +
    ` --holder-id ${shellQuote(requireId(options.holderId, 'keep-awake holder id'))}` +
    positiveIntegerFlag('--ttl-ms', options.ttlMs, 'keep-awake TTL') +
    `${options.release === true ? ' --release' : ''} --json`
  );
}

/** The chat grid claim lease (`chatGridClaim.ts`), with the keep-awake verb's flags. */
export function holdSessionChatGridCommand(
  sessions: readonly { projectId: string; sessionId: string }[],
  options: { holderId: string; ttlMs?: number; release?: boolean },
): string {
  if (sessions.length === 0) throw new Error('Ghostex chat grid claim requires at least one session.');
  const payload = sessions.map((session) => ({
    projectId: requireId(session.projectId, 'project id'),
    sessionId: requireId(session.sessionId, 'session id'),
  }));
  return (
    `ghostex hold-session-chat-grid --sessions-json ${shellQuote(JSON.stringify(payload))}` +
    ` --holder-id ${shellQuote(requireId(options.holderId, 'chat grid holder id'))}` +
    positiveIntegerFlag('--ttl-ms', options.ttlMs, 'chat grid TTL') +
    `${options.release === true ? ' --release' : ''} --json`
  );
}

export type ClientHelloPlatform = {
  os: 'android' | 'ios';
  osVersion?: string;
  appVersion?: string;
};

/** A version token the daemon's analytics taxonomy accepts: `[0-9A-Za-z.-]{1,32}`. */
function versionFlag(name: string, value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length === 0 || trimmed.length > 32 || !/^[0-9A-Za-z.-]+$/.test(trimmed)) return '';
  return ` ${name} ${trimmed}`;
}

/**
 * Analytics hello: `ghostex client-hello --client mobile --os <android|ios>
 * [--os-version <v>] [--app-version <v>] --json`.
 *
 * The phone never talks to any analytics service itself. It tells the machine's
 * gxserver that a mobile client attached, on which OS and app version, and the
 * machine's own usage-analytics setting decides whether anything is recorded.
 * Nothing about the phone, the machine, or the session is carried beyond those
 * three enum/version tokens.
 */
export function clientHelloCommand(platform: ClientHelloPlatform): string {
  return (
    `ghostex client-hello --client mobile --os ${platform.os}` +
    versionFlag('--os-version', platform.osVersion) +
    versionFlag('--app-version', platform.appVersion) +
    ' --json'
  );
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

/** The things a session's work links name (`WorkLinkKind` in server/src/work_mode/candidates.rs). */
export type WorkLinkKind = 'pullRequest' | 'linearIssue' | 'linearProject' | 'githubIssue' | 'githubProject';

/**
 * A change to a session's work links, in the shape `/api/setSessionWorkLinks` takes (and the
 * desktop's Unlink rows send): `pullRequest: 'none'`, `linearIssues: []`, `githubIssues: []`,
 * `linearProject: ''` and `githubProject: 'none'` unlink a kind, `clear` hands every kind back to
 * the branch.
 */
export type SessionWorkLinks = {
  clear?: true;
  pullRequest?: string;
  linearIssues?: readonly string[];
  githubIssues?: readonly string[];
  linearProject?: string;
  /** `owner/number`, or 'none'. */
  githubProject?: string;
};

/** Link to picker suggestions: `ghostex link-session --session-id … --project-id … --candidates <kind> [--query q] --json`. */
export function workLinkCandidatesCommand(
  sessionId: string,
  projectId: string,
  kind: WorkLinkKind,
  query: string,
): string {
  const trimmed = query.trim();
  return (
    `ghostex link-session ${sessionChatSelector(sessionId, projectId)} --candidates ${kind}` +
    `${trimmed.length > 0 ? ` --query ${shellQuote(trimmed)}` : ''} --json`
  );
}

/** Link or unlink: `ghostex link-session … [--pr n|none] [--linear A,B|none] [--issue n|none] [--linear-project name|none] [--github-project owner/number|none] [--auto] --json`. */
export function setSessionWorkLinksCommand(
  sessionId: string,
  projectId: string,
  links: SessionWorkLinks,
): string {
  const list = (values: readonly string[]): string => shellQuote(values.length > 0 ? values.join(',') : 'none');
  const flags: string[] = [];
  if (links.clear === true) flags.push('--auto');
  if (links.pullRequest !== undefined) flags.push(`--pr ${shellQuote(links.pullRequest.trim() || 'none')}`);
  if (links.linearIssues !== undefined) flags.push(`--linear ${list(links.linearIssues)}`);
  if (links.githubIssues !== undefined) flags.push(`--issue ${list(links.githubIssues)}`);
  if (links.linearProject !== undefined) {
    flags.push(`--linear-project ${shellQuote(links.linearProject.trim() || 'none')}`);
  }
  if (links.githubProject !== undefined) {
    flags.push(`--github-project ${shellQuote(links.githubProject.trim() || 'none')}`);
  }
  if (flags.length === 0) throw new Error('There is no link to change.');
  return `ghostex link-session ${sessionChatSelector(sessionId, projectId)} ${flags.join(' ')} --json`;
}

/** The merged-PR offer's answer: `ghostex work-mode cleanup --session-id … --project-id … clean-up|keep --json`. */
export function answerWorkCleanupCommand(sessionId: string, projectId: string, answer: 'cleanUp' | 'keep'): string {
  return `ghostex work-mode cleanup ${sessionChatSelector(sessionId, projectId)} ${answer === 'cleanUp' ? 'clean-up' : 'keep'} --json`;
}

/** Work Mode: `ghostex work-mode on|off --project-id <id> --json`. */
export function setProjectWorkModeCommand(projectId: string, enabled: boolean): string {
  return `ghostex work-mode ${enabled ? 'on' : 'off'} --project-id ${shellQuote(requireId(projectId, 'project id'))} --json`;
}

/**
 * Add project: `ghostex add-project <path> [--create-if-missing] --json`.
 * `--create-if-missing` is what lets the Add Project flow register a folder the
 * user typed but has not created yet; without it gxserver keeps rejecting a
 * missing path.
 */
export function addProjectCommand(
  path: string,
  options?: { createIfMissing?: boolean; workspaceId?: string },
): string {
  const createIfMissing = options?.createIfMissing === true ? ' --create-if-missing' : '';
  return (
    `ghostex add-project ${shellQuote(requirePositional(path, 'project path'))}${createIfMissing}` +
    `${workspaceFlag(options?.workspaceId)} --json`
  );
}

/** `--workspace <id>` puts an added project in the workspace the phone shows; none = the default one. */
function workspaceFlag(workspaceId: string | undefined): string {
  return workspaceId === undefined ? '' : ` --workspace ${shellQuote(requireId(workspaceId, 'workspace id'))}`;
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
  options?: { waitTimeoutMs?: number; timeoutMs?: number; workspaceId?: string },
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
    `${waitTimeout}${timeout}${workspaceFlag(options?.workspaceId)} --json`
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

/**
 * Web preview port discovery: `ghostex ports --json`. Lists every listening TCP
 * socket on the machine, one entry per (port, address), sorted by port.
 */
export function portsListCommand(includeWebMetadata = false): string {
  return `ghostex ports --json${includeWebMetadata ? ' --web' : ''}`;
}

// ---------------------------------------------------------------------------
// Session Chat (chat view of an agent session over SSH; the daemon owns all
// transcript decoding — these verbs are thin wrappers over its chat endpoints).
// ---------------------------------------------------------------------------

function sessionChatSelector(sessionId: string, projectId: string): string {
  return (
    `--session-id ${shellQuote(requireId(sessionId, 'session id'))}` +
    ` --project-id ${shellQuote(requireId(projectId, 'project id'))}`
  );
}

function draftVersionFlag(version?: unknown): string {
  return version === undefined ? '' : ` --draft-version-json ${shellQuote(JSON.stringify(version))}`;
}

/** Send: `ghostex send-session-chat-message --session-id <id> --project-id <id> --text <text> --json`. */
export function sendSessionChatMessageCommand(
  sessionId: string,
  projectId: string,
  text: string,
  draftVersion?: unknown,
): string {
  return (
    `ghostex send-session-chat-message ${sessionChatSelector(sessionId, projectId)}` +
    ` --text ${shellQuote(text)}${draftVersionFlag(draftVersion)} --json`
  );
}

// ---------------------------------------------------------------------------
// Synced composer draft (plan 016), read and written by the Prompt Editor
// sheet. The chat screen itself reaches gxserver through the Rust chat core's
// `session-chat-rpc` transport (src/chat/rust/transport.ts).
// ---------------------------------------------------------------------------

/**
 * `--name=value` as ONE shell word.
 *
 * The Rust CLI keeps the old JS parser's shape: `--name <value>` reads as a
 * BOOLEAN flag whenever <value> itself starts with `--`, and the value is then
 * re-parsed as further flags. Every user-authored string here (a queued
 * prompt, a composer draft) can legitimately open with `--`, so it rides the
 * `=` form, which also carries the empty string that clears a draft.
 */
function inlineTextFlag(name: string, value: string): string {
  return `${name}=${shellQuote(value)}`;
}

/** The skills the session's agent has installed, Ghostex's marked: `ghostex read-session-chat-skills …`. */
export function readSessionChatSkillsCommand(sessionId: string, projectId: string): string {
  return `ghostex read-session-chat-skills ${sessionChatSelector(sessionId, projectId)} --json`;
}

/** Read the queue and the synced draft: `ghostex read-session-chat-queue …`. */
export function readSessionChatQueueCommand(sessionId: string, projectId: string): string {
  return `ghostex read-session-chat-queue ${sessionChatSelector(sessionId, projectId)} --json`;
}

/**
 * Publish the unsent composer draft for every other client of this session.
 * An EMPTY `content` is how a draft is cleared, so it is valid input; the
 * `clientId` comes back as the draft's `originClientId` so the writer can
 * ignore its own echo.
 */
export function setSessionChatDraftCommand(
  sessionId: string,
  projectId: string,
  content: string,
  clientId: string,
  draftVersion?: unknown,
): string {
  const trimmedClientId = clientId.trim();
  if (trimmedClientId.length === 0) {
    throw new Error('Ghostex chat draft client id is required.');
  }
  return (
    `ghostex set-session-chat-draft ${sessionChatSelector(sessionId, projectId)}` +
    ` ${inlineTextFlag('--content', content)} ${inlineTextFlag('--client-id', trimmedClientId)}${draftVersionFlag(draftVersion)} --json`
  );
}

/**
 * Export the session's agent transcript to markdown:
 * `ghostex export-transcript --session-id <id> --project-id <id> --json`.
 *
 * The transcript and the exported file both live on the daemon's machine, so
 * the phone only ever receives the absolute path the daemon wrote to.
 */
export function exportSessionTranscriptCommand(sessionId: string, projectId: string): string {
  return `ghostex export-transcript ${sessionChatSelector(sessionId, projectId)} --json`;
}

/*
 * Find (the GUI for `gx f`) over SSH. Prompt history lives on the machine that
 * ran the agent, so the phone reaches it through the same verb-runner pattern
 * as Session Chat above. Every follow-up verb addresses a result by the stable
 * `--key` a search row reported, never by a list position, so acting on a row
 * minutes later still lands on the prompt the phone displayed.
 */

export type FindPromptsSearchOptions = {
  agents?: readonly string[];
  groupByDay?: boolean;
  includeFacets?: boolean;
  limit?: number;
  offset?: number;
  project?: string;
  query?: string;
  refresh?: boolean;
  textLimit?: number;
};

function nonNegativeIntegerFlag(name: string, value: number | undefined, label: string): string {
  if (value === undefined) return '';
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Ghostex ${label} must be a non-negative whole number.`);
  }
  return ` ${name} ${value}`;
}

/** `ghostex search-agent-prompts [...] --json` */
export function searchAgentPromptsCommand(options?: FindPromptsSearchOptions): string {
  const parts = ['ghostex search-agent-prompts'];
  const query = options?.query ?? '';
  if (query.length > 0) parts.push(`--query ${shellQuote(query)}`);
  const project = options?.project?.trim() ?? '';
  if (project.length > 0) parts.push(`--project ${shellQuote(project)}`);
  const agents = options?.agents ?? [];
  if (agents.length > 0) parts.push(`--agents ${shellQuote(agents.join(','))}`);
  if (options?.groupByDay !== undefined) {
    parts.push(`--group-by-day ${options.groupByDay ? 'true' : 'false'}`);
  }
  if (options?.includeFacets !== undefined) {
    parts.push(`--include-facets ${options.includeFacets ? 'true' : 'false'}`);
  }
  if (options?.refresh !== undefined) {
    parts.push(`--refresh ${options.refresh ? 'true' : 'false'}`);
  }
  parts.push(nonNegativeIntegerFlag('--limit', options?.limit, 'prompt search limit').trim());
  parts.push(nonNegativeIntegerFlag('--offset', options?.offset, 'prompt search offset').trim());
  parts.push(
    nonNegativeIntegerFlag('--text-limit', options?.textLimit, 'prompt text limit').trim(),
  );
  parts.push('--json');
  return parts.filter((part) => part.length > 0).join(' ');
}

function promptKeyFlag(key: string): string {
  const trimmed = key.trim();
  if (trimmed.length === 0) throw new Error('Ghostex prompt key is required.');
  return `--key ${shellQuote(trimmed)}`;
}

/** `ghostex read-agent-prompt-text --key <key> --json` */
export function readAgentPromptTextCommand(key: string): string {
  return `ghostex read-agent-prompt-text ${promptKeyFlag(key)} --json`;
}

/** `ghostex toggle-agent-prompt-favorite --key <key> [--favorite b] --json` */
export function toggleAgentPromptFavoriteCommand(key: string, favorite?: boolean): string {
  const favoriteFlag = favorite === undefined ? '' : ` --favorite ${favorite ? 'true' : 'false'}`;
  return `ghostex toggle-agent-prompt-favorite ${promptKeyFlag(key)}${favoriteFlag} --json`;
}

/** `ghostex resolve-agent-prompt-launch --key <key> [--action a] [--fork-agent id] --json` */
export function resolveAgentPromptLaunchCommand(
  key: string,
  action: 'fork' | 'resume',
  forkAgent?: string,
): string {
  const fork = forkAgent?.trim() ?? '';
  const forkFlag = fork.length > 0 ? ` --fork-agent ${shellQuote(fork)}` : '';
  return `ghostex resolve-agent-prompt-launch ${promptKeyFlag(key)} --action ${action}${forkFlag} --json`;
}
