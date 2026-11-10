/**
 * The normalized session and summary types, and the rules on them that need no parsing.
 * Part of the mobile summary contract (`./index.ts`).
 */

import type { GhostexClaudeCloud } from '../claudeCloud';
import type {
  GhostexAgentLauncher,
  GhostexCustomSessionTags,
  GhostexGbotsChat,
  GhostexProject,
  GhostexProjectCollection,
  GhostexQuickAction,
  GhostexRecentProject,
  GhostexSessionActions,
  GhostexSessionCloudBox,
  GhostexSessionLinks,
  GhostexSessionWork,
  GhostexSidebarSpaces,
  GhostexWorkspaceGroups,
  GhostexWorkspaces,
} from './model';

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
  /**
   * The agentbox box the session's agent runs in (`PresentationAgentbox`). `pending` is a draft
   * whose chat Run on row picked the box; its first message starts it.
   */
  agentbox?: { provider: string; boxName: string; providerLabel: string; pending?: true };
  /**
   * The Cloud Box the session runs on (☁ badge and its state dot). Set by the phone when it lists
   * a box's sessions inside their home project (src/cloudBoxes/boxSessions.ts), and from
   * `PresentationSession.cloudBox` for a home draft whose tray picked Cloud Box (`pending`).
   */
  cloudBox?: GhostexSessionCloudBox;
  hasComposerDraft?: boolean;
  lastInteractionAt: string;
  lastActiveAt: string;
  primaryTitle: string;
  /**
   * The name of the user's last rename the agent never confirmed within 8 seconds, and when
   * gxserver gave up on it (server/src/presentation/session_attributes.rs
   * `pending_session_rename_title`): the row title shakes when it appears and Rename opens with
   * it. Empty once a rename is confirmed or another is requested, and on an older computer.
   */
  renameFailedTitle: string;
  renameFailedAt: string;
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
  /** gxserver's `sidebarOrder` (see the raw field); `null` when the session has none. */
  sidebarOrder: number | null;
  isFocused: boolean;
  isFavorite: boolean;
  isPinned: boolean;
  isParked?: boolean;
  /** The git probe's branch for the session's cwd ('' when none); Copy Branch falls back to it. */
  gitBranch?: string;
  /** Present only for a session of a project with work mode on. */
  work?: GhostexSessionWork;
  /** Present only for a Claude cloud session (claudeCloud.ts). */
  claudeCloud?: GhostexClaudeCloud;
  /** Every PR, issue and Linear link of the session; absent when it has none and nothing to suggest. */
  links?: GhostexSessionLinks;
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
  /** The session is a coordinator: its row draws the captain's hat instead of its agent logo. */
  isCoordinator: boolean;
  /** The coordinator is its project's main one on its computer: the row's "Main" tag. */
  isMainCoordinator: boolean;
  /** The computer's Chief: drawn as the Chief row under the Spaces tabs (contract/chief.ts). */
  isChief: boolean;
  /** A GBot's chat (`gbotsChat`), while GBots are on: drawn under its bot's row (contract/gbots.ts). */
  gbotsChat?: GhostexGbotsChat;
  /**
   * On a thread: the coordinator it belongs to ('' on every other session, and on a daemon that
   * predates the fields). The drawer nests the thread under that coordinator (coordinatorTree.ts).
   */
  coordinatorProjectId: string;
  coordinatorSessionId: string;
  /** On a thread: waiting, finished, working, sleeping, closed or done ('' otherwise). */
  coordinatorThreadState: string;
  /**
   * On a coordinator: its threads on other computers, by the `globalRef` their computer gives them
   * (`<serverId>:<projectId>:<sessionId>`), with the state its computer last saw. Empty when none, or
   * from a computer that predates the field. The Unified list nests them under it (contract/unified/tree.ts).
   */
  coordinatorRemoteThreads: Array<{ globalRef: string; threadState: string }>;
  /** Working with no output for long enough to count as stuck ('' while it moves, or from an older computer). */
  stuckSince: string;
  /**
   * On a side chat: the main session it was forked from ('' otherwise). Side chats are left out of
   * every session list and reached from their main chat's Side chats pill (`visibleSessions`).
   */
  sideChatParentSessionId: string;
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
   * it waits for the agent to finish, or when the computer predates the field;
   * the row then draws the clock icon and no time, like the desktop).
   */
  closeAfterDoneDeadlineAt: string;
  /** Questions the agent is waiting on an answer to (0 when none, or from a computer that predates the field). */
  pendingQuestionCount: number;
  /**
   * An open question card waits for an answer (false when not, or when the computer does not send the field: only
   * with the summary's `capabilities.awaitingAnswer` does false mean "no open question card").
   */
  awaitingAnswer: boolean;
  /**
   * Stuck on a permission prompt or approval card only the user can grant: the red approval dot
   * (false when not, or from a computer that predates the field).
   */
  awaitingApproval: boolean;
  /**
   * Set while a background shell or monitor the agent started is still running
   * after its turn ('' when none, or from a computer that predates the field).
   */
  backgroundWorkDetectedAt: string;
  /**
   * The line the program running in the session reported about itself (OSC 7501), shown in the
   * session's long-press menu: '' when its reports do not drive the session's status, or when it
   * said nothing (contract/programStatus.ts).
   */
  programStatusLine: string;
  /** The program reported `error` while its reports drive the status (contract/programStatus.ts). */
  programStatusFailed: boolean;
  /**
   * When the agent's current working stint began ('' when it is not working, or from a computer
   * that predates the field): the Unified list's "came back" moment and Working timer.
   */
  workingStartedAt: string;
  /** The last model change failed, a message could not be sent, or the session is blocked (the Unified list's Failed status); false from an older computer. */
  modelSelectionFailed?: boolean;
  /**
   * CDXC:Notifications 2026-11-08 SEE-ALSO: packages/gx-core/src/sidebar_view/rows.rs. When the session got blocked
   * (out of usage on every account, or an API or sign-in error Ghostex could not get past), and why. Absent while it
   * is not blocked, and from a computer that predates the fields, so an older computer draws no blocked dot.
   */
  blockedSince?: string;
  blockedReason?: string;
  /** When a snoozed session wakes ('' when it is not snoozed): the Unified list's Snoozed shelf. */
  snoozedUntil?: string;
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
  /**
   * The feed row written for that attention event (`attention.notificationId`, optional: '' outside attention,
   * without a feed row, or from a computer that does not send it). Used only when the summary's
   * `capabilities.attentionNotificationId` is set.
   */
  attentionNotificationId: string;
  /**
   * Why the session is in attention ('' outside attention, and from a computer that sends no attention kind,
   * which cannot tell a finished turn from a wait for the user).
   */
  attentionKind: GhostexAttentionKind;
  /**
   * A finished turn whose handover ends with a Blocked or Needs you section (`attention.handoverNeedsYou`; false
   * outside attention and from a computer that does not send it).
   */
  attentionHandoverNeedsYou: boolean;
  /**
   * The computer's verdict on whether this attention alerts (`attention.alerts`, CDXC:Notifications 2026-11-08 in
   * packages/gx-core/src/alert_rule.rs); null outside attention and from a computer that does not send it.
   */
  attentionAlerts: boolean | null;
  /**
   * When the stint that ended began, sent while the session is in attention (`attention.workingStartedAt`; '' outside
   * attention, from a computer that sends no start times, and when the attention came from idle or its start is
   * unknown).
   */
  attentionWorkingStartedAt: string;

  actions: GhostexSessionActions;
};

