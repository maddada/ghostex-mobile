/**
 * TypeScript contract for the `ghostex sessions --json --mobile-summary` payload.
 * Source of truth: docs/specs/sessions-drawer.md §7, mirrored from the Android
 * reference implementation (GhostexRemoteSession / GhostexWorkspaceInventory).
 */

// ---------------------------------------------------------------------------
// Wire types (what the CLI emits; everything except sessionId is optional).
// ---------------------------------------------------------------------------

export type MobileSummaryWireSession = {
  sessionId: string;
  alias?: string;
  projectId?: string;
  groupId?: string;
  title?: string;
  primaryTitle?: string;
  terminalTitle?: string;
  displayTitle?: string;
  displayTitleTooltip?: string;
  projectName?: string;
  groupTitle?: string;
  projectPath?: string;
  activity?: string;
  activityState?: string;
  activityStatus?: string;
  status?: string;
  lifecycleState?: string;
  provider?: string;
  sessionPersistenceProvider?: string;
  providerSessionName?: string;
  sessionPersistenceName?: string;
  agent?: string;
  agentIcon?: string;
  agentName?: string;
  globalRef?: string;
  kind?: string;
  /** "browser" sorts first. */
  surface?: string;
  lastInteractionAt?: string;
  lastActiveAt?: string;
  titleSource?: string;
  trustedResumeTitle?: string;
  updatedAt?: string;
  zmxName?: string;
  nativePaneState?: string;
  providerSessionState?: string;
  sortOrder?: number;
  /** Prompts held in this session's Ghostex queue; absent/0 hides the badge. */
  queuedPromptCount?: number;
  /** How many of those failed to deliver; absent/0 keeps the badge yellow. */
  queuedPromptFailedCount?: number;
  /** Note attached to the session's agent conversation; absent when there is none. */
  sessionNote?: string;
  /** The provider resume id the note is keyed by; absent before the agent starts. */
  agentSessionId?: string;
  isFocused?: boolean;
  isFavorite?: boolean;
  isPinned?: boolean;
  isParked?: boolean;
  isSleeping?: boolean;
  isLive?: boolean;
  isPrimaryTitleTerminalTitle?: boolean;
  isTemporaryTitle?: boolean;
  visibleInSidebarByDefault?: boolean;
  shouldSubmitStagedFirstPromptTitleCommand?: boolean;
  /** Sent only while `activity` is attention. */
  attention?: { enteredAt?: string; acknowledged?: boolean; eventId?: string };
  /** Questions the agent is waiting on an answer to; absent at zero. */
  pendingQuestionCount?: number;
  /** Present while a background shell or monitor the agent started still runs after its turn. */
  backgroundWorkDetectedAt?: string;
  /** When an armed Close After Done closes the session, while it counts down. */
  closeAfterDoneDeadlineAt?: string;
  actions?: Partial<GhostexSessionActions>;
};

export type MobileSummaryWireRoot = {
  sessions: MobileSummaryWireSession[];
  projects?: GhostexProject[];
  recentProjects?: GhostexRecentProject[];
  agents?: GhostexAgentLauncher[];
  quickActionsByProject?: Record<string, GhostexQuickAction[]>;
  workspaceGroups?: GhostexWorkspaceGroups;
  /** Server-normalized colored "Group N" overlay: {order, collections}. */
  sidebarProjectCollections?: unknown;
  /** Server-normalized saved sidebar filters: {order, spaces}. */
  sidebarSpaces?: unknown;
  /** Server-normalized custom session tag catalog: {order, tags}; absent when the daemon has none. */
  customSessionTags?: unknown;
};

// ---------------------------------------------------------------------------
// Normalized model.
// ---------------------------------------------------------------------------

/**
 * The project identity a row renders, mirroring SidebarV2ProjectIcon's
 * resolution chain: a user-attached image, then the icon the project's own
 * repository ships (discovered server-side), then a typed Tabler glyph, then a
 * folder/worktree fallback.
 */
export type GhostexProjectIcon = {
  /** Hand-attached image; wins over everything else. */
  imageDataUrl: string;
  /** The repository's own favicon/app icon, discovered by gxserver. */
  discoveredIconDataUrl: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name, or "" when none is set. */
  glyph: string;
  /** "#rrggbb" tint for the glyph, or "" for the default foreground. */
  glyphColor: string;
  /** True when the project is a git worktree (changes the fallback glyph). */
  isWorktree: boolean;
};

export type GhostexProject = {
  projectId: string;
  name?: string;
  path?: string;
  isChat?: boolean;
  icon: GhostexProjectIcon;
  /** Workspace theme color ("#rrggbb"), or "" — tints the project rail. */
  themeColor: string;
  /**
   * `worktree.parentProjectId` for a git worktree, "" otherwise. Space
   * membership is never assigned to a worktree directly: it defers to this
   * parent (see src/spaces/otherSpace.ts).
   */
  worktreeParentProjectId: string;
};

export type GhostexRecentProject = {
  projectId: string;
  title?: string;
  path?: string;
  sessionCount?: number;
};

export type GhostexAgentLauncher = {
  agentId: string;
  icon?: string;
  name?: string;
};

export type GhostexQuickAction = {
  actionType: 'browser' | 'terminal';
  commandId?: string;
  url?: string;
  icon?: string;
  name?: string;
};

export type GhostexSessionGroup = {
  groupId: string;
  title: string;
  sessionIds: string[];
};

export type GhostexWorkspaceGroups = {
  projectOrder?: string[];
  projects?: Record<string, { groups?: { groupId: string; title?: string; sessionIds?: string[] }[] }>;
};

