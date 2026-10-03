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
import { isNewSidebarSession, isSidebarDraftSectionSession } from './sessionDrafts';
import {
  displayStatus,
  type GhostexAgentLauncher,
  type GhostexMobileSummary,
  type GhostexProject,
  type GhostexProjectIcon,
  type GhostexQuickAction,
  type GhostexSession,
  type GhostexSessionGroup,
} from './mobileSummary';

/** Collapsed session list shows this many rows before "Show more". */
export const PROJECT_SESSION_LIST_COLLAPSED_COUNT = 6;

/** Synthetic project key for the merged chat-projects collection. */
export const CHATS_PROJECT_KEY = 'chats';

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
  backgroundWorkCount: number;
  awakeCount: number;
};

/**
 * Desktop reference-sidebar section label ("Quick" above the chat sessions,
 * "Projects" above collections + project cards).
 */
export type SectionLabelItem = {
  type: 'SECTION_LABEL';
  key: string;
  machineId: string;
  section: 'quick' | 'projects';
  title: string;
  collapsed: boolean;
  workingCount: number;
  attentionCount: number;
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
  sessionCount: number;
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
  awakeCount: number;
};

export type ProjectHeaderItem = {
  type: 'PROJECT_HEADER';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  /** Legacy per-session groupId carried for sparse payloads. */
  legacyGroupId: string;
  title: string;
  projectPath: string;
  isChatCollection: boolean;
  collapsed: boolean;
  sessionCount: number;
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
  sleepingCount: number;
  /** Awake (running terminal/browser) count for the collapsed count pills. */
  awakeCount: number;
  /** Set when the project renders inside a colored collection panel. */
  collectionColor?: string;
  /** Identity icon inputs, ranked by the row renderer like the desktop does. */
  icon: GhostexProjectIcon;
  /** Workspace theme color ("#rrggbb"), or "" — tints the project's rail. */
  themeColor: string;
  /**
   * Header launcher data (desktop agent split-button + actions menu): the
   * global agent launcher rows and this project's quick actions. Empty for
   * projects without a stable projectId.
   */
  agents: GhostexAgentLauncher[];
  quickActions: GhostexQuickAction[];
  /** True when the session list exceeds the collapsed cap (toggle exists). */
  sessionListClipped: boolean;
  /** True when the list is currently clipped to the collapsed cap. */
  sessionListCollapsed: boolean;
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
  /** Collapse key: `${projectKey}|${groupId}` (persisted per machine). */
  groupCollapseKey: string;
  title: string;
  count: number;
  collapsed: boolean;
  /** The group's header counts; a user-made group draws a project header's counts on the desktop. */
  status: Pick<SessionCounts, 'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'awakeCount'>;
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
  collectionColor?: string;
  /** The row's place in its coordinator's tree; absent on an ordinary top-level row. */
  nesting?: RowNesting;
  /** On a coordinator row: its crew badge. */
  coordinatorBadge?: CoordinatorBadge;
};

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
 * "Show N more" reveal row (desktop renders it as a session-styled row) or the
 * Quick section's "Show less" counterpart.
 */
