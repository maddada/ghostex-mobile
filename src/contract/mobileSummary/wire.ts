/**
 * The wire types: what `ghostex sessions --json --mobile-summary` emits (everything but sessionId is optional).
 * Part of the mobile summary contract (`./index.ts`).
 */

import type {
  GhostexAgentLauncher,
  GhostexProject,
  GhostexQuickAction,
  GhostexRecentProject,
  GhostexSessionActions,
  GhostexWorkspaceGroups,
} from './model';

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
  /** gxserver's `sidebarOrder`: where a pinned session was dragged to, one number across projects. */
  sidebarOrder?: number;
  /** Prompts held in this session's Ghostex queue; absent/0 hides the badge. */
  queuedPromptCount?: number;
  /** How many of those failed to deliver; absent/0 keeps the badge yellow. */
  queuedPromptFailedCount?: number;
  /** Note attached to the session's agent conversation; absent when there is none. */
  sessionNote?: string;
  /** 'coordinator' on a coordinator session, 'thread' on one it started; absent otherwise. */
  coordinatorRole?: string;
  /** This computer's Chief (server/src/chief/): drawn as its own row, never in its project. */
  isChief?: boolean;
  /** Its project's main coordinator on its computer (server/src/coordinators/main_coordinator.rs); absent from an older gxserver. */
  isMainCoordinator?: boolean;
  /** On a thread: its coordinator's ids and the thread's state (server/src/coordinators/presentation.rs). */
  coordinatorProjectId?: string;
  coordinatorSessionId?: string;
  coordinatorThreadState?: string;
  /** On a coordinator: its threads on other computers (server/src/coordinators/remote_threads.rs); absent when none. */
  coordinatorRemoteThreads?: Array<{ serverId?: string; projectId?: string; sessionId?: string; threadState?: string }>;
  /** Working with no output for long enough to count as stuck (server/src/coordinators/stall.rs); absent while it moves. */
  stuckSince?: string;
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
  /**
   * Sent only while `activity` is attention. `kind` identifies a finished turn or a wait; an unknown or idle
   * start leaves `workingStartedAt` out even on a current computer. `notificationId` requires its capability.
   */
  attention?: {
    enteredAt?: string;
    acknowledged?: boolean;
    eventId?: string;
    notificationId?: string;
    kind?: string;
    workingStartedAt?: string;
    handoverNeedsYou?: boolean;
  };

  /** Questions the agent is waiting on an answer to; absent at zero. */
  pendingQuestionCount?: number;
  /** An open question card waits for an answer; sent by a computer with the `awaitingAnswer` capability. */
  awaitingAnswer?: boolean;
  /** Stuck on a permission prompt or approval card only the user can grant; absent when not (server/src/session_approval.rs). */
  awaitingApproval?: boolean;
  /** Present while a background shell or monitor the agent started still runs after its turn. */
  backgroundWorkDetectedAt?: string;
  /** The session's OSC 7501 program status (server/src/program_status/presentation.rs). */
  programStatus?: {
    governs?: boolean;
    state?: string;
    kind?: string;
    progress?: number;
    app?: string;
    message?: string;
  };
  /** Branch of the session's cwd; Copy Branch reads it (`GxserverPresentationSessionGitStatus`). */
  gitStatus?: { branch?: string | null };
  /** What a work-mode session is linked to (`GxserverPresentationSessionWork`); absent outside work mode. */
  work?: unknown;
  /** A Claude cloud session's record (`PresentationClaudeCloud`); absent for every other session. */
  claudeCloud?: unknown;
  /** Every PR, issue and Linear link of the session (`GxserverPresentationSessionLinks`). */
  links?: unknown;
  /** When an armed Close After Done closes the session, while it counts down. */
  closeAfterDoneDeadlineAt?: string;
  /** When the agent's current working stint began; absent while it is not working. */
  workingStartedAt?: string;
  /** Why the last model change failed; absent when it did not. */
  modelSelectionFailure?: string;
  /** A chat message that could not be sent or waits on a closed session: the same red dot. */
  sendFailure?: string;
  /** When the session got blocked (every account out of usage, an error recovery could not get past); absent otherwise. */
  blockedSince?: string;
  /** Why it is blocked, in the user's words; absent while it is not blocked. */
  blockedReason?: string;
  /** When a snoozed session wakes; absent when it is not snoozed. */
  snoozedUntil?: string;
  actions?: Partial<GhostexSessionActions>;
};

export type MobileSummaryWireRoot = {
  sessions: MobileSummaryWireSession[];
  projects?: GhostexProject[];
  recentProjects?: GhostexRecentProject[];
  agents?: GhostexAgentLauncher[];
  quickActionsByProject?: Record<string, GhostexQuickAction[]>;
  /** The computer's Global Actions, in its saved order; absent from a computer that predates them. */
  globalQuickActions?: GhostexQuickAction[];
  workspaceGroups?: GhostexWorkspaceGroups;
  /** Server-normalized colored "Group N" overlay: {order, collections}. */
  sidebarProjectCollections?: unknown;
  /** Server-normalized saved sidebar filters: {order, spaces}. */
  sidebarSpaces?: unknown;
  /** Server-normalized custom session tag catalog: {order, tags}; absent when the daemon has none. */
  customSessionTags?: unknown;
  /** This computer's workspaces (`SidebarWorkspacesState`); absent on a daemon without workspaces. */
  sidebarWorkspaces?: unknown;
  /** Booleans naming supported summary features, including `awaitingAnswer`, `attentionNotificationId` and `globalQuickActions`; absent on older computers. */
  capabilities?: unknown;
};
