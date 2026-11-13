/**
 * Drawer item builder: turns a normalized mobile summary plus collapse state
 * into the flat, typed item list the sessions drawer renders.
 * Source of truth: docs/specs/sessions-drawer.md §§2-3, mirrored from the
 * Android reference implementation (GhostexDrawerItem.buildItems).
 */

import { SessionCopy } from '../copy';
import {
  coordinatorBadges,
  coordinatorRowKey,
  nestCoordinatorThreads,
  type CoordinatorBadge,
  type RowNesting,
} from './coordinatorTree';
import { withoutGbots } from './gbotsFilter';
import { isNewSidebarSession, isSidebarDraftSectionSession } from './sessionDrafts';
import {
  displayStatus,
  hasQuestion,
  NO_SUMMARY_CAPABILITIES,
  type GhostexAgentLauncher,
  type GhostexMobileSummary,
  type GhostexProject,
  type GhostexProjectIcon,
  type GhostexQuickAction,
  type GhostexSession,
  type GhostexSessionGroup,
  type GhostexSummaryCapabilities,
  visibleSessions,
} from './mobileSummary';
import { folderInRepository, mergeRepoIdentities, projectRepoKey, repoIdentity } from './unified/repo';

// ---------------------------------------------------------------------------
// Item types.
// ---------------------------------------------------------------------------

/** Which drawer state a STATE_CARD stands in for; the screen picks the renderer by it. */
export type StateCardVariant = 'noMachines' | 'connecting' | 'failure' | 'empty';

export type StateCardItem = {
  type: 'STATE_CARD';
  key: string;
  title: string;
  body: string;
  actionHint: string;
  variant: StateCardVariant;
};

/**
 * No longer emitted: the sessions drawer shows ONE machine, chosen by the
 * machine tab strip (src/components/sessions/MachineTabs.tsx), instead of
 * stacking every machine behind collapsible headers. Kept as part of the item
 * contract; do not reintroduce the stacked layout.
 */
export type MachineHeaderItem = {
  type: 'MACHINE_HEADER';
  key: string;
  machineId: string;
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
};

/**
 * Desktop reference-sidebar section label ("Projects" above collections +
 * project cards).
 */
export type SectionLabelItem = {
  type: 'SECTION_LABEL';
  key: string;
  machineId: string;
  section: 'projects';
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
};

export type CollectionHeaderItem = {
  type: 'COLLECTION_HEADER';
  key: string;
  machineId: string;
  collectionId: string;
  title: string;
  /** "#rrggbb"; drives the tinted header + member rail. */
  color: string;
  collapsed: boolean;
  projectCount: number;
  /** Member projects that draw no session; known while the collection is folded and draws no cards (Hide projects without sessions). */
  projectsWithoutSessions: number;
  sessionCount: number;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
  /** Collapsed with the open session inside: the header carries the selected card look (desktop collections.rs `active`). */
  containsActive: boolean;
};

/** Where a merged entry's header or group acts (contract/mergedComputers.ts): another computer's copy. */
export type ActionTarget = { machineId: string; projectId: string };

export type ProjectHeaderItem = {
  type: 'PROJECT_HEADER';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  /**
   * In the one list of every computer: the copy its creating actions (New terminal, the agent button, the ⋯ menu)
   * go to, when it is not the list's own computer and project id. Folding stays with `machineId`.
   */
  actionTarget?: ActionTarget;
  /** In the one list of every computer: the computers whose copies the entry holds, when more than one. */
  machineIds?: string[];
  /** The home project: its header is Main Hub's row (components/sessions/ChiefRow.tsx). */
  isHome?: boolean;
  /** The computer's Chief, on the home project's header; `null` before its first open. */
  chief?: GhostexSession | null;
  /** Legacy per-session groupId carried for sparse payloads. */
  legacyGroupId: string;
  title: string;
  projectPath: string;
  collapsed: boolean;
  sessionCount: number;
  workingCount: number;
  attentionCount: number;
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  backgroundWorkCount: number;
  sleepingCount: number;
  /** Awake (running terminal/browser) count for the collapsed count pills. */
  awakeCount: number;
  /** Collapsed with the open session inside, its session groups included: the header carries the selected card look (desktop project_header.rs `collapsed_active`). */
  containsActive: boolean;
  /** Set when the project renders inside a colored collection panel. */
  collectionColor?: string;
  /** Identity icon inputs, ranked by the row renderer like the desktop does. */
  icon: GhostexProjectIcon;
  /** Workspace theme color ("#rrggbb"), or "" — tints the project's rail. */
  themeColor: string;
  /**
   * Header launcher data (desktop agent split-button + actions menu): the
   * global agent launcher rows and this project's quick actions. Empty for
   * projects without a stable projectId. The computer's Global Actions are not
   * carried here; the menu reads them from the current summary.
   */
  agents: GhostexAgentLauncher[];
  quickActions: GhostexQuickAction[];
  /**
   * The folders of one repository this computer's list merged into this entry (`mergeRepositoryCopyBuckets`), the
   * entry's own first; only when there are two or more. The New Coordinator form's Folder row lists them.
   */
  copies?: ProjectCopy[];
  /** The folder New Coordinator starts on: the one holding the entry's newest session, else the entry's own. */
  defaultCopyProjectId?: string;
};

/** One folder of a merged project (`ProjectHeaderItem.copies`). */
export type ProjectCopy = {
  projectId: string;
  path: string;
  /** The folder's name, or the end of its path that tells it from another copy with the same name. */
  label: string;
};

export type ProjectEmptyItem = {
  type: 'PROJECT_EMPTY';
  key: string;
  machineId: string;
  projectKey: string;
  text: string;
  collectionColor?: string;
};

export type GroupHeaderItem = {
  type: 'GROUP_HEADER';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  groupId: string;
  /** In the one list of every computer: the computer and project id the group's actions go to (see ProjectHeaderItem). */
  actionTarget?: ActionTarget;
  /** Collapse key: `${projectKey}|${groupId}` (persisted per machine). */
  groupCollapseKey: string;
  title: string;
  count: number;
  collapsed: boolean;
  /** Collapsed with the open session inside: drawn like a collapsed project holding it. */
  containsActive: boolean;
  /** The group's header counts; a user-made group draws a project header's counts on the desktop. */
  status: Pick<
    SessionCounts,
    'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'questionCount' | 'approvalCount' | 'awakeCount'
  >;
  collectionColor?: string;
};

export type SessionItem = {
  type: 'SESSION';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  groupId: string;
  projectTitle: string;
  projectPath: string;
  session: GhostexSession;
  /** The capabilities of the computer's summary, which the row's question rule reads (`hasQuestion`). */
  capabilities: GhostexSummaryCapabilities;
  collectionColor?: string;
  /** The row's place in its coordinator's tree; absent on an ordinary top-level row. */
  nesting?: RowNesting;
  /** On a coordinator row: its crew badge. */
  coordinatorBadge?: CoordinatorBadge;
  /** A row of a user-made session group, drawn indented under the group with a tree line. */
  inSessionGroup?: boolean;
  /**
   * The worktree a session runs in, on a row its parent project lists (`foldWorktreeBuckets`):
   * its branch, else its folder's name. Absent everywhere else.
   */
  worktree?: string;
  /**
   * In the one list of every computer, a row given back its own computer (drawerModel.ts `withOrigins`): the
   * coordinatorRowKey of the list's copy, which the list's folds were read under. That copy's project can carry the
   * entry's id (contract/mergedComputers.ts renames a merged copy's project), so the row's own `session` gives another
   * key. Absent: `coordinatorRowKey(session)`. Read it through `sessionItemCoordinatorKey`.
   */
  listCoordinatorKey?: string;
};