/**
 * Colored project collection ("Group N") mirrored from the desktop sidebar.
 * Collections render before ungrouped projects, in this array order.
 */
export type GhostexProjectCollection = {
  collectionId: string;
  title: string;
  /** "#rrggbb" (desktop SIDEBAR_PROJECT_COLLECTION_COLORS). */
  color: string;
  projectIds: string[];
};

/**
 * One saved sidebar filter, mirroring `SidebarSpace` in
 * packages/core-ui/spaces.ts. Members are project collections ("groups") and
 * ungrouped projects; either may belong to any number of Spaces, and member ids
 * that resolve to nothing are tolerated because gxserver prunes them
 * asynchronously.
 */
export type GhostexSidebarSpace = {
  spaceId: string;
  name: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name; the server defaults it to "stack". */
  icon: string;
  /** "#rrggbb"; the server defaults it to "#4f5663". */
  color: string;
  memberCollectionIds: string[];
  memberProjectIds: string[];
};

/** Ordered Space set for one machine. Empty `order` means the daemon has none. */
export type GhostexSidebarSpaces = {
  order: string[];
  spaces: Record<string, GhostexSidebarSpace>;
};

export const EMPTY_SIDEBAR_SPACES: GhostexSidebarSpaces = { order: [], spaces: {} };

/**
 * One user-defined session tag, mirroring `CustomSessionTag` in
 * packages/shared/session-tags.ts. gxserver owns the catalog per daemon and
 * ships the resolved hex color and icon id, so the phone needs no palette mirror.
 */
export type GhostexCustomSessionTag = {
  /** `custom-` plus a random token; the value a session's `sessionTag` stores. */
  tagId: string;
  name: string;
  /** SIDEBAR_COMMAND_ICON_IDS glyph name (COMMAND_ICONS on the phone). */
  icon: string;
  /** "#rrggbb". */
  color: string;
};

/** Ordered custom tag catalog for one machine. Empty `order` means the daemon has none. */
export type GhostexCustomSessionTags = {
  order: string[];
  tags: Record<string, GhostexCustomSessionTag>;
};

export const EMPTY_CUSTOM_SESSION_TAGS: GhostexCustomSessionTags = { order: [], tags: {} };

export type GhostexSessionActions = {
  acknowledgeAttention: boolean;
  attach: boolean;
  focus: boolean;
  kill: boolean;
  readText: boolean;
  sendMessage: boolean;
  sendText: boolean;
  sleep: boolean;
  wake: boolean;
};

/** Normalized session row: fallback chains applied, provider guaranteed "zmx". */
export type GhostexSession = {
  /** Display-only compact badge; derived from first 4 chars of sessionId when omitted. */
  alias: string;
  /** Stable Ghostex session id — the CLI action selector. Never empty. */
  sessionId: string;
  /** projectId || groupId fallback chain. */
  projectId: string;
  groupId: string;
  /** title || primaryTitle || terminalTitle fallback chain (raw title, used for rename prefill). */
  title: string;
  /** displayTitle || title chain. Rows still fall back to "Ghostex Session" when empty. */
  displayTitle: string;
  displayTitleTooltip: string;
  /** projectName || groupTitle fallback chain. */
  projectName: string;
  projectPath: string;
  /** Normalized (lowercase, `-` separators, alias map applied): activity || activityState || activityStatus. */
  activity: string;
  /** Normalized: status || lifecycleState. */
  status: string;
  /** Normalized lowercase token: provider || sessionPersistenceProvider. Always "zmx" after filtering. */
  provider: string;
  /** providerSessionName || sessionPersistenceName. */
  providerSessionName: string;
  agent: string;
  agentIcon: string;
  agentName: string;
  globalRef: string;
  kind: string;
  surface: string;
  createdAt: string;
  isDraft?: true;
  hasComposerDraft?: boolean;
  lastInteractionAt: string;
  lastActiveAt: string;
  primaryTitle: string;
  terminalTitle: string;
  titleSource: string;
  trustedResumeTitle: string;
  updatedAt: string;
  zmxName: string;
  /** Normalized: mounted | mounting | unmounted. */
  nativePaneState: string;
  /** Normalized: exists | missing | persistence-disabled | unknown. */
  providerSessionState: string;
  sortOrder: number | null;
  isFocused: boolean;
  isFavorite: boolean;
  isPinned: boolean;
  isParked?: boolean;
  /**
   * Current session tag ('' when untagged): a built-in SIDEBAR_SESSION_TAGS
   * value or a `custom-…` id resolved against the machine's `customSessionTags`.
   */
  sessionTag: string;
  /** Live Delayed Send countdown label ('' when no timer / emitter predates it). */
  delayedSendRemainingLabel: string;
  /**
   * Absolute RFC 3339 deadline of an armed Delayed Send ('' when none, when the
   * send-when-finished trigger is still waiting for its agents, or when the
   * emitter predates it). The row ticks its countdown from this between polls,
   * exactly like the desktop sidebar does; the label above is only a snapshot.
   */
  delayedSendDeadlineAt: string;
  /**
   * How many prompts are held in this session's Ghostex prompt queue
   * (plan 016), `failed` rows included: a queue stalled behind a failed row is
   * exactly the state that needs the user, so hiding it would make a dead queue
   * look like no queue. 0 on a daemon that predates the queue, which is also
   * what hides the row's badge.
   */
  queuedPromptCount: number;
  /**
   * How many of those rows failed to deliver and are held for the user to retry
   * or delete. Non-zero paints the badge red instead of yellow. 0 on a daemon
   * that predates the queue.
   */
  queuedPromptFailedCount: number;
  /**
   * Free-text note the user attached to this session's agent conversation
   * ('' when there is none). gxserver keys it by `agentSessionId`, so the same
   * note follows the conversation across resumes and across clients.
   */
  sessionNote: string;
  /**
   * The provider conversation id the note is keyed by ('' before the agent has
   * started one, or on a daemon that predates the field). Non-empty is what
   * gates the "Session note" long-press item: a session with no conversation
   * has nothing to attach a note to.
   */
  agentSessionId: string;
  /** Enter is armed for every agent in the project to finish. */
  sendWhenAllProjectSessionsStopActive: boolean;
  /** Enter is armed for this agent to finish. */
  sendWhenAgentStopsActive: boolean;
  /** Close After Done armed flag (false when unarmed / emitter predates it). */
  closeAfterDone: boolean;
  /**
   * Absolute RFC 3339 time an armed Close After Done closes the session ('' while
   * it waits for the agent to finish, or when the computer predates the field,
   * which then shows the armed 03:00 like the desktop does without a deadline).
   */
  closeAfterDoneDeadlineAt: string;
  /** Questions the agent is waiting on an answer to (0 when none, or from a computer that predates the field). */
  pendingQuestionCount: number;
  /**
   * Set while a background shell or monitor the agent started is still running
   * after its turn ('' when none, or from a computer that predates the field).
   */
  backgroundWorkDetectedAt: string;
  /** Normalized so a live session is never marked sleeping (isSleeping && !isLive). */
  isSleeping: boolean;
  isLive: boolean;
  isPrimaryTitleTerminalTitle: boolean;
  isTemporaryTitle: boolean;
  visibleInSidebarByDefault: boolean;
  shouldSubmitStagedFirstPromptTitleCommand: boolean;
  attentionEnteredAt: string;
  attentionAcknowledged: boolean;
  /** The attention event id ('' outside attention, or from a computer that predates it). */
  attentionEventId: string;
  actions: GhostexSessionActions;
};

