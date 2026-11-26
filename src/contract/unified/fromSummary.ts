/**
 * The Unified list's inputs from the phone's per-computer summaries: each computer's projects,
 * sessions and Spaces as its own Workspace shows them, in the terms of ./build.ts.
 */

import {
  hasQuestion,
  visibleSessions,
  type GhostexMobileSummary,
  type GhostexSession,
  type GhostexSummaryCapabilities,
} from '../mobileSummary';
import { withoutGbots } from '../gbotsFilter';
import { effectiveSessionTag } from '../sessionTags';
import { collectionIdByProjectId, orderedSpaces } from '../../spaces/spaceFilter';
import { filterSummaryForWorkspace } from '../../workspaces/workspaceFilter';
import {
  buildUnifiedList,
  EMPTY_UNIFIED_FILTER,
  isUnifiedFilterEmpty,
  type UnifiedFilter,
  type UnifiedFilterOptions,
  type UnifiedMachineInput,
  type UnifiedSessionInput,
  type UnifiedSettings,
  type UnifiedView,
} from './build';
import { NO_UNIFIED_FOLDS, type UnifiedFolds } from './tree';

/** One computer the phone holds a summary for. */
export type UnifiedComputer = {
  machineId: string;
  label: string;
  summary: GhostexMobileSummary;
  /** The Workspace the phone shows for it, or null while it has none. */
  workspaceId: string | null;
};

function millis(value: string | undefined): number | null {
  if (value === undefined || value === '') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isBrowserSession(session: GhostexSession): boolean {
  return session.kind === 'browser' || session.surface === 'browser';
}

/** What a main session's hidden side chats wait on (gx-core sidebar_view/rows.rs `SideChatNeeds`). */
export type SideChatNeeds = { questions: number; awaitingAnswer: boolean; approval: boolean };

/**
 * The questions and approvals each main session's side chats wait on, by `<projectId>\n<sessionId>` of the main
 * session (gx-core rows.rs `side_chat_needs`). A side chat is not a row of the list, so its main session's row counts
 * them as its own, as the desktop's row does (CDXC:SideChats 2026-11-02 there).
 */
export function sideChatNeedsOf(
  sessions: readonly GhostexSession[],
  capabilities: GhostexSummaryCapabilities,
): Map<string, SideChatNeeds> {
  const needs = new Map<string, SideChatNeeds>();
  for (const session of sessions) {
    if (session.sideChatParentSessionId === '') continue;
    const question = hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer);
    if (!question && session.awaitingApproval !== true) continue;
    const key = `${session.projectId ?? ''}\n${session.sideChatParentSessionId}`;
    const entry = needs.get(key) ?? { questions: 0, awaitingAnswer: false, approval: false };
    entry.questions += session.pendingQuestionCount;
    entry.awaitingAnswer ||= session.awaitingAnswer;
    entry.approval ||= session.awaitingApproval === true;
    needs.set(key, entry);
  }
  return needs;
}

/**
 * A session in the builder's terms, read by its computer's capabilities, keeping the phone's own record beside it;
 * `sideChats` is what its hidden side chats wait on, counted as its own.
 */
export function unifiedSessionInput(
  session: GhostexSession,
  capabilities: GhostexSummaryCapabilities,
  sideChats: SideChatNeeds | undefined = undefined,
): UnifiedSessionInput & { source: GhostexSession } {
  return {
    sessionId: session.sessionId,
    projectId: session.projectId ?? '',
    title: session.displayTitle,
    branch:
      session.gitBranch !== undefined && session.gitBranch.length > 0
        ? session.gitBranch
        : (session.work?.branch ?? ''),
    activity: session.activity,
    awaitingApproval: session.awaitingApproval === true || sideChats?.approval === true,
    hasQuestion: hasQuestion(
      session.pendingQuestionCount + (sideChats?.questions ?? 0),
      capabilities.awaitingAnswer && (session.awaitingAnswer || sideChats?.awaitingAnswer === true),
    ),
    modelSelectionFailed: session.modelSelectionFailed === true,
    // The desktop counts a program's `error` as Failed only once its turn is over (gx-core rows.rs).
    programStatusFailed: session.programStatusFailed === true && session.activity === 'attention',
    hasBackgroundWork: (session.backgroundWorkDetectedAt ?? '') !== '',
    attentionKind: session.attentionKind,
    attentionHandoverNeedsYou: session.attentionHandoverNeedsYou,
    sessionTag: effectiveSessionTag(session),
    isPinned: session.isPinned === true,
    isParked: session.isParked === true,
    isDraft: session.isDraft === true,
    isBrowser: isBrowserSession(session),
    coordinatorProjectId: session.coordinatorProjectId,
    coordinatorSessionId: session.coordinatorSessionId,
    threadState: session.coordinatorThreadState,
    attentionNeedsInput: session.attentionKind === 'needsInput',
    isCoordinator: session.isCoordinator,
    stuck: session.stuckSince.length > 0,
    quotaWaitState: session.quotaWaitState,
    quotaResetsAt: session.quotaResetsAt,
    globalRef: session.globalRef,
    remoteThreads: session.coordinatorRemoteThreads,
    createdMs: millis(session.createdAt),
    lastInteractionMs: millis(session.lastInteractionAt),
    workingStartedMs: millis(session.workingStartedAt),
    snoozedUntilMs: millis(session.snoozedUntil),
    sidebarOrder: session.sidebarOrder,
    work: session.work,
    source: session,
  };
}