/** The key a SESSION row's coordinator fold is saved and read under (`collapsedCoordinatorKeys`). */
export function sessionItemCoordinatorKey(item: Pick<SessionItem, 'session' | 'listCoordinatorKey'>): string {
  return item.listCoordinatorKey ?? coordinatorRowKey(item.session);
}

/**
 * In-project kind disclosure, mirroring the desktop
 * ProjectSessionSectionToggle: an uppercase Browser / Pinned / Sessions label
 * above the first row of that kind, collapsing only its own rows.
 */
export type SessionKindLabelItem = {
  type: 'SESSION_KIND_LABEL';
  key: string;
  machineId: string;
  projectKey: string;
  section: SessionKindSection;
  /** Collapse key: `${projectKey}|${section}` (persisted per machine). */
  kindCollapseKey: string;
  label: string;
  collapsed: boolean;
  /** What the heading draws while collapsed. */
  status: SectionStatusCounts;
  collectionColor?: string;
};

/**
 * The quiet row at the end of an expanded coordinator's threads that lists its older ones (or
 * tucks them away again); coordinatorTree.ts decides which threads are older.
 */
export type CoordinatorOlderItem = {
  type: 'COORDINATOR_OLDER';
  key: string;
  machineId: string;
  projectKey: string;
  /** The coordinator's coordinatorRowKey(), which the shown state is remembered under. */
  coordinatorKey: string;
  /** The coordinator's own depth; the row sits one level in. */
  depth: number;
  /** The tree lines that run past the row, toward the coordinator's next sibling or an ancestor's. */
  passingLines: number;
  label: string;
  collectionColor?: string;
  /** The coordinator's session group, so a row of a user-made group stays among that group's indented rows. */
  groupId: string;
  inSessionGroup?: boolean;
};

export type DrawerItem =
  | StateCardItem
  | MachineHeaderItem
  | SectionLabelItem
  | CollectionHeaderItem
  | ProjectHeaderItem
  | ProjectEmptyItem
  | GroupHeaderItem
  | SessionKindLabelItem
  | SessionItem
  | CoordinatorOlderItem;

export type DrawerItemType = DrawerItem['type'];

// ---------------------------------------------------------------------------
// Keys and helpers.
// ---------------------------------------------------------------------------

/** Project key derivation: `id:` → `path:` → `name:` → `session:` fallback. */
export function projectKeyForSession(session: GhostexSession): string {
  if (session.projectId.length > 0) return `id:${session.projectId}`;
  if (session.projectPath.length > 0) return `path:${session.projectPath}`;
  if (session.projectName.length > 0) return `name:${session.projectName}`;
  return `session:${session.sessionId}`;
}

export function groupCollapseKey(projectKey: string, groupId: string): string {
  return `${projectKey}|${groupId}`;
}

/** CDXC:Mobile 2026-09-12 DECISION:
 * User: parked sessions need their own section on mobile, with a Park action.
 * Keep the project-level Parked disclosure accessible independently of ordinary row clipping and named groups.
 */
export type SessionKindSection = 'browser' | 'pinned' | 'sessions' | 'drafts' | 'parked' | 'working' | 'snoozed';

export const SESSION_KIND_LABELS: Readonly<Record<SessionKindSection, string>> = {
  browser: SessionCopy.browserKindLabel,
  pinned: SessionCopy.pinnedKindLabel,
  sessions: SessionCopy.sessionsKindLabel,
  drafts: SessionCopy.draftsKindLabel,
  parked: SessionCopy.parkedKindLabel,
  working: SessionCopy.workingKindLabel,
  snoozed: SessionCopy.snoozedKindLabel,
};

/** What decides a row's section beyond the row itself: the synced switches, and the rows held out of Working. */
export type SectionRules = {
  /** Enable session parking (`enableSessionParking`): off, a parked row sits where it would unparked. */
  parking: boolean;
  /** Group working sessions (`groupWorkingSessions`). */
  groupWorking: boolean;
  /** Sessions Group working sessions leaves where they are (gx-core `held_out_of_working`), by session id. */
  held?: ReadonlySet<string>;
};

const DEFAULT_SECTION_RULES: SectionRules = { parking: true, groupWorking: false };

/** Sections listed apart from a project's ordinary rows and never inside a session group. */
const SECTIONS_APART: readonly SessionKindSection[] = ['drafts', 'parked', 'snoozed'];

/** Sections folded until opened (their open state is kept with Parked's in collapseStore). */
const FOLDED_FIRST: readonly SessionKindSection[] = ['working', 'parked', 'snoozed'];

/** gx-core `session_is_snoozed`: a wake time still ahead; a past one never hides a session. */
export function isSnoozedSession(session: GhostexSession, nowMs: number = Date.now()): boolean {
  const wake = Date.parse(session.snoozedUntil ?? '');
  return Number.isFinite(wake) && wake > nowMs;
}

/**
 * gx-core `is_grouped_working`: the agent works and nothing on the row waits for the user (a question, an approval,
 * a failed model change or program).
 */
function isGroupedWorking(session: GhostexSession): boolean {
  return (
    session.activity === 'working' &&
    session.awaitingAnswer !== true &&
    session.awaitingApproval !== true &&
    session.modelSelectionFailed !== true &&
    session.programStatusFailed !== true
  );
}

/**
 * gx-core `section_of` (sidebar_view/ordering.rs): Browser, Snoozed, Parked (while parking is on), Drafts, Pinned,
 * Working (while Group working sessions is on), else Sessions.
 */
export function sessionKindSection(
  session: GhostexSession,
  nowMs: number = Date.now(),
  rules: SectionRules = DEFAULT_SECTION_RULES,
): SessionKindSection {
  if (session.kind === 'browser' || session.surface === 'browser') return 'browser';
  if (isSnoozedSession(session, nowMs)) return 'snoozed';
  if (rules.parking && session.isParked) return 'parked';
  if (isSidebarDraftSectionSession(session, nowMs)) return 'drafts';
  if (session.isPinned) return 'pinned';
  if (rules.groupWorking && rules.held?.has(session.sessionId) !== true && isGroupedWorking(session)) return 'working';
  return 'sessions';
}

/**
 * gx-core `held_out_of_working`: the open session and every coordinator above it stay in their own section while
 * their agents work, so opening a thread never hides it inside its working coordinator's block.
 */
export function heldOutOfWorking(
  sessions: readonly GhostexSession[],
  isActive: (session: GhostexSession) => boolean,
): Set<string> {
  const held = new Set<string>();
  let current = sessions.find(isActive);
  for (let step = 0; current !== undefined && step < sessions.length; step += 1) {
    if (held.has(current.sessionId)) break;
    held.add(current.sessionId);
    const parent: GhostexSession = current;
    current = sessions.find(
      (candidate) =>
        candidate.sessionId === parent.coordinatorSessionId &&
        (parent.coordinatorProjectId === '' || candidate.projectId === parent.coordinatorProjectId),
    );
  }
  return held;
}