export type GhostexMobileSummary = {
  /** Only zmx-backed sessions with a non-empty sessionId, wire order preserved. */
  sessions: GhostexSession[];
  projects: GhostexProject[];
  recentProjects: GhostexRecentProject[];
  agents: GhostexAgentLauncher[];
  quickActionsByProject: Record<string, GhostexQuickAction[]>;
  workspaceGroups: GhostexWorkspaceGroups | null;
  /** Ordered colored project collections; empty when the overlay is absent. */
  projectCollections: GhostexProjectCollection[];
  /**
   * Verbatim `sidebarProjectCollections` wire state ({order, collections,
   * nextCollectionNumber}) for full-state read-modify-write via
   * `ghostex update-sidebar-project-collections`; null when absent.
   */
  projectCollectionsState: unknown;
  /** Ordered saved sidebar filters; empty when the daemon has no Spaces. */
  sidebarSpaces: GhostexSidebarSpaces;
  /** Ordered user-defined session tags; empty when the daemon has none. */
  customSessionTags: GhostexCustomSessionTags;
  /**
   * Derived: workspaceGroups present OR any raw session carries a sortOrder.
   * When true the payload is pre-sorted like the desktop sidebar and must not
   * be re-sorted on device.
   */
  preserveSessionOrder: boolean;
};

// ---------------------------------------------------------------------------
// JSON reading helpers (narrowing at the parse boundary).
// ---------------------------------------------------------------------------

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Treat JSON nulls as missing; stringify scalars like the Android parser does. */
function trimmedValue(json: JsonObject, key: string): string {
  const value = json[key];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

function boolValue(json: JsonObject, key: string, fallback: boolean): boolean {
  const value = json[key];
  return typeof value === 'boolean' ? value : fallback;
}

function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Status normalization + displayStatus (spec §7).
// ---------------------------------------------------------------------------

function normalizedToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Normalize a protocol status token: lowercase, `_`/space → `-`, plus alias map
 * needs-attention/attention-required→attention; active/busy/processing→working;
 * sleeping→sleep.
 */
export function normalizeStatusToken(value: string): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (normalized === 'needs-attention' || normalized === 'attention-required') return 'attention';
  if (normalized === 'active' || normalized === 'busy' || normalized === 'processing') return 'working';
  if (normalized === 'sleeping') return 'sleep';
  return normalized;
}

function isActionableStatus(value: string): boolean {
  return value === 'attention' || value === 'working' || value === 'done' || value === 'error';
}

function normalizedNativePaneState(
  value: string,
  isSleeping: boolean,
  activity: string,
  status: string,
): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (normalized === 'mounted' || normalized === 'mounting' || normalized === 'unmounted') {
    return normalized;
  }
  return defaultNativePaneState(isSleeping, activity, status);
}

function defaultNativePaneState(isSleeping: boolean, activity: string, status: string): string {
  if (isSleeping) return 'unmounted';
  const states = [normalizeStatusToken(activity), normalizeStatusToken(status)];
  if (states.some((s) => s === 'working' || s === 'attention' || s === 'running' || s === 'idle')) {
    return 'mounted';
  }
  return 'unmounted';
}