export type SessionListToggleItem = {
  type: 'SESSION_LIST_TOGGLE';
  key: string;
  machineId: string;
  projectKey: string;
  /** True when the list is currently collapsed (label "Show N more"). */
  collapsed: boolean;
  label: string;
  totalSessionCount: number;
  collectionColor?: string;
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
  | SessionListToggleItem;

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
export type SessionKindSection = 'browser' | 'pinned' | 'sessions' | 'drafts' | 'parked';

export const SESSION_KIND_LABELS: Readonly<Record<SessionKindSection, string>> = {
  browser: SessionCopy.browserKindLabel,
  pinned: SessionCopy.pinnedKindLabel,
  sessions: SessionCopy.sessionsKindLabel,
  drafts: SessionCopy.draftsKindLabel,
  parked: SessionCopy.parkedKindLabel,
};

export function sessionKindSection(session: GhostexSession, nowMs: number = Date.now()): SessionKindSection {
  if (session.kind === 'browser' || session.surface === 'browser') return 'browser';
  if (session.isParked) return 'parked';
  if (isSidebarDraftSectionSession(session, nowMs)) return 'drafts';
  return session.isPinned ? 'pinned' : 'sessions';
}

export function sessionKindCollapseKey(
  projectKey: string,
  section: SessionKindSection,
): string {
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
  counts: Pick<SessionCounts, 'workingCount' | 'attentionCount' | 'backgroundWorkCount' | 'awakeCount'>,
): MachineHeaderItem {
  return {
    type: 'MACHINE_HEADER',
    key: `machine:${machineId}`,
    machineId,
    title,
    collapsed,
    workingCount: counts.workingCount,
    attentionCount: counts.attentionCount,
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
export function compareForSidebarOrder(left: GhostexSession, right: GhostexSession, nowMs: number = Date.now()): number {
  const kindDelta = sessionKindRank(left) - sessionKindRank(right);
  if (kindDelta !== 0) return kindDelta;
  const parkedDelta = Number(left.isParked === true) - Number(right.isParked === true);
  if (parkedDelta !== 0) return parkedDelta;
  // CDXC:Sessions 2026-09-12 SEE-ALSO: packages/shared/active-sessions-sort.ts owns the decision to sort Parked by activity time alone, newest first, on every client.
  if (left.isParked && right.isParked) {
    return (
      parseTimestamp(right.lastInteractionAt) - parseTimestamp(left.lastInteractionAt) ||
      left.sessionId.localeCompare(right.sessionId)
    );
  }
  const leftDraft = sessionKindSection(left, nowMs) === 'drafts';
  const rightDraft = sessionKindSection(right, nowMs) === 'drafts';
  if (leftDraft !== rightDraft) {
    return leftDraft ? (right.isPinned ? 1 : -1) : (left.isPinned ? -1 : 1);
  }
  if (leftDraft && rightDraft) return parseTimestamp(right.createdAt) - parseTimestamp(left.createdAt);
  const pinnedDelta = pinnedRank(left) - pinnedRank(right);
  if (pinnedDelta !== 0) return pinnedDelta;
  if (left.isPinned && right.isPinned) return 0;
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
  /** In attention or waiting on an answer (the desktop counts both as attention on project, collection, Space and machine headers). */
  attentionCount: number;
  /** Rows drawing the grey dot: idle with a background shell or monitor still running. */
  backgroundWorkCount: number;
  sleepingCount: number;
  awakeCount: number;
};

/**
 * packages/gx-core/src/sidebar_view/view.rs `shows_background_work`: the row
 * draws the grey dot, so a header counts it.
 */
export function showsBackgroundWork(session: GhostexSession): boolean {
  return (
    session.backgroundWorkDetectedAt.length > 0 &&
    session.activity !== 'working' &&
    session.activity !== 'attention'
  );
}

/**
 * packages/gx-core/src/sidebar_view/groups.rs `group_summary`, the counts a
 * project, collection, Space or machine header draws. Read off the raw
 * activity the row draws, so a header never disagrees with its rows.
 */
export function countSessions(sessions: readonly GhostexSession[]): SessionCounts {
  const counts: SessionCounts = {
    workingCount: 0,
    attentionCount: 0,
    backgroundWorkCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
  };
  for (const session of sessions) {
    const status = displayStatus(session);
    if (session.activity === 'working') counts.workingCount++;
    if (session.activity === 'attention' || session.pendingQuestionCount > 0) counts.attentionCount++;
    if (showsBackgroundWork(session)) counts.backgroundWorkCount++;
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
  /** The section's session ids, so the renderer can ring a collapsed section holding the selected session. */
  sessionIds: string[];
};

/** packages/gx-core/src/sidebar_view/sections.rs `project_session_sections`, one section's counts. */
export function countSectionSessions(sessions: readonly GhostexSession[]): SectionStatusCounts {
  const counts: SectionStatusCounts = {
    count: sessions.length,
    workingCount: 0,
    attentionCount: 0,
    backgroundWorkCount: 0,
    questionCount: 0,
    sessionIds: sessions.map((session) => session.sessionId),
  };
  for (const session of sessions) {
    if (session.activity === 'working') counts.workingCount++;
    if (session.activity === 'attention' && session.pendingQuestionCount === 0) counts.attentionCount++;
    if (showsBackgroundWork(session)) counts.backgroundWorkCount++;
    if (session.pendingQuestionCount > 0) counts.questionCount++;
  }
  return counts;
}

/**
 * Per-machine roll-up for the machine tab strip: the working and attention
 * counts of every session the machine reports, before any Space filter, so an
 * unselected tab still says something needs the user (desktop machine-tabs.tsx).
 */
export function machineSessionCounts(summary: GhostexMobileSummary | null): SessionCounts {
  return countSessions(summary === null ? [] : summary.sessions);
}

export type DrawerBuildInput = {
  nowMs?: number;
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
   * Flat-project session-list collapse (persisted per machine), keyed by
   * projectKey. Presence = collapsed to 6 rows ("Show more" toggle). Matches
   * the desktop default of showing all sessions until explicitly collapsed.
   */
  collapsedSessionListKeys: ReadonlySet<string>;
  /**
   * Collapsed top-level sections ('quick' | 'projects'). Presence = collapsed;
   * both sections default expanded like the desktop reference sidebar.
   */
  collapsedSectionKeys: ReadonlySet<string>;
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
};

export function buildDrawerItems(input: DrawerBuildInput): DrawerItem[] {
  const {
    machineId,
    summary,
    expandedProjectKeys,
    expandedCollectionIds,
    expandedGroupKeys,
    collapsedSessionListKeys,
    collapsedSectionKeys,
    collapsedSessionKindKeys,
    expandedParkedSessionKeys = new Set<string>(),
    expandedDraftSessionKeys = new Set<string>(),
    collapsedCoordinatorKeys = new Set<string>(),
    nowMs = Date.now(),
  } = input;
  const badges = coordinatorBadges(summary.sessions);

  const projectById = new Map<string, GhostexProject>();
  for (const project of summary.projects) projectById.set(project.projectId, project);

  // Bucket sessions by project key; chat projects merge into the synthetic
  // "chats" key. Insertion order preserves the wire session order.
  const sessionsByProjectKey = new Map<string, GhostexSession[]>();
  for (const session of summary.sessions) {
    const project = projectById.get(session.projectId);
    const key =
      project !== undefined && project.isChat === true ? CHATS_PROJECT_KEY : projectKeyForSession(session);
    const bucket = sessionsByProjectKey.get(key);
    if (bucket === undefined) sessionsByProjectKey.set(key, [session]);
    else bucket.push(session);
  }
  // Active projects stay visible even with zero sessions.
  for (const project of summary.projects) {
    const key = project.isChat === true ? CHATS_PROJECT_KEY : `id:${project.projectId}`;
    if (!sessionsByProjectKey.has(key)) sessionsByProjectKey.set(key, []);
  }

  // Desktop display layout: the wire order (server sortOrder) is the stable
  // manual base; browser-first/pinned-first/draft-first/activity sorting is applied on top
  // exactly like the gpui sidebar's default "lastActivity" mode.
  for (const [key, bucket] of sessionsByProjectKey) {
    sessionsByProjectKey.set(key, stableSort(bucket, (left, right) => compareForSidebarOrder(left, right, nowMs)));
  }

  // Project order: chats → workspaceGroups.projectOrder → projects array order
  // → leftovers in bucket insertion order.
  const orderedProjectKeys: string[] = [];
  const pushKey = (key: string): void => {
    if (sessionsByProjectKey.has(key) && !orderedProjectKeys.includes(key)) {
      orderedProjectKeys.push(key);
    }
  };
  pushKey(CHATS_PROJECT_KEY);
  for (const projectId of summary.workspaceGroups?.projectOrder ?? []) pushKey(`id:${projectId}`);
  for (const project of summary.projects) {
    pushKey(project.isChat === true ? CHATS_PROJECT_KEY : `id:${project.projectId}`);
  }
  for (const key of sessionsByProjectKey.keys()) pushKey(key);

  const items: DrawerItem[] = [];

  const emitProject = (projectKey: string, collectionColor?: string): void => {
    const allProjectSessions = sessionsByProjectKey.get(projectKey);
    if (allProjectSessions === undefined) return;
    const first = allProjectSessions.length > 0 ? allProjectSessions[0] : null;
    const project = projectKey.startsWith('id:')
      ? projectById.get(projectKey.slice(3)) ?? null
      : null;

    const projectId = project !== null ? project.projectId : first === null ? '' : first.projectId;
    const projectTitle =
      project !== null
        ? projectDisplayName(project)
        : first === null
          ? 'Project'
          : displayProjectName(first);
    const projectPath =
      project !== null ? project.path ?? '' : first === null ? '' : first.projectPath;
    const legacyGroupId = first === null ? '' : first.groupId;
    const counts = countSessions(allProjectSessions);
    const icon: GhostexProjectIcon = project !== null
      ? project.icon
      : { imageDataUrl: '', discoveredIconDataUrl: '', glyph: '', glyphColor: '', isWorktree: false };

    const namedGroups = groupsForProject(summary, projectId);
    const groupedSessionIds = new Set(namedGroups.flatMap((group) => group.sessionIds));
    const inNamedGroup = (session: GhostexSession): boolean => {
      const section = sessionKindSection(session, nowMs);
      return section !== 'drafts' && section !== 'parked' && groupedSessionIds.has(session.sessionId);
    };
    /*
     * Coordinator trees (coordinatorTree.ts, gx-core nest_threads): each open
     * thread follows its coordinator and takes its section. A named group's
     * members are nested inside that group below.
     */
    const kindSection = (session: GhostexSession): SessionKindSection => sessionKindSection(session, nowMs);
    const tree = nestCoordinatorThreads(
      allProjectSessions.filter((session) => !inNamedGroup(session)),
      collapsedCoordinatorKeys,
      kindSection,
    );
    const nesting = new Map(tree.nesting);
    const sectionOf = (session: GhostexSession): SessionKindSection =>
      tree.sections.get(coordinatorRowKey(session)) ?? kindSection(session);
    const isFolded = (session: GhostexSession): boolean =>
      nesting.get(coordinatorRowKey(session))?.folded === true;
    const parkedSessions = tree.sessions.filter((session) => sectionOf(session) === 'parked');
    const draftSessions = tree.sessions.filter((session) => sectionOf(session) === 'drafts');
    const projectSessions = [
      ...tree.sessions.filter((session) => !['drafts', 'parked'].includes(sectionOf(session))),
      ...allProjectSessions.filter(inNamedGroup),
    ];
    /*
     * What a section heading counts: every session of that section, including
     * rows a compact list leaves out (sections.rs counts all members) and the
     * threads of a folded coordinator, less the members of named groups, which
     * the desktop draws as groups of their own.
     */
    const sectionPool = tree.sessions;
    const shownProjectSessions = projectSessions.filter((session) => !isFolded(session));
    const sessionListClipped =
      namedGroups.length === 0 && shownProjectSessions.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT;
    const sessionListCollapsed = sessionListClipped && collapsedSessionListKeys.has(projectKey);

    const collapsed = !expandedProjectKeys.has(projectKey);
    items.push({
      type: 'PROJECT_HEADER',
      key: `project:${projectKey}`,
      machineId,
      projectKey,
      projectId,
      legacyGroupId,
      title: projectTitle,
      projectPath,
      isChatCollection: false,
      collapsed,
      sessionCount: allProjectSessions.length,
      workingCount: counts.workingCount,
      attentionCount: counts.attentionCount,
      backgroundWorkCount: counts.backgroundWorkCount,
      sleepingCount: counts.sleepingCount,
      awakeCount: counts.awakeCount,
      collectionColor,
      icon,
      themeColor: project !== null ? project.themeColor : '',
      agents: projectId.length > 0 ? summary.agents : [],
      quickActions: projectId.length > 0 ? summary.quickActionsByProject[projectId] ?? [] : [],
      sessionListClipped,
      sessionListCollapsed,
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

    const sessionItem = (session: GhostexSession, groupId: string): SessionItem => ({
      type: 'SESSION',
      key: `session:${projectKey}:${session.sessionId}`,
      machineId,
      projectKey,
      projectId,
      groupId: groupId || namedGroups.find((group) => group.sessionIds.includes(session.sessionId))?.groupId || session.groupId,
      projectTitle,
      projectPath,
      session,
      collectionColor,
      nesting: nesting.get(coordinatorRowKey(session)),
      coordinatorBadge: session.isCoordinator
        ? badges.get(coordinatorRowKey(session)) ?? { count: 0, tone: 'idle' }
        : undefined,
    });

    /*
     * Desktop parity (session-group-section.tsx ProjectSessionSectionToggle):
     * The label sits above the first row of its kind, and collapsing one hides
     * only that kind's rows. Drafts and Parked are emitted separately so the
     * ordinary "Show N more" cap cannot hide their disclosures.
     */
    const emitSessionsWithKindLabels = (
      sessions: readonly GhostexSession[],
      groupId: string,
    ): void => {
      const labelledSections = new Set<SessionKindSection>();
      for (const session of sessions) {
        const section = sectionOf(session);
        if (section === 'sessions') emitDraftSection();
        const kindCollapseKey = sessionKindCollapseKey(projectKey, section);
        const kindCollapsed =
          section === 'drafts'
            ? !expandedDraftSessionKeys.has(kindCollapseKey)
            : section === 'parked'
              ? !expandedParkedSessionKeys.has(kindCollapseKey)
              : collapsedSessionKindKeys.has(kindCollapseKey);
        if (!labelledSections.has(section)) {
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
            ),
            collectionColor,
          });
        }
        if (kindCollapsed || isFolded(session)) continue;
        items.push(sessionItem(session, groupId));
      }
    };

    let didEmitDraftSection = false;
    const emitDraftSection = (): void => {
      if (didEmitDraftSection) return;
      didEmitDraftSection = true;
      emitSessionsWithKindLabels(draftSessions, '');
    };

    if (namedGroups.length === 0) {
      // Flat project: 6-row collapse; the collapsed reveal is a session-styled
      // "Show N more" row, expanded lists collapse via the header chevron.
      const visibleCount = sessionListCollapsed
        ? PROJECT_SESSION_LIST_COLLAPSED_COUNT
        : shownProjectSessions.length;
      emitSessionsWithKindLabels(shownProjectSessions.slice(0, visibleCount), legacyGroupId);
      emitDraftSection();
      if (sessionListCollapsed) {
        items.push({
          type: 'SESSION_LIST_TOGGLE',
          key: `toggle:${projectKey}`,
          machineId,
          projectKey,
          collapsed: true,
          label: SessionCopy.showCountMore(
            shownProjectSessions.length - PROJECT_SESSION_LIST_COLLAPSED_COUNT,
          ),
          totalSessionCount: shownProjectSessions.length,
          collectionColor,
        });
      }
      emitSessionsWithKindLabels(parkedSessions, '');
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
          (isNewSidebarSession(left, nowMs) || isNewSidebarSession(right, nowMs) ? compareForSidebarOrder(left, right, nowMs) : 0),
      );
      const groupTree = nestCoordinatorThreads(groupSessions, collapsedCoordinatorKeys, kindSection);
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
        status: countSessions(groupSessions),
        collectionColor,
      });
      if (groupCollapsed) continue;
      for (const session of groupTree.sessions) {
        if (isFolded(session)) continue;
        items.push(sessionItem(session, group.groupId));
      }
    }
    emitSessionsWithKindLabels(parkedSessions, '');
  };

  /*
   * Top-level layout mirrors the desktop reference sidebar: a "Quick" section
   * label with the chat sessions as bare rows, then a "Projects" section label
   * with colored collection panels (members in project order) followed by
   * ungrouped project cards.
   */
  if (summary.sessions.length === 0 && summary.projects.length === 0) return items;

  const emittedProjectKeys = new Set<string>();
  emittedProjectKeys.add(CHATS_PROJECT_KEY);

  const allChatSessions = sessionsByProjectKey.get(CHATS_PROJECT_KEY) ?? [];
  const chatSessions = allChatSessions.filter((session) => sessionKindSection(session, nowMs) !== 'parked');
  const parkedChatSessions = allChatSessions.filter((session) => sessionKindSection(session, nowMs) === 'parked');
  const quickCounts = countSessions(allChatSessions);
  const quickCollapsed = collapsedSectionKeys.has('quick');
  items.push({
    type: 'SECTION_LABEL',
    key: 'section:quick',
    machineId,
    section: 'quick',
    title: SessionCopy.quickSectionTitle,
    collapsed: quickCollapsed,
    workingCount: quickCounts.workingCount,
    attentionCount: quickCounts.attentionCount,
    backgroundWorkCount: quickCounts.backgroundWorkCount,
    awakeCount: quickCounts.awakeCount,
  });
  if (!quickCollapsed) {
    if (allChatSessions.length === 0) {
      items.push({
        type: 'PROJECT_EMPTY',
        key: `empty:${CHATS_PROJECT_KEY}`,
        machineId,
        projectKey: CHATS_PROJECT_KEY,
        text: SessionCopy.emptyQuickRow,
      });
    } else {
      const clipped = chatSessions.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT;
      const listCollapsed = clipped && collapsedSessionListKeys.has(CHATS_PROJECT_KEY);
      const visibleCount = listCollapsed ? PROJECT_SESSION_LIST_COLLAPSED_COUNT : chatSessions.length;
      for (let index = 0; index < visibleCount; index++) {
        const session = chatSessions[index];
        items.push({
          type: 'SESSION',
          key: `session:${CHATS_PROJECT_KEY}:${session.sessionId}`,
          machineId,
          projectKey: CHATS_PROJECT_KEY,
          projectId: session.projectId,
          groupId: session.groupId,
          projectTitle: SessionCopy.chatsTitle,
          projectPath: '',
          session,
        });
      }
      if (clipped) {
        items.push({
          type: 'SESSION_LIST_TOGGLE',
          key: `toggle:${CHATS_PROJECT_KEY}`,
          machineId,
          projectKey: CHATS_PROJECT_KEY,
          collapsed: listCollapsed,
          label: listCollapsed
            ? SessionCopy.showCountMore(chatSessions.length - PROJECT_SESSION_LIST_COLLAPSED_COUNT)
            : SessionCopy.showLess,
          totalSessionCount: chatSessions.length,
        });
      }
      if (parkedChatSessions.length > 0) {
        const kindCollapseKey = sessionKindCollapseKey(CHATS_PROJECT_KEY, 'parked');
        const collapsed = !expandedParkedSessionKeys.has(kindCollapseKey);
        items.push({
          type: 'SESSION_KIND_LABEL',
          key: `kind:${kindCollapseKey}`,
          machineId,
          projectKey: CHATS_PROJECT_KEY,
          section: 'parked',
          kindCollapseKey,
          label: SessionCopy.parkedKindLabel,
          collapsed,
          status: countSectionSessions(parkedChatSessions),
        });
        if (!collapsed) {
          for (const session of parkedChatSessions) {
            items.push({
              type: 'SESSION',
              key: `session:${CHATS_PROJECT_KEY}:${session.sessionId}`,
              machineId,
              projectKey: CHATS_PROJECT_KEY,
              projectId: session.projectId,
              groupId: session.groupId,
              projectTitle: SessionCopy.chatsTitle,
              projectPath: '',
              session,
            });
          }
        }
      }
    }
  }

  const projectSessions = orderedProjectKeys
    .filter((projectKey) => projectKey !== CHATS_PROJECT_KEY)
    .flatMap((projectKey) => sessionsByProjectKey.get(projectKey) ?? []);
  const projectCounts = countSessions(projectSessions);
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
    attentionCount: projectCounts.attentionCount,
    backgroundWorkCount: projectCounts.backgroundWorkCount,
    awakeCount: projectCounts.awakeCount,
  });

  for (const collection of summary.projectCollections) {
    const memberKeys = collection.projectIds
      .map((projectId) => `id:${projectId}`)
      .filter(
        (key) => sessionsByProjectKey.has(key) && !emittedProjectKeys.has(key),
      );
    if (memberKeys.length === 0) continue;
    const collectionSessions: GhostexSession[] = [];
    for (const key of memberKeys) {
      collectionSessions.push(...(sessionsByProjectKey.get(key) ?? []));
    }
    const counts = countSessions(collectionSessions);
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
      sessionCount: collectionSessions.length,
      workingCount: counts.workingCount,
      attentionCount: counts.attentionCount,
      backgroundWorkCount: counts.backgroundWorkCount,
      awakeCount: counts.awakeCount,
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
  return items;
}