export function sessionKindCollapseKey(projectKey: string, section: SessionKindSection): string {
  return `${projectKey}|${section}`;
}

export function stateCardItem(
  variant: StateCardVariant,
  title: string,
  body: string,
  actionHint: string,
): StateCardItem {
  return { type: 'STATE_CARD', key: 'state-card', title, body, actionHint, variant };
}

export function machineHeaderItem(
  machineId: string,
  title: string,
  collapsed: boolean,
  counts: Pick<
    SessionCounts,
    'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'questionCount' | 'approvalCount' | 'awakeCount'
  >,
): MachineHeaderItem {
  return {
    type: 'MACHINE_HEADER',
    key: `machine:${machineId}`,
    machineId,
    title,
    collapsed,
    workingCount: counts.workingCount,
    attentionCount: counts.attentionCount - counts.questionCount,
    questionCount: counts.questionCount,
    approvalCount: counts.approvalCount,
    backgroundWorkCount: counts.backgroundWorkCount,
    awakeCount: counts.awakeCount,
  };
}

function displayProjectName(session: GhostexSession): string {
  if (session.projectName.length > 0) return session.projectName;
  if (session.projectPath.length > 0) return session.projectPath;
  return 'Ungrouped';
}

function projectDisplayName(project: GhostexProject): string {
  if (project.name !== undefined && project.name.length > 0) return project.name;
  if (project.path !== undefined && project.path.length > 0) return project.path;
  return 'Project';
}

function groupsForProject(summary: GhostexMobileSummary, projectId: string): GhostexSessionGroup[] {
  if (projectId.length === 0 || summary.workspaceGroups === null) return [];
  const projectGroups = summary.workspaceGroups.projects?.[projectId]?.groups;
  if (projectGroups === undefined) return [];
  const groups: GhostexSessionGroup[] = [];
  for (const group of projectGroups) {
    if (group.groupId.length === 0) continue;
    groups.push({
      groupId: group.groupId,
      title: group.title !== undefined && group.title.length > 0 ? group.title : 'Group',
      sessionIds: group.sessionIds ?? [],
    });
  }
  return groups;
}

/**
 * In-project display ordering, mirroring the desktop sidebar's default
 * "lastActivity" layout (packages/shared/active-sessions-sort.ts): browser-kind →
 * pinned (saved order) → drafts → new sessions newest-first → attention(2) > working(1) > idle(0) → most recent
 * lastInteractionAt → parked. The wire order (server sortOrder) is the stable
 * base, which matches the desktop's saved manual order.
 */
export function compareForSidebarOrder(
  left: GhostexSession,
  right: GhostexSession,
  nowMs: number = Date.now(),
  pinnedOrder: 'manual' | 'recent' = 'manual',
  /** Enable session parking: off, a parked row is ordered as an ordinary one. */
  parking: boolean = true,
): number {
  const kindDelta = sessionKindRank(left) - sessionKindRank(right);
  if (kindDelta !== 0) return kindDelta;
  const leftParked = parking && left.isParked === true;
  const rightParked = parking && right.isParked === true;
  const parkedDelta = Number(leftParked) - Number(rightParked);
  if (parkedDelta !== 0) return parkedDelta;
  // CDXC:Sessions 2026-09-12 SEE-ALSO: packages/shared/active-sessions-sort.ts owns the decision to sort Parked by activity time alone, newest first, on every client.
  if (leftParked && rightParked) {
    return (
      parseTimestamp(right.lastInteractionAt) - parseTimestamp(left.lastInteractionAt) ||
      left.sessionId.localeCompare(right.sessionId)
    );
  }
  const leftDraft = sessionKindSection(left, nowMs) === 'drafts';
  const rightDraft = sessionKindSection(right, nowMs) === 'drafts';
  if (leftDraft !== rightDraft) {
    return leftDraft ? (right.isPinned ? 1 : -1) : left.isPinned ? -1 : 1;
  }
  if (leftDraft && rightDraft) return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  const pinnedDelta = pinnedRank(left) - pinnedRank(right);
  if (pinnedDelta !== 0) return pinnedDelta;
  // CDXC:Sidebar 2026-11-07 SEE-ALSO: packages/gx-core/src/sidebar_view/ordering.rs `sort_pinned`. Manual follows
  // the dragged order (`sidebarOrder`), which also places a worktree's folded sessions among their parent's; a row
  // with none keeps its wire place after the numbered ones. Most recently updated puts the one that came back last first.
  // CDXC:Chief 2026-11-08 SEE-ALSO: the DECISION in packages/gx-core/src/sidebar_view/ordering.rs `sort_pinned`:
  // Chief of Staff leads the pinned rows.
  const chiefDelta = Number(right.isChief) - Number(left.isChief);
  if (left.isPinned && right.isPinned && chiefDelta !== 0) return chiefDelta;
  if (left.isPinned && right.isPinned) {
    if (pinnedOrder === 'recent') {
      return pinnedCameBackMs(right) - pinnedCameBackMs(left) || left.sessionId.localeCompare(right.sessionId);
    }
    return (left.sidebarOrder ?? Number.MAX_SAFE_INTEGER) - (right.sidebarOrder ?? Number.MAX_SAFE_INTEGER);
  }
  const leftNew = sessionKindRank(left) !== 0 && isNewSidebarSession(left, nowMs);
  const rightNew = sessionKindRank(right) !== 0 && isNewSidebarSession(right, nowMs);
  if (leftNew !== rightNew) return Number(rightNew) - Number(leftNew);
  if (leftNew && rightNew) return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  const priorityDelta = activityPriority(right) - activityPriority(left);
  if (priorityDelta !== 0) return priorityDelta;
  const timeDelta = parseTimestamp(right.lastInteractionAt) - parseTimestamp(left.lastInteractionAt);
  if (timeDelta > 0) return 1;
  if (timeDelta < 0) return -1;
  return 0;
}

/** When a session last came back to the user, as gx-core `came_back_ms` reads it (the Unified list's clock). */
function pinnedCameBackMs(session: GhostexSession): number {
  const created = parseTimestamp(session.createdAt);
  const moment =
    session.activity === 'working'
      ? parseTimestamp(session.workingStartedAt ?? session.lastInteractionAt)
      : parseTimestamp(session.lastInteractionAt);
  return Math.max(created, moment);
}

function sessionKindRank(session: GhostexSession): number {
  return session.kind === 'browser' || session.surface === 'browser' ? 0 : 1;
}

function pinnedRank(session: GhostexSession): number {
  return session.isPinned ? 0 : 1;
}

function activityPriority(session: GhostexSession): number {
  const status = displayStatus(session);
  if (status === 'attention') return 2;
  if (status === 'working') return 1;
  return 0;
}

function parseTimestamp(value: string): number {
  if (value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function stableSort<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const delta = compare(a.item, b.item);
      return delta !== 0 ? delta : a.index - b.index;
    })
    .map((entry) => entry.item);
}

// ---------------------------------------------------------------------------
// Builder.
// ---------------------------------------------------------------------------

/**
 * Awake mirror of the desktop's getAwakeTerminalAndBrowserCount: sessions whose
 * lifecycle is "running" (live, not sleeping, not done/error).
 */