function normalizedProviderSessionState(value: string): string {
  const normalized = normalizedToken(value).replace(/[_ ]/g, '-');
  if (
    normalized === 'persistence-disabled' ||
    normalized === 'exists' ||
    normalized === 'missing' ||
    normalized === 'unknown'
  ) {
    return normalized;
  }
  if (
    normalized === 'disabled' ||
    normalized === 'none' ||
    normalized === 'off' ||
    normalized === 'disabled-persistence'
  ) {
    return 'persistence-disabled';
  }
  if (normalized === 'running') return 'exists';
  return 'unknown';
}

function deriveIsLive(
  nativePaneState: string,
  providerSessionState: string,
  isSleeping: boolean,
  activity: string,
  status: string,
): boolean {
  if (
    nativePaneState === 'mounted' ||
    nativePaneState === 'mounting' ||
    providerSessionState === 'exists'
  ) {
    return true;
  }
  const activityState = normalizeStatusToken(activity);
  const statusState = normalizeStatusToken(status);
  if (
    activityState === 'working' ||
    activityState === 'attention' ||
    statusState === 'working' ||
    statusState === 'attention'
  ) {
    return true;
  }
  if (
    isSleeping ||
    activityState === 'sleep' ||
    statusState === 'sleep' ||
    activityState === 'done' ||
    statusState === 'done' ||
    activityState === 'error' ||
    statusState === 'error' ||
    statusState === 'exited'
  ) {
    return false;
  }
  return (
    activityState === 'running' ||
    statusState === 'running' ||
    activityState === 'idle' ||
    statusState === 'idle'
  );
}

/**
 * displayStatus per spec §7:
 * sleeping&&!live → "sleep"; else first actionable (attention|working|done|error)
 * from normalized activity then status; else !live && sleepish → "sleep"; else
 * first non-empty non-"running" activity/status; else "idle".
 */
export function displayStatus(
  session: Pick<GhostexSession, 'activity' | 'status' | 'isSleeping' | 'isLive'>,
): string {
  if (session.isSleeping && !session.isLive) return 'sleep';
  const activityState = normalizeStatusToken(session.activity);
  const statusState = normalizeStatusToken(session.status);
  if (isActionableStatus(activityState)) return activityState;
  if (isActionableStatus(statusState)) return statusState;
  if (!session.isLive && (activityState === 'sleep' || statusState === 'sleep')) return 'sleep';
  if (
    activityState.length > 0 &&
    activityState !== 'running' &&
    (!session.isLive || activityState !== 'sleep')
  ) {
    return activityState;
  }
  if (
    statusState.length > 0 &&
    statusState !== 'running' &&
    (!session.isLive || statusState !== 'sleep')
  ) {
    return statusState;
  }
  return 'idle';
}

// ---------------------------------------------------------------------------
// Recency formatting (spec §2).
// ---------------------------------------------------------------------------

/**
 * <60s "{n}s ago" (min 1); <60m "{n}m ago"; <48h "{n}h ago"; else "{n}d ago";
 * unparseable → "Unknown".
 */
export function formatLastActive(iso: string, now: Date): string {
  const trimmed = iso.trim();
  if (trimmed.length === 0) return 'Unknown';
  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) return 'Unknown';
  const elapsedSeconds = Math.max(1, Math.floor((now.getTime() - timestamp) / 1000));
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

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
  | 'factory-droid'
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
  'factory-droid': '#FF7A1A',
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

