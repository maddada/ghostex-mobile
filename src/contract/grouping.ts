/**
 * Drawer item builder: turns a normalized mobile summary plus collapse state
 * into the flat, typed item list the sessions drawer renders.
 * Source of truth: docs/specs/sessions-drawer.md §§2-3, mirrored from the
 * Android reference implementation (GhostexDrawerItem.buildItems).
 */

import { SessionCopy } from '../copy';
import {
  displayStatus,
  type GhostexAgentLauncher,
  type GhostexMobileSummary,
  type GhostexProject,
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

export type StateCardItem = {
  type: 'STATE_CARD';
  key: string;
  title: string;
  body: string;
  actionHint: string;
};

export type MachineHeaderItem = {
  type: 'MACHINE_HEADER';
  key: string;
  machineId: string;
  title: string;
  collapsed: boolean;
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
  sleepingCount: number;
};

export type ProjectAgentsRowItem = {
  type: 'PROJECT_AGENTS_ROW';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  projectTitle: string;
  agents: GhostexAgentLauncher[];
  quickActions: GhostexQuickAction[];
};

export type ProjectEmptyItem = {
  type: 'PROJECT_EMPTY';
  key: string;
  machineId: string;
  projectKey: string;
  text: string;
};

export type GroupHeaderItem = {
  type: 'GROUP_HEADER';
  key: string;
  machineId: string;
  projectKey: string;
  projectId: string;
  groupId: string;
  /** Collapse key: `${projectKey}|${groupId}` (in-memory persistence). */
  groupCollapseKey: string;
  title: string;
  count: number;
  collapsed: boolean;
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
};

export type SessionListToggleItem = {
  type: 'SESSION_LIST_TOGGLE';
  key: string;
  machineId: string;
  projectKey: string;
  /** True when the list is currently collapsed to 6 (label "Show more"). */
  collapsed: boolean;
  label: string;
  totalSessionCount: number;
};

export type DrawerItem =
  | StateCardItem
  | MachineHeaderItem
  | ProjectHeaderItem
  | ProjectAgentsRowItem
  | ProjectEmptyItem
  | GroupHeaderItem
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

export function stateCardItem(title: string, body: string, actionHint: string): StateCardItem {
  return { type: 'STATE_CARD', key: 'state-card', title, body, actionHint };
}

export function machineHeaderItem(
  machineId: string,
  title: string,
  collapsed: boolean,
): MachineHeaderItem {
  return { type: 'MACHINE_HEADER', key: `machine:${machineId}`, machineId, title, collapsed };
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
 * Legacy in-project ordering (used when the payload does NOT signal desktop
 * ordering): browser-kind first → pinned (saved order) → attention(2) >
 * working(1) > idle(0) → most recent lastInteractionAt → stable.
 */
export function compareForSidebarOrder(left: GhostexSession, right: GhostexSession): number {
  const kindDelta = sessionKindRank(left) - sessionKindRank(right);
  if (kindDelta !== 0) return kindDelta;
  const pinnedDelta = pinnedRank(left) - pinnedRank(right);
  if (pinnedDelta !== 0) return pinnedDelta;
  if (left.isPinned && right.isPinned) return 0;
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

export type DrawerBuildInput = {
  machineId: string;
  summary: GhostexMobileSummary;
  /** Project header collapse (persisted per machine), keyed by projectKey. */
  collapsedProjectKeys: ReadonlySet<string>;
  /**
   * Flat-project session-list collapse (persisted per machine), keyed by
   * projectKey. Presence = collapsed to 6 rows ("Show more" toggle).
   */
  collapsedSessionListKeys: ReadonlySet<string>;
  /** Named-group collapse (in-memory), keyed by groupCollapseKey(). */
  collapsedGroupKeys: ReadonlySet<string>;
};

export function buildDrawerItems(input: DrawerBuildInput): DrawerItem[] {
  const { machineId, summary, collapsedProjectKeys, collapsedSessionListKeys, collapsedGroupKeys } =
    input;

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

  // In-project sorting only for legacy payloads without desktop ordering.
  if (!summary.preserveSessionOrder) {
    for (const [key, bucket] of sessionsByProjectKey) {
      sessionsByProjectKey.set(key, stableSort(bucket, compareForSidebarOrder));
    }
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
  for (const projectKey of orderedProjectKeys) {
    const projectSessions = sessionsByProjectKey.get(projectKey);
    if (projectSessions === undefined) continue;
    const isChatCollection = projectKey === CHATS_PROJECT_KEY;
    const first = projectSessions.length > 0 ? projectSessions[0] : null;
    const project =
      !isChatCollection && projectKey.startsWith('id:')
        ? projectById.get(projectKey.slice(3)) ?? null
        : null;

    const projectId = isChatCollection
      ? ''
      : project !== null
        ? project.projectId
        : first === null
          ? ''
          : first.projectId;
    const projectTitle = isChatCollection
      ? SessionCopy.chatsTitle
      : project !== null
        ? projectDisplayName(project)
        : first === null
          ? 'Project'
          : displayProjectName(first);
    const projectPath = isChatCollection
      ? ''
      : project !== null
        ? project.path ?? ''
        : first === null
          ? ''
          : first.projectPath;
    const legacyGroupId = first === null ? '' : first.groupId;

    let workingCount = 0;
    let attentionCount = 0;
    let sleepingCount = 0;
    for (const session of projectSessions) {
      const status = displayStatus(session);
      if (status === 'working') workingCount++;
      if (status === 'attention') attentionCount++;
      if (status === 'sleep' || status === 'sleeping') sleepingCount++;
    }

    const collapsed = collapsedProjectKeys.has(projectKey);
    items.push({
      type: 'PROJECT_HEADER',
      key: `project:${projectKey}`,
      machineId,
      projectKey,
      projectId,
      legacyGroupId,
      title: projectTitle,
      projectPath,
      isChatCollection,
      collapsed,
      sessionCount: projectSessions.length,
      workingCount,
      attentionCount,
      sleepingCount,
    });
    if (collapsed) continue;

    // Agents isle: not for Chats; needs a stable projectId and content.
    const agents = summary.agents;
    const quickActions = summary.quickActionsByProject[projectId] ?? [];
    if (!isChatCollection && projectId.length > 0 && (agents.length > 0 || quickActions.length > 0)) {
      items.push({
        type: 'PROJECT_AGENTS_ROW',
        key: `agents:${projectKey}`,
        machineId,
        projectKey,
        projectId,
        projectTitle,
        agents,
        quickActions,
      });
    }

    if (projectSessions.length === 0) {
      items.push({
        type: 'PROJECT_EMPTY',
        key: `empty:${projectKey}`,
        machineId,
        projectKey,
        text: SessionCopy.emptyProjectRow,
      });
      continue;
    }

    const sessionItem = (session: GhostexSession, groupId: string): SessionItem => ({
      type: 'SESSION',
      key: `session:${projectKey}:${session.sessionId}`,
      machineId,
      projectKey,
      projectId,
      groupId,
      projectTitle,
      projectPath,
      session,
    });

    const namedGroups = isChatCollection ? [] : groupsForProject(summary, projectId);
    if (namedGroups.length === 0) {
      // Flat project: 6-row collapse + Show more/less.
      const sessionListCollapsed =
        collapsedSessionListKeys.has(projectKey) &&
        projectSessions.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT;
      const visibleCount = sessionListCollapsed
        ? PROJECT_SESSION_LIST_COLLAPSED_COUNT
        : projectSessions.length;
      for (let index = 0; index < visibleCount; index++) {
        items.push(sessionItem(projectSessions[index], legacyGroupId));
      }
      if (projectSessions.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT) {
        items.push({
          type: 'SESSION_LIST_TOGGLE',
          key: `toggle:${projectKey}`,
          machineId,
          projectKey,
          collapsed: sessionListCollapsed,
          label: sessionListCollapsed ? SessionCopy.showMore : SessionCopy.showLess,
          totalSessionCount: projectSessions.length,
        });
      }
      continue;
    }

    // Grouped project: ungrouped "main" sessions first, then named groups in
    // order with members in sessionIds order; empty groups are skipped.
    const sessionsById = new Map<string, GhostexSession>();
    for (const session of projectSessions) sessionsById.set(session.sessionId, session);
    const claimedSessionIds = new Set<string>();
    for (const group of namedGroups) {
      for (const sessionId of group.sessionIds) claimedSessionIds.add(sessionId);
    }
    for (const session of projectSessions) {
      if (claimedSessionIds.has(session.sessionId)) continue;
      items.push(sessionItem(session, legacyGroupId));
    }
    for (const group of namedGroups) {
      const groupSessions: GhostexSession[] = [];
      for (const sessionId of group.sessionIds) {
        const session = sessionsById.get(sessionId);
        if (session !== undefined) groupSessions.push(session);
      }
      if (groupSessions.length === 0) continue;
      const collapseKey = groupCollapseKey(projectKey, group.groupId);
      const groupCollapsed = collapsedGroupKeys.has(collapseKey);
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
      });
      if (groupCollapsed) continue;
      for (const session of groupSessions) {
        items.push(sessionItem(session, group.groupId));
      }
    }
  }
  return items;
}