function isAwakeSession(session: GhostexSession): boolean {
  if (!session.isLive || session.isSleeping) return false;
  const status = displayStatus(session);
  return status !== 'sleep' && status !== 'sleeping' && status !== 'done' && status !== 'error';
}

export type SessionCounts = {
  workingCount: number;
  /** In attention or waiting on an answer; the header and tab views (`headerStatusCounts`, `tabStatusCounts`) leave the question rows out of the blue count and draw them pink. */
  attentionCount: number;
  /** Rows drawing the grey dot: idle with a background shell or monitor still running. */
  backgroundWorkCount: number;
  /** Rows with a question (`hasQuestion`: an open question card the computer announces, or a counted question); every one is also in `attentionCount`, unless it waits for approval (then it is in `approvalCount` alone). */
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  sleepingCount: number;
  awakeCount: number;
};

/**
 * What a Space or machine tab's overlapping dots draw (packages/gx-core/src/sidebar_view/assemble.rs): a
 * session with a pending question counts pink instead of blue, so the attention count leaves it out.
 */
export function tabStatusCounts(
  counts: Pick<
    SessionCounts,
    'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'questionCount' | 'approvalCount'
  >,
): {
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
  questionCount: number;
  approvalCount: number;
} {
  return {
    workingCount: counts.workingCount,
    attentionCount: counts.attentionCount - counts.questionCount,
    backgroundWorkCount: counts.backgroundWorkCount,
    questionCount: counts.questionCount,
    approvalCount: counts.approvalCount,
  };
}

/**
 * packages/gx-core/src/sidebar_view/view.rs `shows_background_work`: the row
 * draws the grey dot, so a header counts it.
 */
export function showsBackgroundWork(session: GhostexSession): boolean {
  return (
    session.backgroundWorkDetectedAt.length > 0 &&
    session.activity !== 'working' &&
    session.activity !== 'attention' &&
    !session.awaitingApproval
  );
}

/**
 * What a project, collection, section or group header's collapsed counts draw (packages/gx-core/src/sidebar_view/groups.rs
 * `group_summary`): a session with a pending question counts pink instead of blue, so the attention count leaves it out.
 */
export function headerStatusCounts(
  counts: Pick<
    SessionCounts,
    'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'questionCount' | 'approvalCount' | 'awakeCount'
  >,
): Pick<
  SessionCounts,
  'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'questionCount' | 'approvalCount' | 'awakeCount'
> {
  return { ...counts, attentionCount: counts.attentionCount - counts.questionCount };
}

/**
 * packages/gx-core/src/sidebar_view/groups.rs `group_summary`, the counts a
 * project, collection, Space or machine header draws. Read off the raw
 * activity the row draws, so a header never disagrees with its rows; a question
 * by the row's rule, read with the computer's `capabilities`.
 */
export function countSessions(
  sessions: readonly GhostexSession[],
  capabilities: GhostexSummaryCapabilities,
): SessionCounts {
  const counts: SessionCounts = {
    workingCount: 0,
    attentionCount: 0,
    backgroundWorkCount: 0,
    questionCount: 0,
    approvalCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
  };
  for (const session of sessions) {
    const status = displayStatus(session);
    const question = hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer);
    if (session.activity === 'working') counts.workingCount++;
    // A session waiting for approval counts in red only (gx-core `SessionRow::needs_you`).
    if (session.awaitingApproval) counts.approvalCount++;
    else if (session.activity === 'attention' || question) counts.attentionCount++;
    if (showsBackgroundWork(session)) counts.backgroundWorkCount++;
    if (question && !session.awaitingApproval) counts.questionCount++;
    if (status === 'sleep' || status === 'sleeping') counts.sleepingCount++;
    if (isAwakeSession(session)) counts.awakeCount++;
  }
  return counts;
}

/** What a collapsed in-project section heading draws (packages/gx-core/src/sidebar_view/sections.rs). */
export type SectionStatusCounts = {
  /** Every session of the section, including rows a compact list leaves out. */
  count: number;
  workingCount: number;
  /** In attention with no question pending; a question shows as the pink dot instead. */
  attentionCount: number;
  backgroundWorkCount: number;
  questionCount: number;
  /** Sessions waiting for approval (the red dot); never also in the attention or question counts. */
  approvalCount: number;
  /** The section's session ids, so the renderer can ring a collapsed section holding the selected session. */
  sessionIds: string[];
};

/**
 * packages/gx-core/src/sidebar_view/sections.rs `project_session_sections`, one section's counts; a question by the
 * row's rule, read with the computer's `capabilities`.
 */
export function countSectionSessions(
  sessions: readonly GhostexSession[],
  capabilities: GhostexSummaryCapabilities,
): SectionStatusCounts {
  const counts: SectionStatusCounts = {
    count: sessions.length,
    workingCount: 0,
    attentionCount: 0,
    backgroundWorkCount: 0,
    questionCount: 0,
    approvalCount: 0,
    sessionIds: sessions.map((session) => session.sessionId),
  };
  for (const session of sessions) {
    if (session.activity === 'working') counts.workingCount++;
    if (showsBackgroundWork(session)) counts.backgroundWorkCount++;
    // gx-core `SessionRow::needs_you`: red, else pink, else blue, each row in one count.
    if (session.awaitingApproval) counts.approvalCount++;
    else if (hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer)) {
      counts.questionCount++;
    } else if (session.activity === 'attention') counts.attentionCount++;
  }
  return counts;
}

/**
 * Per-machine roll-up for the machine tab strip: the working and attention
 * counts of every session the machine reports, before any Space filter, so an
 * unselected tab still says something needs the user (desktop machine-tabs.tsx).
 */
export function machineSessionCounts(summary: GhostexMobileSummary | null): SessionCounts {
  return countSessions(
    summary === null ? [] : visibleSessions(summary.sessions),
    summary?.capabilities ?? NO_SUMMARY_CAPABILITIES,
  );
}

export type DrawerBuildInput = {
  nowMs?: number;
  /** The session the phone has open on this machine, if any; a folded coordinator above it carries its highlight. */
  activeSessionId?: string | null;
  expandedDraftSessionKeys?: ReadonlySet<string>;
  machineId: string;
  summary: GhostexMobileSummary;
  /**
   * Expanded disclosure sets (persisted per machine). Absence = collapsed, so
   * a fresh install starts with every collection/project/group collapsed,
   * mirroring the requested first-start state.
   */
  expandedProjectKeys: ReadonlySet<string>;
  expandedCollectionIds: ReadonlySet<string>;
  /** Named-group expansion, keyed by groupCollapseKey(). */
  expandedGroupKeys: ReadonlySet<string>;
  /**
   * Collapsed in-project Browser / Pinned / Sessions disclosures, keyed by
   * sessionKindCollapseKey(). Presence = collapsed; all three default expanded
   * like the desktop sidebar's EXPANDED_PROJECT_SESSION_SECTIONS.
   */
  collapsedSessionKindKeys: ReadonlySet<string>;
  /** Parked starts collapsed on each app launch, matching the desktop sidebar. */
  expandedParkedSessionKeys?: ReadonlySet<string>;
  /** Coordinators whose threads are folded away, by coordinatorRowKey() (persisted per machine). */
  collapsedCoordinatorKeys?: ReadonlySet<string>;
  /** Coordinators whose older threads the user listed, by coordinatorRowKey() (persisted per machine). */
  expandedCoordinatorOlderKeys?: ReadonlySet<string>;
};