/**
 * One computer's builder input. `alone` is a phone holding just this computer: like the
 * desktop's own computer, its cards then carry no computer name.
 */
export function unifiedMachineInput(computer: UnifiedComputer, alone: boolean): UnifiedMachineInput<GhostexSession> {
  // No GBot's folder or chat: the Unified list and every project picker list only the user's projects (contract/gbotsFilter.ts).
  const summary = withoutGbots(
    computer.workspaceId === null
      ? computer.summary
      : filterSummaryForWorkspace(computer.summary, computer.workspaceId),
  );
  // Before the side chats are hidden, what they wait on goes to their main sessions' rows.
  const sideChats = sideChatNeedsOf(summary.sessions, summary.capabilities);
  const collections = collectionIdByProjectId(summary);
  const pathById = new Map(summary.projects.map((project) => [project.projectId, project.path ?? '']));
  const spaces = orderedSpaces(summary.sidebarSpaces);
  return {
    machine: computer.machineId,
    isLocal: alone,
    label: computer.label,
    spaces:
      spaces.length === 0
        ? null
        : spaces.map((space) => ({
            spaceId: space.spaceId,
            name: space.name,
            memberProjectIds: space.memberProjectIds,
            memberCollectionIds: space.memberCollectionIds,
          })),
    // The computer's Active projects switch (src/spaces/activeProjects.ts), which the filter's star follows.
    activeProjects: summary.sidebarActiveProjects !== false,
    projects: summary.projects.map((project) => {
      const parent = project.worktreeParentProjectId;
      return {
        projectId: project.projectId,
        title: project.name ?? '',
        path: project.path ?? '',
        gitRemoteOriginUrl: project.gitRemoteOriginUrl ?? null,
        gitWorkTree: project.gitWorkTree,
        worktreeParentPath: parent === '' ? null : (pathById.get(parent) ?? null),
        parentProjectId: parent === '' ? null : parent,
        collectionId: collections.get(project.projectId) ?? null,
      };
    }),
    sessions: visibleSessions(summary.sessions).map((session) =>
      unifiedSessionInput(
        session,
        summary.capabilities,
        sideChats.get(`${session.projectId ?? ''}\n${session.sessionId}`),
      ),
    ),
  };
}

/** The filter without picks its options no longer offer (a computer gone, a Space deleted). */
export function filterWithinOptions(filter: UnifiedFilter, options: UnifiedFilterOptions): UnifiedFilter {
  const within = (picked: string[], offered: { key: string }[]) =>
    picked.filter((key) => offered.some((option) => option.key === key));
  return {
    repos: within(filter.repos, options.repos),
    machines: within(filter.machines, options.machines),
    spaces: within(filter.spaces, options.spaces),
    query: filter.query ?? '',
  };
}

/** The Unified list of every computer the phone holds a summary for. */
export function unifiedListOf(
  computers: UnifiedComputer[],
  settings: UnifiedSettings,
  filter: UnifiedFilter,
  nowMs: number,
  folds: UnifiedFolds = NO_UNIFIED_FOLDS,
  /** The session the phone has open, `machineId` and `sessionId`: never tucked behind an older-threads row. */
  focused: { machineId: string; sessionId: string } | null = null,
): UnifiedView<GhostexSession> & { filter: UnifiedFilter } {
  const inputs = computers.map((computer) => {
    const input = unifiedMachineInput(computer, computers.length === 1);
    if (focused === null || focused.machineId !== computer.machineId) return input;
    return {
      ...input,
      sessions: input.sessions.map((session) =>
        session.sessionId === focused.sessionId ? { ...session, isFocused: true } : session,
      ),
    };
  });
  // The options do not depend on the filter, so a pick they no longer offer is let go first.
  const everything = buildUnifiedList(inputs, settings, EMPTY_UNIFIED_FILTER, nowMs, folds);
  const kept = filterWithinOptions(filter, everything.options);
  const view =
    isUnifiedFilterEmpty(kept) && (kept.query ?? '').trim().length === 0
      ? everything
      : buildUnifiedList(inputs, settings, kept, nowMs, folds);
  return { ...view, filter: kept };
}