/** Lowercased name/icon aliases → icon id (spec §2). */
const AGENT_NAME_ALIASES: Record<string, AgentIconId> = {
  codex: 'codex',
  'codex cli': 'codex',
  claude: 'claude',
  'claude code': 'claude',
  openclaude: 'openclaude',
  'open claude': 'openclaude',
  cursor: 'cursor-cli',
  'cursor cli': 'cursor-cli',
  'cursor agent': 'cursor-cli',
  'cursor-agent': 'cursor-cli',
  pi: 'pi',
  'pi agent': 'pi',
  'π': 'pi',
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

export function agentIconTint(iconId: AgentIconId): string {
  return AGENT_ICON_TINTS[iconId];
}

// ---------------------------------------------------------------------------
// Resilient JSON extraction (brace-matching scan tolerant of shell banners).
// ---------------------------------------------------------------------------

/**
 * Return the complete JSON object text starting at `start` (which must index a
 * '{'), or null when the braces never balance before end of output.
 */
function extractJsonObjectAt(output: string, start: number): string | null {
  let inString = false;
  let escaping = false;
  let depth = 0;
  for (let index = start; index < output.length; index++) {
    const value = output[index];
    if (inString) {
      if (escaping) escaping = false;
      else if (value === '\\') escaping = true;
      else if (value === '"') inString = false;
      continue;
    }
    if (value === '"') inString = true;
    else if (value === '{') depth++;
    else if (value === '}') {
      depth--;
      if (depth === 0) return output.slice(start, index + 1);
    }
  }
  return null;
}

/**
 * Scan `output` for balanced `{...}` blocks starting at each '{' from
 * `fromIndex`, invoking `visit` with each block's text and start index.
 * `visit` returns the next scan index (or null to stop and return its result).
 */
export function scanJsonObjects<T>(
  output: string,
  visit: (text: string, start: number) => { done: true; result: T } | { done: false; nextIndex: number },
): T | null {
  let searchStart = 0;
  while (searchStart < output.length) {
    const start = output.indexOf('{', searchStart);
    if (start < 0) return null;
    const candidate = extractJsonObjectAt(output, start);
    if (candidate === null) {
      searchStart = start + 1;
      continue;
    }
    const outcome = visit(candidate, start);
    if (outcome.done) return outcome.result;
    searchStart = outcome.nextIndex;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Session + root normalization.
// ---------------------------------------------------------------------------

function emptyActions(): GhostexSessionActions {
  return {
    acknowledgeAttention: false,
    attach: false,
    focus: false,
    kill: false,
    readText: false,
    sendMessage: false,
    sendText: false,
    sleep: false,
    wake: false,
  };
}

function parseActions(value: unknown): GhostexSessionActions {
  if (!isObject(value)) return emptyActions();
  return {
    acknowledgeAttention: boolValue(value, 'acknowledgeAttention', false),
    attach: boolValue(value, 'attach', false),
    focus: boolValue(value, 'focus', false),
    kill: boolValue(value, 'kill', false),
    readText: boolValue(value, 'readText', false),
    sendMessage: boolValue(value, 'sendMessage', false),
    sendText: boolValue(value, 'sendText', false),
    sleep: boolValue(value, 'sleep', false),
    wake: boolValue(value, 'wake', false),
  };
}

function aliasFromSessionId(sessionId: string): string {
  return sessionId.length <= 4 ? sessionId : sessionId.slice(0, 4);
}

/** Parse and normalize one wire session; null when sessionId is missing/empty. */
export function parseSession(value: unknown): GhostexSession | null {
  if (!isObject(value)) return null;
  const sessionId = trimmedValue(value, 'sessionId');
  if (sessionId.length === 0) return null;

  const alias = firstNonEmpty(trimmedValue(value, 'alias')) || aliasFromSessionId(sessionId);
  const provider = normalizedToken(
    firstNonEmpty(trimmedValue(value, 'provider'), trimmedValue(value, 'sessionPersistenceProvider')),
  );
  const status = normalizeStatusToken(
    firstNonEmpty(trimmedValue(value, 'status'), trimmedValue(value, 'lifecycleState')),
  );
  const activity = normalizeStatusToken(
    firstNonEmpty(
      trimmedValue(value, 'activity'),
      trimmedValue(value, 'activityState'),
      trimmedValue(value, 'activityStatus'),
    ),
  );
  const groupId = trimmedValue(value, 'groupId');
  const legacySleeping = boolValue(value, 'isSleeping', status === 'sleep');
  const nativePaneState = normalizedNativePaneState(
    trimmedValue(value, 'nativePaneState'),
    legacySleeping,
    activity,
    status,
  );
  const providerSessionState = normalizedProviderSessionState(
    trimmedValue(value, 'providerSessionState'),
  );
  const isLive =
    typeof value.isLive === 'boolean'
      ? value.isLive
      : deriveIsLive(nativePaneState, providerSessionState, legacySleeping, activity, status);
  const rawTitle = firstNonEmpty(
    trimmedValue(value, 'title'),
    trimmedValue(value, 'primaryTitle'),
    trimmedValue(value, 'terminalTitle'),
  );
  const resolvedDisplayTitle = firstNonEmpty(trimmedValue(value, 'displayTitle'), rawTitle);
  const attention = isObject(value.attention) ? value.attention : null;
  const rawSortOrder = value.sortOrder;

  return {
    alias,
    sessionId,
    projectId: firstNonEmpty(trimmedValue(value, 'projectId'), groupId),
    groupId,
    title: rawTitle,
    displayTitle: resolvedDisplayTitle,
    displayTitleTooltip: firstNonEmpty(trimmedValue(value, 'displayTitleTooltip'), resolvedDisplayTitle),
    projectName: firstNonEmpty(trimmedValue(value, 'projectName'), trimmedValue(value, 'groupTitle')),
    projectPath: trimmedValue(value, 'projectPath'),
    activity,
    status,
    provider,
    providerSessionName: firstNonEmpty(
      trimmedValue(value, 'providerSessionName'),
      trimmedValue(value, 'sessionPersistenceName'),
    ),
    agent: trimmedValue(value, 'agent'),
    agentIcon: trimmedValue(value, 'agentIcon'),
    agentName: trimmedValue(value, 'agentName'),
    globalRef: trimmedValue(value, 'globalRef'),
    kind: trimmedValue(value, 'kind'),
    surface: trimmedValue(value, 'surface'),
    createdAt: trimmedValue(value, 'createdAt'),
    isDraft: value.isDraft === true ? true : undefined,
    hasComposerDraft: value.hasComposerDraft === true ? true : undefined,
    lastInteractionAt: trimmedValue(value, 'lastInteractionAt'),
    lastActiveAt: trimmedValue(value, 'lastActiveAt'),
    primaryTitle: trimmedValue(value, 'primaryTitle'),
    terminalTitle: trimmedValue(value, 'terminalTitle'),
    titleSource: trimmedValue(value, 'titleSource'),
    trustedResumeTitle: trimmedValue(value, 'trustedResumeTitle'),
    updatedAt: trimmedValue(value, 'updatedAt'),
    zmxName: trimmedValue(value, 'zmxName'),
    nativePaneState,
    providerSessionState,
    sortOrder: typeof rawSortOrder === 'number' && Number.isFinite(rawSortOrder) ? rawSortOrder : null,
    isFocused: boolValue(value, 'isFocused', false),
    isFavorite: boolValue(value, 'isFavorite', false),
    isPinned: boolValue(value, 'isPinned', false),
    isParked: boolValue(value, 'isParked', false),
    sessionTag: trimmedValue(value, 'sessionTag'),
    delayedSendRemainingLabel: trimmedValue(value, 'delayedSendRemainingLabel'),
    delayedSendDeadlineAt: trimmedValue(value, 'delayedSendDeadlineAt'),
    queuedPromptCount:
      typeof value.queuedPromptCount === 'number' && Number.isFinite(value.queuedPromptCount)
        ? Math.max(0, Math.floor(value.queuedPromptCount))
        : 0,
    queuedPromptFailedCount:
      typeof value.queuedPromptFailedCount === 'number' &&
      Number.isFinite(value.queuedPromptFailedCount)
        ? Math.max(0, Math.floor(value.queuedPromptFailedCount))
        : 0,
    sessionNote: trimmedValue(value, 'sessionNote'),
    agentSessionId: trimmedValue(value, 'agentSessionId'),
    sendWhenAllProjectSessionsStopActive: boolValue(
      value,
      'sendWhenAllProjectSessionsStopActive',
      false,
    ),
    sendWhenAgentStopsActive: boolValue(value, 'sendWhenAgentStopsActive', false),
    closeAfterDone: boolValue(value, 'closeAfterDone', false),
    closeAfterDoneDeadlineAt: trimmedValue(value, 'closeAfterDoneDeadlineAt'),
    pendingQuestionCount:
      typeof value.pendingQuestionCount === 'number' && Number.isFinite(value.pendingQuestionCount)
        ? Math.max(0, Math.floor(value.pendingQuestionCount))
        : 0,
    backgroundWorkDetectedAt: trimmedValue(value, 'backgroundWorkDetectedAt'),
    isSleeping: legacySleeping && !isLive,
    isLive,
    isPrimaryTitleTerminalTitle: boolValue(value, 'isPrimaryTitleTerminalTitle', false),
    isTemporaryTitle: boolValue(value, 'isTemporaryTitle', false),
    visibleInSidebarByDefault: boolValue(value, 'visibleInSidebarByDefault', false),
    shouldSubmitStagedFirstPromptTitleCommand: boolValue(
      value,
      'shouldSubmitStagedFirstPromptTitleCommand',
      false,
    ),
    attentionEnteredAt: attention === null ? '' : trimmedValue(attention, 'enteredAt'),
    attentionAcknowledged: attention === null ? false : boolValue(attention, 'acknowledged', false),
    attentionEventId: attention === null ? '' : trimmedValue(attention, 'eventId'),
    actions: parseActions(value.actions),
  };
}

/** Chat storage detection mirror: `.../{ghostex|.active|.ghostex|.ghostex-*}/chats/...`. */
function isChatStoragePath(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/');
  for (let i = 1; i < segments.length; i++) {
    if (segments[i] !== 'chats') continue;
    const owner = segments[i - 1];
    if (
      owner === 'ghostex' ||
      owner === '.active' ||
      owner === '.ghostex' ||
      owner.startsWith('.ghostex-')
    ) {
      return true;
    }
  }
  return false;
}

function parseProjects(value: unknown): GhostexProject[] {
  if (!Array.isArray(value)) return [];
  const projects: GhostexProject[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const projectId = trimmedValue(entry, 'projectId');
    if (projectId.length === 0) continue;
    const path = trimmedValue(entry, 'path');
    projects.push({
      projectId,
      name: trimmedValue(entry, 'name'),
      path,
      isChat: boolValue(entry, 'isChat', false) || isChatStoragePath(path),
      icon: parseProjectIcon(entry),
      themeColor: normalizedHexColor(trimmedValue(entry, 'themeColor')),
      worktreeParentProjectId: isObject(entry.worktree)
        ? trimmedValue(entry.worktree, 'parentProjectId')
        : '',
    });
  }
  return projects;
}

/**
 * `identityIcon.icon` on the wire is either { kind: "image", dataUrl } or
 * { kind: "tabler", icon, color? } (packages/shared/workspace-project-appearance.ts).
 * The legacy flat `iconDataUrl` is the same user-attached image from older
 * daemons, so it feeds the same slot.
 */
function parseProjectIcon(entry: Record<string, unknown>): GhostexProjectIcon {
  const icon = isObject(entry.icon) ? entry.icon : null;
  const kind = icon === null ? '' : trimmedValue(icon, 'kind');
  const worktree = entry.worktree;
  return {
    imageDataUrl: firstNonEmpty(
      kind === 'image' && icon !== null ? trimmedValue(icon, 'dataUrl') : '',
      trimmedValue(entry, 'iconDataUrl'),
    ),
    discoveredIconDataUrl: trimmedValue(entry, 'discoveredIconDataUrl'),
    glyph: kind === 'tabler' && icon !== null ? trimmedValue(icon, 'icon') : '',
    glyphColor:
      kind === 'tabler' && icon !== null ? normalizedHexColor(trimmedValue(icon, 'color')) : '',
    isWorktree:
      isObject(worktree) ||
      (typeof worktree === 'string' && worktree.trim().length > 0 && worktree.trim() !== 'null'),
  };
}

/** "#rgb"/"#rrggbb" only; anything else becomes "" so it can never reach a style. */
function normalizedHexColor(value: string): string {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value) ? value : '';
}

function parseRecentProjects(value: unknown): GhostexRecentProject[] {
  if (!Array.isArray(value)) return [];
  const projects: GhostexRecentProject[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const projectId = trimmedValue(entry, 'projectId');
    if (projectId.length === 0) continue;
    const rawCount = entry.sessionCount;
    projects.push({
      projectId,
      title: trimmedValue(entry, 'title'),
      path: trimmedValue(entry, 'path'),
      sessionCount:
        typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0,
    });
  }
  return projects;
}

function parseAgents(value: unknown): GhostexAgentLauncher[] {
  if (!Array.isArray(value)) return [];
  const agents: GhostexAgentLauncher[] = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const agentId = trimmedValue(entry, 'agentId');
    if (agentId.length === 0) continue;
    agents.push({ agentId, icon: trimmedValue(entry, 'icon'), name: trimmedValue(entry, 'name') });
  }
  return agents;
}

function parseQuickActionsByProject(value: unknown): Record<string, GhostexQuickAction[]> {
  if (!isObject(value)) return {};
  const byProject: Record<string, GhostexQuickAction[]> = {};
  for (const rawProjectId of Object.keys(value)) {
    const projectId = rawProjectId.trim();
    if (projectId.length === 0) continue;
    const actionsValue = value[rawProjectId];
    if (!Array.isArray(actionsValue)) continue;
    const actions: GhostexQuickAction[] = [];
    for (const entry of actionsValue) {
      if (!isObject(entry)) continue;
      const actionType = trimmedValue(entry, 'actionType').toLowerCase();
      if (actionType !== 'browser' && actionType !== 'terminal') continue;
      actions.push({
        actionType,
        commandId: trimmedValue(entry, 'commandId'),
        url: trimmedValue(entry, 'url'),
        icon: trimmedValue(entry, 'icon'),
        name: trimmedValue(entry, 'name'),
      });
    }
    if (actions.length > 0) byProject[projectId] = actions;
  }
  return byProject;
}

function parseWorkspaceGroups(value: unknown): GhostexWorkspaceGroups | null {
  if (!isObject(value)) return null;
  const projectOrder: string[] = [];
  if (Array.isArray(value.projectOrder)) {
    for (const entry of value.projectOrder) {
      if (entry === null || entry === undefined) continue;
      const projectId = String(entry).trim();
      if (projectId.length > 0 && !projectOrder.includes(projectId)) projectOrder.push(projectId);
    }
  }
  const projects: NonNullable<GhostexWorkspaceGroups['projects']> = {};
  if (isObject(value.projects)) {
    for (const rawProjectId of Object.keys(value.projects)) {
      const projectId = rawProjectId.trim();
      if (projectId.length === 0) continue;
      const projectValue = (value.projects as JsonObject)[rawProjectId];
      if (!isObject(projectValue) || !Array.isArray(projectValue.groups)) continue;
      const groups: { groupId: string; title?: string; sessionIds?: string[] }[] = [];
      for (const groupValue of projectValue.groups) {
        if (!isObject(groupValue)) continue;
        const groupId = trimmedValue(groupValue, 'groupId');
        if (groupId.length === 0) continue;
        const sessionIds: string[] = [];
        if (Array.isArray(groupValue.sessionIds)) {
          for (const idValue of groupValue.sessionIds) {
            if (idValue === null || idValue === undefined) continue;
            const sessionId = String(idValue).trim();
            if (sessionId.length > 0) sessionIds.push(sessionId);
          }
        }
        groups.push({ groupId, title: trimmedValue(groupValue, 'title'), sessionIds });
      }
      if (groups.length > 0) projects[projectId] = { groups };
    }
  }
  return { projectOrder, projects };
}

/**
 * Parse the server-normalized `{order, collections}` project-collection wire
 * shape into an ordered array (order first, then leftover collection ids),
 * mirroring the desktop's parseSidebarProjectCollectionsFromGxserver.
 */
export function parseProjectCollections(value: unknown): GhostexProjectCollection[] {
  if (!isObject(value) || !isObject(value.collections)) return [];
  const byId = value.collections as JsonObject;
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.order)) {
    for (const entry of value.order) {
      if (typeof entry !== 'string') continue;
      const collectionId = entry.trim();
      if (collectionId.length === 0 || seen.has(collectionId) || !(collectionId in byId)) continue;
      seen.add(collectionId);
      orderedIds.push(collectionId);
    }
  }
  for (const collectionId of Object.keys(byId)) {
    if (!seen.has(collectionId)) {
      seen.add(collectionId);
      orderedIds.push(collectionId);
    }
  }
  const collections: GhostexProjectCollection[] = [];
  for (const collectionId of orderedIds) {
    const entry = byId[collectionId];
    if (!isObject(entry)) continue;
    const projectIds: string[] = [];
    if (Array.isArray(entry.projectIds)) {
      for (const idValue of entry.projectIds) {
        if (typeof idValue !== 'string') continue;
        const projectId = idValue.trim();
        if (projectId.length > 0 && !projectIds.includes(projectId)) projectIds.push(projectId);
      }
    }
    if (projectIds.length === 0) continue;
    const rawColor = trimmedValue(entry, 'color');
    collections.push({
      collectionId,
      title: firstNonEmpty(trimmedValue(entry, 'title')) || collectionId,
      color:
        rawColor !== 'transparent' && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#4f5663',
      projectIds,
    });
  }
  return collections;
}