/** Puts each expanded coordinator's "N older threads" row after the last row of its tree. */
function withOlderThreadRows(items: DrawerItem[]): DrawerItem[] {
  const result: DrawerItem[] = [];
  const open: CoordinatorOlderItem[] = [];
  const close = (depth: number): void => {
    while (open.length > 0 && open[open.length - 1].depth >= depth) result.push(open.pop() as CoordinatorOlderItem);
  };
  for (const item of items) {
    close(item.type === 'SESSION' ? (item.nesting?.depth ?? 0) : -1);
    result.push(item);
    const nesting = item.type === 'SESSION' ? item.nesting : undefined;
    if (item.type !== 'SESSION' || nesting === undefined || nesting.olderThreads === 0 || nesting.collapsed) continue;
    open.push({
      type: 'COORDINATOR_OLDER',
      key: `older:${item.projectKey}:${item.session.sessionId}`,
      machineId: item.machineId,
      projectKey: item.projectKey,
      coordinatorKey: coordinatorRowKey(item.session),
      depth: nesting.depth,
      passingLines: nesting.passingLinesBelow,
      label: nesting.olderShown ? SessionCopy.hideOlderThreads : SessionCopy.olderThreads(nesting.olderThreads),
      collectionColor: item.collectionColor,
      groupId: item.groupId,
      inSessionGroup: item.inSessionGroup,
    });
  }
  close(-1);
  return result;
}

/**
 * CDXC:Worktrees 2026-11-06 SEE-ALSO: the DECISION in packages/gx-core/src/sidebar_view/worktree_fold.rs. While the computer's Worktree sessions show in their project is on (the default), the Project list moves every worktree project's sessions into its parent project's bucket and drops the worktree's own entry; a row there names its worktree's branch and still acts in the worktree's project. The Unified list groups worktrees by repository itself, so it never folds.
 */
function foldWorktreeBuckets(
  summary: GhostexMobileSummary,
  projectById: ReadonlyMap<string, GhostexProject>,
  sessionsByProjectKey: Map<string, GhostexSession[]>,
): Map<string, { project: GhostexProject; label: string }> {
  const worktreeOf = new Map<string, { project: GhostexProject; label: string }>();
  if (summary.worktreeSessionsInProject === false || summary.sidebarView === 'unified') return worktreeOf;
  for (const project of summary.projects) {
    const parent = projectById.get(project.worktreeParentProjectId);
    if (parent === undefined || parent.worktreeParentProjectId.length > 0) continue;
    const parentKey = `id:${parent.projectId}`;
    const ownKey = `id:${project.projectId}`;
    const parentBucket = sessionsByProjectKey.get(parentKey);
    if (parentBucket === undefined) continue;
    parentBucket.push(...(sessionsByProjectKey.get(ownKey) ?? []));
    sessionsByProjectKey.delete(ownKey);
    const branch = project.worktree?.branch ?? '';
    worktreeOf.set(project.projectId, {
      project,
      label: branch.length > 0 ? branch : (project.worktree?.name ?? projectDisplayName(project)),
    });
  }
  return worktreeOf;
}

/**
 * CDXC:RemoteMachines 2026-11-09 SEE-ALSO: the DECISIONs in packages/gx-core/src/sidebar_view/merged.rs (Q1352, #461, #518). While the computer's Merge copies of the same repository is on (the default) and Separate by machine is off, the Project list draws two folders of this computer that are copies of one repository (the same origin, opened at the same folder inside it) as one project: the first in the list's order keeps its entry, name and session groups, and the others' sessions are listed with its own. Off, each folder is its own project, as the computer draws it. A worktree and the home project never merge; the Unified list groups by repository itself. The entry remembers the folders it took in, which the New Coordinator form's Folder row offers.
 */
function mergeRepositoryCopyBuckets(
  summary: GhostexMobileSummary,
  projectById: ReadonlyMap<string, GhostexProject>,
  sessionsByProjectKey: Map<string, GhostexSession[]>,
): Map<string, GhostexProject[]> {
  const copiesOf = new Map<string, GhostexProject[]>();
  if (summary.mergeRepositoryCopies === false || summary.separateByMachine === true) return copiesOf;
  if (summary.sidebarView === 'unified') return copiesOf;
  const order: string[] = [];
  for (const projectId of [
    ...(summary.workspaceGroups?.projectOrder ?? []),
    ...summary.projects.map((project) => project.projectId),
  ]) {
    if (!order.includes(projectId) && projectById.has(projectId)) order.push(projectId);
  }
  const mergeable = order
    .map((projectId) => projectById.get(projectId)!)
    .filter((project) => project.isHome !== true && project.worktreeParentProjectId.length === 0);
  const identityOf = (project: GhostexProject) =>
    repoIdentity(project.gitRemoteOriginUrl, project.path ?? '', null, projectDisplayName(project));
  const canonical = mergeRepoIdentities(mergeable.map(identityOf));
  const entryOfKey = new Map<string, string>();
  for (const project of mergeable) {
    const identity = identityOf(project);
    const fromOrigin = !identity.key.startsWith('dir:');
    const folder = fromOrigin ? folderInRepository(project.path ?? '', project.gitRepositoryRootPath) : null;
    const key = projectRepoKey(canonical.get(identity.key)?.key ?? identity.key, folder);
    const ownKey = `id:${project.projectId}`;
    const entry = entryOfKey.get(key);
    if (entry === undefined) {
      entryOfKey.set(key, ownKey);
      copiesOf.set(ownKey, [project]);
      continue;
    }
    sessionsByProjectKey.get(entry)?.push(...(sessionsByProjectKey.get(ownKey) ?? []));
    sessionsByProjectKey.delete(ownKey);
    copiesOf.get(entry)?.push(project);
  }
  for (const [entry, copies] of copiesOf) if (copies.length < 2) copiesOf.delete(entry);
  return copiesOf;
}

function pathParts(path: string): string[] {
  return path.split(/[\\/]/).filter((part) => part.length > 0);
}

/** The shortest end of `path` (whole folder names) that none of `others` ends with. */
function distinguishingPath(path: string, others: readonly string[]): string {
  const parts = pathParts(path);
  const otherParts = others.map(pathParts);
  for (let take = 1; take <= parts.length; take += 1) {
    const tail = parts.slice(parts.length - take);
    const shared = otherParts.some(
      (other) => other.length >= take && other.slice(other.length - take).every((part, index) => part === tail[index]),
    );
    if (!shared) return tail.join('/');
  }
  return parts.join('/');
}

/**
 * An entry's folders as the New Coordinator form lists them, and the one it starts on: the folder of the entry's newest
 * session when that session is in one of them (a worktree session listed here is not), else the entry's own — the
 * desktop's rule (gx-core merged.rs `last_used_copy`).
 */