/** `attention.kind`: a finished turn or a wait for the user; a bell counts as `needsInput`. */
export type GhostexAttentionKind = '' | 'finished' | 'needsInput';
/**
 * The summary fields a computer announces in its `capabilities` object. A flag that is not `true`, or an absent
 * object, marks a computer whose summary lacks the field: there, the field's absence says nothing.
 */
export type GhostexSummaryCapabilities = {
  /** Sessions carry `awaitingAnswer` (an open question card). */
  awaitingAnswer: boolean;
  /** A session's `attention` carries `notificationId`, the feed row written for it, once that row exists. */
  attentionNotificationId: boolean;
};

/** The capabilities of a computer whose summary the phone does not hold (yet): it announces nothing. */
export const NO_SUMMARY_CAPABILITIES: GhostexSummaryCapabilities = {
  awaitingAnswer: false,
  attentionNotificationId: false,
};

/** An open question card or a counted question; callers gate the card field by the computer's capability. */
export function hasQuestion(pendingQuestionCount: number, awaitingAnswer: boolean): boolean {
  return pendingQuestionCount > 0 || awaitingAnswer;
}

export type GhostexMobileSummary = {
  /** Only zmx-backed sessions with a non-empty sessionId, wire order preserved. */
  sessions: GhostexSession[];
  projects: GhostexProject[];
  recentProjects: GhostexRecentProject[];
  agents: GhostexAgentLauncher[];
  quickActionsByProject: Record<string, GhostexQuickAction[]>;
  /**
   * The computer's Global Actions (`globalQuickActions`), listed in every project's Actions… menu after the
   * project's own. Empty unless `globalQuickActionsSupported`; a missing key is an empty list.
   */
  globalQuickActions: GhostexQuickAction[];
  /**
   * `capabilities.globalQuickActions === true`: the answering `ghostex` lists Global Actions and runs them with
   * `run-action --scope global`. Without it no Global Action is shown or run.
   */
  globalQuickActionsSupported: boolean;
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
  /** The computer's workspaces; null on a daemon without workspaces (nothing is filtered then). */
  workspaces: GhostexWorkspaces | null;
  /**
   * Derived: workspaceGroups present OR any raw session carries a sortOrder.
   * When true the payload is pre-sorted like the desktop sidebar and must not
   * be re-sorted on device.
   */
  preserveSessionOrder: boolean;
  /**
   * The computer's switched-on built-in features (`builtInFeatures`, such as `readAloud`); empty
   * from a computer too old to send the list, which means every one is off.
   */
  builtInFeatures: string[];
  /**
   * The computer's switched-off built-in features (`builtInFeaturesOff`, such as `voiceAgent`);
   * absent from a computer too old to send it, which leaves features that are on by default on
   * (`src/voice/featureSwitch.ts`).
   */
  builtInFeaturesOff?: string[];
  /**
   * Where a session link opens, from the computer's Settings > Browser > Open session links in:
   * `embedded` (the phone's own browser view, the default) or `external` (its default browser).
   */
  sessionLinkOpenTarget?: 'embedded' | 'external';
  /**
   * The computer's Settings > Session Cards > Session links in the sidebar
   * (`always`, `selected`, `badge`, `open` or `off`; `badge` when absent).
   */
  sidebarSessionLinks?: string;
  /** The computer's Advanced > Dim sleeping sessions: a sleeping row fades to half strength. Off when absent. */
  dimSleepingSessions?: boolean;
  /**
   * The computer's Hide test files in Changes (`changesHideTestFiles`): the Changes screen starts
   * with test files hidden. Off when absent.
   */
  changesHideTestFiles?: boolean;
  /**
   * The computer's Settings > Agents > Remember the agent you pick (`space` or `everywhere`); absent
   * means per project, the default (src/components/sessions/agentChoice.ts).
   */
  newSessionAgentScope?: 'space' | 'everywhere';
  /**
   * The computer's Settings > Sidebar & Sessions > Sidebar: `unified` draws the session list as the
   * Unified sidebar (contract/unified/); absent means the Project sidebar, the default.
   */
  sidebarView?: 'project' | 'unified';
  /** The Unified sidebar's Working section switch; on unless the computer sends `false`. */
  unifiedWorkingSection?: boolean;
  /** Group by Project in the Unified sidebar. */
  unifiedGroupByProject?: boolean;
  /** Repository keys in the order the user arranged the project groups. */
  unifiedProjectOrder?: string[];
  /** The Unified sidebar's own hover strip, which the phone's swipe buttons follow. */
  unifiedSessionCardHoverButtons?: unknown;
  /** The Project sidebar leaves projects with no sessions out, behind a Show all projects row. */
  sidebarHideProjectsWithoutSessions?: boolean;
  /** The home project (Main Hub's) shows at the top of every Space, not only its own. */
  chiefShowOnAllSpaces?: boolean;
  /** New Chat and Change Agent ask first; on unless the computer sends `false`. */
  chiefConfirmNewChat?: boolean;
  /** The computer's Enable session parking; on unless the computer sends `false`. */
  enableSessionParking?: boolean;
  /**
   * The computer's Advanced > Worktree sessions show in their project: the Project list draws a
   * worktree's sessions under its parent project (contract/grouping.ts). On unless the computer sends `false`.
   */
  worktreeSessionsInProject?: boolean;
  /**
   * The computer's Merge copies of the same repository (CDXC:RemoteMachines 2026-11-09 in
   * packages/gx-core/src/sidebar_view/merged.rs): the Project list draws two folders that are copies
   * of one repository as one project. On unless the computer sends `false`.
   */
  mergeRepositoryCopies?: boolean;
  /** The computer's Separate by machine, under which its list never merges copies. Off unless the computer sends `true`. */
  separateByMachine?: boolean;
  /**
   * The computer's Advanced > Pinned order (CDXC:Sidebar 2026-11-07 in packages/gx-core/src/sidebar_view/inputs.rs):
   * `manual` keeps the order pinned sessions were dragged into, `recent` puts the one that came back last first.
   * Manual unless the computer sends `recent`.
   */
  pinnedSessionOrder?: 'manual' | 'recent';
  /** The capability flags the phone uses; all off from a computer that sends none. */
  capabilities: GhostexSummaryCapabilities;
};

/**
 * The sessions the lists show: every one but side chats, which their main chat's Side chats pill
 * lists instead (gx-protocol `PresentationSession::listed_in_sidebar`, the desktop's same rule).
 * Chief of Staff is a row too, pinned first in Main Hub (contract/grouping.ts).
 */
export function visibleSessions<T extends { sideChatParentSessionId?: string }>(sessions: readonly T[]): T[] {
  return sessions.filter((session) => !session.sideChatParentSessionId);
}