/**
 * Parse the `sidebarSpaces` wire key ({order, spaces}) emitted by
 * `to_mobile_sidebar_spaces` in server/src/ghostex_cli/sessions.rs. The server
 * already normalizes names, icons, colors, and the order array; this re-narrows
 * the shape at the parse boundary and appends any Space the order array missed
 * so a Space can never become invisible.
 */
export function parseSidebarSpaces(value: unknown): GhostexSidebarSpaces {
  if (!isObject(value) || !isObject(value.spaces)) return { order: [], spaces: {} };
  const bySpaceId = value.spaces as JsonObject;
  const spaces: Record<string, GhostexSidebarSpace> = {};
  const stringArray = (entry: JsonObject, key: string): string[] => {
    const raw = entry[key];
    if (!Array.isArray(raw)) return [];
    const ids: string[] = [];
    for (const idValue of raw) {
      if (typeof idValue !== 'string') continue;
      const id = idValue.trim();
      if (id.length > 0 && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  for (const spaceId of Object.keys(bySpaceId)) {
    const entry = bySpaceId[spaceId];
    if (spaceId.trim().length === 0 || !isObject(entry)) continue;
    const rawColor = trimmedValue(entry, 'color');
    spaces[spaceId] = {
      spaceId,
      name: firstNonEmpty(trimmedValue(entry, 'name')) || spaceId,
      icon: firstNonEmpty(trimmedValue(entry, 'icon')) || 'stack',
      color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#4f5663',
      memberCollectionIds: stringArray(entry, 'memberCollectionIds'),
      memberProjectIds: stringArray(entry, 'memberProjectIds'),
    };
  }
  const order: string[] = [];
  if (Array.isArray(value.order)) {
    for (const entry of value.order) {
      if (typeof entry !== 'string') continue;
      const spaceId = entry.trim();
      if (spaceId in spaces && !order.includes(spaceId)) order.push(spaceId);
    }
  }
  for (const spaceId of Object.keys(spaces)) {
    if (!order.includes(spaceId)) order.push(spaceId);
  }
  // CDXC:Spaces 2026-09-07 SEE-ALSO: Match packages/core-ui/spaces.ts and gxserver: each member keeps its first Space in sidebar order.
  const assignedCollections = new Set<string>();
  const assignedProjects = new Set<string>();
  for (const spaceId of order) {
    const space = spaces[spaceId];
    space.memberCollectionIds = space.memberCollectionIds.filter((id) => {
      if (assignedCollections.has(id)) return false;
      assignedCollections.add(id);
      return true;
    });
    space.memberProjectIds = space.memberProjectIds.filter((id) => {
      if (assignedProjects.has(id)) return false;
      assignedProjects.add(id);
      return true;
    });
  }
  return { order, spaces };
}

/**
 * Parse the `customSessionTags` wire key ({order, tags}) the mobile summary
 * emits from the daemon's custom tag catalog. Like `parseSidebarSpaces` it only
 * re-narrows the server-normalized shape and appends any tag the order array
 * missed, so a tag a session already carries can never become unresolvable.
 */
export function parseCustomSessionTags(value: unknown): GhostexCustomSessionTags {
  if (!isObject(value) || !isObject(value.tags)) return { order: [], tags: {} };
  const byTagId = value.tags as JsonObject;
  const tags: Record<string, GhostexCustomSessionTag> = {};
  for (const tagId of Object.keys(byTagId)) {
    const entry = byTagId[tagId];
    if (!tagId.startsWith('custom-') || !isObject(entry)) continue;
    const rawColor = trimmedValue(entry, 'color');
    tags[tagId] = {
      tagId,
      name: firstNonEmpty(trimmedValue(entry, 'name')) || 'Tag',
      icon: firstNonEmpty(trimmedValue(entry, 'icon')) || 'sparkles',
      color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#9AA8B6',
    };
  }
  const order: string[] = [];
  if (Array.isArray(value.order)) {
    for (const entry of value.order) {
      if (typeof entry !== 'string') continue;
      const tagId = entry.trim();
      if (tagId in tags && !order.includes(tagId)) order.push(tagId);
    }
  }
  for (const tagId of Object.keys(tags)) {
    if (!order.includes(tagId)) order.push(tagId);
  }
  return { order, tags };
}

function normalizeRoot(root: JsonObject): GhostexMobileSummary {
  const rawSessions = Array.isArray(root.sessions) ? root.sessions : [];
  const sessions: GhostexSession[] = [];
  let anySortOrder = false;
  for (const entry of rawSessions) {
    if (isObject(entry) && typeof entry.sortOrder === 'number' && Number.isFinite(entry.sortOrder)) {
      anySortOrder = true;
    }
    const session = parseSession(entry);
    if (session !== null && session.provider === 'zmx') sessions.push(session);
  }
  const workspaceGroups = parseWorkspaceGroups(root.workspaceGroups);
  return {
    sessions,
    projects: parseProjects(root.projects),
    recentProjects: parseRecentProjects(root.recentProjects),
    agents: parseAgents(root.agents),
    quickActionsByProject: parseQuickActionsByProject(root.quickActionsByProject),
    workspaceGroups,
    projectCollections: parseProjectCollections(root.sidebarProjectCollections),
    projectCollectionsState: isObject(root.sidebarProjectCollections)
      ? root.sidebarProjectCollections
      : null,
    sidebarSpaces: parseSidebarSpaces(root.sidebarSpaces),
    customSessionTags: parseCustomSessionTags(root.customSessionTags),
    preserveSessionOrder: workspaceGroups !== null || anySortOrder,
  };
}

/**
 * Scan stdout for the first complete JSON object containing a `sessions` array
 * (brace-matching scan tolerant of shell banners before/after) and normalize
 * it. Returns null when no such object exists.
 */
export function parseMobileSummary(stdout: string): GhostexMobileSummary | null {
  return scanJsonObjects<GhostexMobileSummary>(stdout, (text, start) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { done: false, nextIndex: start + 1 };
    }
    if (isObject(parsed) && Array.isArray(parsed.sessions)) {
      return { done: true, result: normalizeRoot(parsed) };
    }
    return { done: false, nextIndex: start + text.length };
  });
}