function projectCopies(
  copies: readonly GhostexProject[],
  sessions: readonly GhostexSession[],
): { copies: ProjectCopy[]; defaultProjectId: string } {
  const listed = copies.map((project, index) => {
    const path = project.path ?? '';
    const others = copies.filter((_, other) => other !== index).map((other) => other.path ?? '');
    return { projectId: project.projectId, path, label: distinguishingPath(path, others) || projectDisplayName(project) };
  });
  let newest: GhostexSession | null = null;
  for (const session of sessions) {
    if (newest === null || Date.parse(session.createdAt) > Date.parse(newest.createdAt)) newest = session;
  }
  const newestCopy = listed.find((copy) => copy.projectId === newest?.projectId);
  return { copies: listed, defaultProjectId: (newestCopy ?? listed[0]).projectId };
}

export function buildDrawerItems(input: DrawerBuildInput): DrawerItem[] {
  const {
    machineId,
    expandedProjectKeys,
    expandedCollectionIds,
    expandedGroupKeys,
    collapsedSessionKindKeys,
    expandedParkedSessionKeys = new Set<string>(),
    expandedDraftSessionKeys = new Set<string>(),
    collapsedCoordinatorKeys = new Set<string>(),
    expandedCoordinatorOlderKeys = new Set<string>(),
    nowMs = Date.now(),
    activeSessionId = null,
  } = input;
  // A GBot's folder and chats are drawn under Main Hub (contract/gbots.ts), never as a project (contract/gbotsFilter.ts).
  const summary = withoutGbots(input.summary);
  const isActive = (session: GhostexSession): boolean => session.sessionId === activeSessionId;
  const badges = coordinatorBadges(summary.sessions, nowMs);

  const projectById = new Map<string, GhostexProject>();
  for (const project of summary.projects) projectById.set(project.projectId, project);

  // Bucket sessions by project key. Insertion order preserves the wire session order. Chief of Staff
  // is listed in Main Hub even while its session still lives in the Ghostex config folder's project.
  const homeProject = summary.projects.find((project) => project.isHome === true);
  const sessionsByProjectKey = new Map<string, GhostexSession[]>();
  for (const session of visibleSessions(summary.sessions)) {
    const key =
      session.isChief && homeProject !== undefined ? `id:${homeProject.projectId}` : projectKeyForSession(session);
    const bucket = sessionsByProjectKey.get(key);
    if (bucket === undefined) sessionsByProjectKey.set(key, [session]);
    else bucket.push(session);
  }
  // Active projects stay visible even with zero sessions.
  for (const project of summary.projects) {
    const key = `id:${project.projectId}`;
    if (!sessionsByProjectKey.has(key)) sessionsByProjectKey.set(key, []);
  }

  const worktreeOf = foldWorktreeBuckets(summary, projectById, sessionsByProjectKey);
  const copiesOf = mergeRepositoryCopyBuckets(summary, projectById, sessionsByProjectKey);

  // Desktop display layout: the wire order (server sortOrder) is the stable
  // manual base; browser-first/pinned-first/draft-first/activity sorting is applied on top
  // exactly like the gpui sidebar's default "lastActivity" mode.
  for (const [key, bucket] of sessionsByProjectKey) {
    sessionsByProjectKey.set(
      key,
      stableSort(bucket, (left, right) =>
        compareForSidebarOrder(
          left,
          right,
          nowMs,
          summary.pinnedSessionOrder ?? 'manual',
          summary.enableSessionParking !== false,
        ),
      ),
    );
  }

  // Project order: workspaceGroups.projectOrder → projects array order →
  // leftovers in bucket insertion order.
  const orderedProjectKeys: string[] = [];
  const pushKey = (key: string): void => {
    if (sessionsByProjectKey.has(key) && !orderedProjectKeys.includes(key)) {
      orderedProjectKeys.push(key);
    }
  };
  for (const projectId of summary.workspaceGroups?.projectOrder ?? []) pushKey(`id:${projectId}`);
  for (const project of summary.projects) pushKey(`id:${project.projectId}`);
  for (const key of sessionsByProjectKey.keys()) pushKey(key);

  const items: DrawerItem[] = [];

  const emitProject = (projectKey: string, collectionColor?: string): void => {
    const allProjectSessions = sessionsByProjectKey.get(projectKey);
    if (allProjectSessions === undefined) return;
    const first = allProjectSessions.length > 0 ? allProjectSessions[0] : null;
    const project = projectKey.startsWith('id:') ? (projectById.get(projectKey.slice(3)) ?? null) : null;

    const projectId = project !== null ? project.projectId : first === null ? '' : first.projectId;
    const projectTitle =
      project !== null ? projectDisplayName(project) : first === null ? 'Project' : displayProjectName(first);
    const projectPath = project !== null ? (project.path ?? '') : first === null ? '' : first.projectPath;
    const legacyGroupId = first === null ? '' : first.groupId;
    const counts = countSessions(allProjectSessions, summary.capabilities);
    const icon: GhostexProjectIcon =
      project !== null
        ? project.icon
        : { imageDataUrl: '', discoveredIconDataUrl: '', discoveredIconRef: '', glyph: '', glyphColor: '', isWorktree: false };

    const namedGroups = groupsForProject(summary, projectId);
    const groupedSessionIds = new Set(namedGroups.flatMap((group) => group.sessionIds));
    // The synced Enable session parking and Group working sessions (settingsSync/sidebarOrganization.ts).
    const rules: SectionRules = {
      parking: summary.enableSessionParking !== false,
      groupWorking: summary.groupWorkingSessions === true,
      held: summary.groupWorkingSessions === true ? heldOutOfWorking(allProjectSessions, isActive) : undefined,
    };
    const inNamedGroup = (session: GhostexSession): boolean => {
      const section = sessionKindSection(session, nowMs, rules);
      return !SECTIONS_APART.includes(section) && section !== 'working' && groupedSessionIds.has(session.sessionId);
    };
    /*
     * Coordinator trees (coordinatorTree.ts, gx-core nest_threads): each
     * thread follows its coordinator and takes its section. A named group's
     * members are nested inside that group below.
     */
    const kindSection = (session: GhostexSession): SessionKindSection => sessionKindSection(session, nowMs, rules);
    const tree = nestCoordinatorThreads(
      allProjectSessions.filter((session) => !inNamedGroup(session)),
      summary.capabilities,
      collapsedCoordinatorKeys,
      kindSection,
      expandedCoordinatorOlderKeys,
      nowMs,
      isActive,
    );
    const nesting = new Map(tree.nesting);
    const sectionOf = (session: GhostexSession): SessionKindSection =>
      tree.sections.get(coordinatorRowKey(session)) ?? kindSection(session);
    const isFolded = (session: GhostexSession): boolean => nesting.get(coordinatorRowKey(session))?.folded === true;
    const parkedSessions = tree.sessions.filter((session) => sectionOf(session) === 'parked');
    const snoozedSessions = tree.sessions.filter((session) => sectionOf(session) === 'snoozed');
    const draftSessions = tree.sessions.filter((session) => sectionOf(session) === 'drafts');
    const workingSessions = tree.sessions.filter((session) => sectionOf(session) === 'working');
    const projectSessions = [
      ...tree.sessions.filter((session) => ![...SECTIONS_APART, 'working'].includes(sectionOf(session))),
      ...allProjectSessions.filter(inNamedGroup),
    ];
    /*
     * What a section heading counts: every session of that section, including
     * the threads of a folded coordinator, less the members of named groups, which
     * the desktop draws as groups of their own.
     */
    const sectionPool = tree.sessions;
    /*
     * CDXC:Sidebar 2026-10-27 SEE-ALSO: the 2026-09-24 decision in apps/desktop/src/app/native_sidebar/rows.rs (`hide_lone_sessions_heading`). A project whose own rows are all ordinary sessions (no browser, pinned, draft or parked rows; its session groups are drawn apart) shows no Sessions heading, so nothing can fold those rows away either.
     */
    const ownSections = new Set(tree.sessions.map(sectionOf));
    const loneSessionsSection = ownSections.size === 1 && ownSections.has('sessions');
    const shownProjectSessions = projectSessions.filter((session) => !isFolded(session));

    const collapsed = !expandedProjectKeys.has(projectKey);
    const merged = copiesOf.get(projectKey);
    const folders = merged !== undefined ? projectCopies(merged, allProjectSessions) : null;
    items.push({
      type: 'PROJECT_HEADER',
      key: `project:${projectKey}`,
      machineId,
      projectKey,
      projectId,
      isHome: project?.isHome === true,
      chief: project?.isHome === true ? (summary.sessions.find((session) => session.isChief) ?? null) : undefined,
      legacyGroupId,
      title: projectTitle,
      projectPath,
      collapsed,
      sessionCount: allProjectSessions.length,
      workingCount: counts.workingCount,
      attentionCount: counts.attentionCount - counts.questionCount,
      questionCount: counts.questionCount,
      approvalCount: counts.approvalCount,
      backgroundWorkCount: counts.backgroundWorkCount,
      sleepingCount: counts.sleepingCount,
      awakeCount: counts.awakeCount,
      containsActive: collapsed && allProjectSessions.some(isActive),
      collectionColor,
      icon,
      themeColor: project !== null ? project.themeColor : '',
      agents: projectId.length > 0 ? summary.agents : [],
      quickActions: projectId.length > 0 ? (summary.quickActionsByProject[projectId] ?? []) : [],
      ...(folders !== null ? { copies: folders.copies, defaultCopyProjectId: folders.defaultProjectId } : {}),
    });
    if (collapsed) return;

    if (allProjectSessions.length === 0) {
      items.push({
        type: 'PROJECT_EMPTY',
        key: `empty:${projectKey}`,
        machineId,
        projectKey,
        text: SessionCopy.emptyProjectRow,
        collectionColor,
      });
      return;
    }

    const sessionItem = (session: GhostexSession, groupId: string): SessionItem => {
      // A worktree session this project lists acts in its worktree's own project.
      const worktree = worktreeOf.get(session.projectId);
      if (worktree !== undefined) {
        return {
          type: 'SESSION',
          key: `session:${projectKey}:${session.sessionId}`,
          machineId,
          projectKey,
          projectId: worktree.project.projectId,
          groupId: session.groupId,
          projectTitle: projectDisplayName(worktree.project),
          projectPath: worktree.project.path ?? session.projectPath,
          session,
          capabilities: summary.capabilities,
          collectionColor,
          nesting: nesting.get(coordinatorRowKey(session)),
          coordinatorBadge: session.isCoordinator
            ? (badges.get(coordinatorRowKey(session)) ?? { count: 0, tone: 'idle' })
            : undefined,
          worktree: worktree.label,
        };
      }
      return sessionItemOf(session, groupId);
    };
    const sessionItemOf = (session: GhostexSession, groupId: string): SessionItem => ({
      type: 'SESSION',
      key: `session:${projectKey}:${session.sessionId}`,
      machineId,
      projectKey,
      projectId,
      groupId:
        groupId ||
        namedGroups.find((group) => group.sessionIds.includes(session.sessionId))?.groupId ||
        session.groupId,
      projectTitle,
      projectPath,
      session,
      capabilities: summary.capabilities,
      collectionColor,
      nesting: nesting.get(coordinatorRowKey(session)),
      coordinatorBadge: session.isCoordinator
        ? (badges.get(coordinatorRowKey(session)) ?? { count: 0, tone: 'idle' })
        : undefined,
    });

    /*
     * Desktop parity (session-group-section.tsx ProjectSessionSectionToggle):
     * The label sits above the first row of its kind, and collapsing one hides
     * only that kind's rows. Drafts and Parked are emitted separately so the
     * ordinary "Show N more" cap cannot hide their disclosures.
     */
    const emitSessionsWithKindLabels = (sessions: readonly GhostexSession[], groupId: string): void => {
      const labelledSections = new Set<SessionKindSection>();
      for (const session of sessions) {
        const section = sectionOf(session);
        if (section === 'sessions') emitDraftSection();
        const kindCollapseKey = sessionKindCollapseKey(projectKey, section);
        const unlabelled = section === 'sessions' && loneSessionsSection;
        // Drafts, Working, Parked and Snoozed start folded (gx-core sidebar_view/inputs.rs).
        const kindCollapsed = unlabelled
          ? false
          : section === 'drafts'
            ? !expandedDraftSessionKeys.has(kindCollapseKey)
            : FOLDED_FIRST.includes(section)
              ? !expandedParkedSessionKeys.has(kindCollapseKey)
              : collapsedSessionKindKeys.has(kindCollapseKey);
        if (!labelledSections.has(section) && !unlabelled) {
          labelledSections.add(section);
          items.push({
            type: 'SESSION_KIND_LABEL',
            key: `kind:${kindCollapseKey}`,
            machineId,
            projectKey,
            section,
            kindCollapseKey,
            label: SESSION_KIND_LABELS[section],
            collapsed: kindCollapsed,
            status: countSectionSessions(
              sectionPool.filter((candidate) => sectionOf(candidate) === section),
              summary.capabilities,
            ),
            collectionColor,
          });
        }
        if (kindCollapsed || isFolded(session)) continue;
        items.push(sessionItem(session, groupId));
      }
    };

    // Drafts, then Working, sit above the first Sessions row (gx-core sidebar_view/inputs.rs section order).
    let didEmitDraftSection = false;
    const emitDraftSection = (): void => {
      if (didEmitDraftSection) return;
      didEmitDraftSection = true;
      emitSessionsWithKindLabels(draftSessions, '');
      emitSessionsWithKindLabels(workingSessions, '');
    };

    if (namedGroups.length === 0) {
      /**
       * CDXC:Projects 2026-10-13 DECISION: User: "remove this feature, no more show less / show
       * more." A project and the Chats collection always list every session; the 6-row collapse,
       * its "Show N more" row and the saved collapsed lists are gone (gx-core sidebar_view/sections.rs
       * holds the desktop's half). Section headings still collapse.
       */
      emitSessionsWithKindLabels(shownProjectSessions, legacyGroupId);
      emitDraftSection();
      emitSessionsWithKindLabels(parkedSessions, '');
      emitSessionsWithKindLabels(snoozedSessions, '');
      return;
    }

    // Grouped project: ungrouped "main" sessions first, then named groups in
    // order with subsection ordering and new sessions first inside Sessions; other members keep sessionIds order.
    const sessionsById = new Map<string, GhostexSession>();
    for (const session of projectSessions) sessionsById.set(session.sessionId, session);
    const claimedSessionIds = new Set<string>();
    for (const group of namedGroups) {
      for (const sessionId of group.sessionIds) claimedSessionIds.add(sessionId);
    }
    emitSessionsWithKindLabels(
      projectSessions.filter((session) => !claimedSessionIds.has(session.sessionId)),
      legacyGroupId,
    );
    emitDraftSection();
    for (const group of namedGroups) {
      const groupSessions: GhostexSession[] = [];
      for (const sessionId of group.sessionIds) {
        const session = sessionsById.get(sessionId);
        if (session !== undefined) groupSessions.push(session);
      }
      if (groupSessions.length === 0) continue;
      groupSessions.sort(
        (left, right) =>
          sessionKindRank(left) - sessionKindRank(right) ||
          pinnedRank(left) - pinnedRank(right) ||
          (isNewSidebarSession(left, nowMs) || isNewSidebarSession(right, nowMs)
            ? compareForSidebarOrder(left, right, nowMs)
            : 0),
      );
      const groupTree = nestCoordinatorThreads(
        groupSessions,
        summary.capabilities,
        collapsedCoordinatorKeys,
        kindSection,
        expandedCoordinatorOlderKeys,
        nowMs,
        isActive,
      );
      for (const [key, value] of groupTree.nesting) nesting.set(key, value);
      const collapseKey = groupCollapseKey(projectKey, group.groupId);
      const groupCollapsed = !expandedGroupKeys.has(collapseKey);
      items.push({
        type: 'GROUP_HEADER',
        key: `group:${collapseKey}`,
        machineId,
        projectKey,
        projectId,
        groupId: group.groupId,
        groupCollapseKey: collapseKey,
        title: group.title,
        count: groupSessions.length,
        collapsed: groupCollapsed,
        containsActive: groupCollapsed && groupSessions.some(isActive),
        status: headerStatusCounts(countSessions(groupSessions, summary.capabilities)),
        collectionColor,
      });
      if (groupCollapsed) continue;
      for (const session of groupTree.sessions) {
        if (isFolded(session)) continue;
        items.push({ ...sessionItem(session, group.groupId), inSessionGroup: true });
      }
    }
    emitSessionsWithKindLabels(parkedSessions, '');
    emitSessionsWithKindLabels(snoozedSessions, '');
  };

  /*
   * Top-level layout mirrors the desktop reference sidebar: a "Projects"
   * section label with colored collection panels (members in project order)
   * followed by ungrouped project cards.
   */
  if (summary.sessions.length === 0 && summary.projects.length === 0) return items;

  const emittedProjectKeys = new Set<string>();

  const projectSessions = orderedProjectKeys.flatMap((projectKey) => sessionsByProjectKey.get(projectKey) ?? []);
  const projectCounts = countSessions(projectSessions, summary.capabilities);
  /*
   * Projects is the page itself, not a disclosure: collapsing it would leave
   * the drawer empty, so the header carries no caret and this section is
   * always emitted expanded.
   */
  items.push({
    type: 'SECTION_LABEL',
    key: 'section:projects',
    machineId,
    section: 'projects',
    title: SessionCopy.projectsSectionTitle,
    collapsed: false,
    workingCount: projectCounts.workingCount,
    attentionCount: projectCounts.attentionCount - projectCounts.questionCount,
    questionCount: projectCounts.questionCount,
    approvalCount: projectCounts.approvalCount,
    backgroundWorkCount: projectCounts.backgroundWorkCount,
    awakeCount: projectCounts.awakeCount,
  });

  /*
   * CDXC:Chief 2026-11-08 SEE-ALSO: the DECISIONs in packages/gx-core/src/sidebar_view/chief.rs and assemble.rs. The
   * home project leads the list, outside any collection, with Main Hub's row as its header.
   */
  for (const project of summary.projects) {
    const key = `id:${project.projectId}`;
    if (project.isHome !== true || !sessionsByProjectKey.has(key)) continue;
    emittedProjectKeys.add(key);
    emitProject(key);
  }

  for (const collection of summary.projectCollections) {
    const memberKeys = collection.projectIds
      .map((projectId) => `id:${projectId}`)
      .filter((key) => sessionsByProjectKey.has(key) && !emittedProjectKeys.has(key));
    if (memberKeys.length === 0) continue;
    const collectionSessions: GhostexSession[] = [];
    for (const key of memberKeys) {
      collectionSessions.push(...(sessionsByProjectKey.get(key) ?? []));
    }
    const counts = countSessions(collectionSessions, summary.capabilities);
    const collectionCollapsed = !expandedCollectionIds.has(collection.collectionId);
    items.push({
      type: 'COLLECTION_HEADER',
      key: `collection:${collection.collectionId}`,
      machineId,
      collectionId: collection.collectionId,
      title: collection.title,
      color: collection.color,
      collapsed: collectionCollapsed,
      projectCount: memberKeys.length,
      projectsWithoutSessions: memberKeys.filter((key) => (sessionsByProjectKey.get(key) ?? []).length === 0).length,
      sessionCount: collectionSessions.length,
      workingCount: counts.workingCount,
      attentionCount: counts.attentionCount - counts.questionCount,
      questionCount: counts.questionCount,
      approvalCount: counts.approvalCount,
      backgroundWorkCount: counts.backgroundWorkCount,
      awakeCount: counts.awakeCount,
      containsActive: collectionCollapsed && collectionSessions.some(isActive),
    });
    for (const key of memberKeys) emittedProjectKeys.add(key);
    if (collectionCollapsed) continue;
    for (const key of memberKeys) {
      emitProject(key, collection.color);
    }
  }

  for (const projectKey of orderedProjectKeys) {
    if (emittedProjectKeys.has(projectKey)) continue;
    emitProject(projectKey);
  }
  return withOlderThreadRows(items);
}

/**
 * The project's header as its card in the Project list would carry it, for the Unified list, which has no header: its
 * agent picker and a session menu's Actions…. A project in a saved collection has a header only while that collection
 * is open, as the Project list draws it; `throughCollections` opens the project's collections for the lookup, so the
 * header does not depend on how the collection is folded (Actions… and the agent pickers use it). The project's own
 * folder is looked up with copies of a repository unmerged, since the Project list folds every copy but the first into
 * one entry and a picked copy (New session, the agent menu's project row, a Unified group) would have no header.
 */
export function projectHeaderOf(
  machineId: string,
  summary: GhostexMobileSummary,
  projectId: string,
  { throughCollections = false }: { throughCollections?: boolean } = {},
): ProjectHeaderItem | null {
  const items = buildDrawerItems({
    machineId,
    // A worktree's own header, which the Project list may fold into its parent's (grouping.ts), and a repository
    // copy's own, which Merge copies of the same repository folds into the first copy's.
    summary: { ...summary, worktreeSessionsInProject: false, mergeRepositoryCopies: false },
    nowMs: Date.now(),
    expandedProjectKeys: new Set([`id:${projectId}`]),
    expandedCollectionIds: new Set(
      throughCollections
        ? summary.projectCollections
            .filter((collection) => collection.projectIds.includes(projectId))
            .map((collection) => collection.collectionId)
        : [],
    ),
    expandedGroupKeys: new Set(),
    collapsedSessionKindKeys: new Set(),
  });
  for (const item of items) {
    if (item.type === 'PROJECT_HEADER' && item.projectId === projectId) return item;
  }
  return null;
}
