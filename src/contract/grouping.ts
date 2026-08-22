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
  workingCount: number;
  attentionCount: number;
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

/** In-project kind disclosures, mirroring desktop getProjectSessionSection. */
export type SessionKindSection = 'browser' | 'pinned' | 'sessions';

export const SESSION_KIND_LABELS: Readonly<Record<SessionKindSection, string>> = {
  browser: SessionCopy.browserKindLabel,
  pinned: SessionCopy.pinnedKindLabel,
  sessions: SessionCopy.sessionsKindLabel,
};

export function sessionKindSection(session: GhostexSession): SessionKindSection {
  if (session.kind === 'browser' || session.surface === 'browser') return 'browser';
  return session.isPinned ? 'pinned' : 'sessions';
}

export function sessionKindCollapseKey(
  projectKey: string,
  section: SessionKindSection,
): string {
  return `${projectKey}|${section}`;
}

export function stateCardItem(title: string, body: string, actionHint: string): StateCardItem {
  return { type: 'STATE_CARD', key: 'state-card', title, body, actionHint };
}

export function machineHeaderItem(
  machineId: string,
  title: string,
  collapsed: boolean,
  counts: Pick<SessionCounts, 'workingCount' | 'attentionCount' | 'awakeCount'>,
): MachineHeaderItem {
  return {
    type: 'MACHINE_HEADER',
    key: `machine:${machineId}`,
    machineId,
    title,
    collapsed,
    workingCount: counts.workingCount,
    attentionCount: counts.attentionCount,
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
 * "lastActivity" layout (packages/shared/active-sessions-sort.ts): browser-kind first →
 * pinned (saved order) → attention(2) > working(1) > idle(0) → most recent
 * lastInteractionAt → stable. The wire order (server sortOrder) is the stable
 * base, which matches the desktop's saved manual order.
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
  attentionCount: number;
  sleepingCount: number;
  awakeCount: number;
};

export function countSessions(sessions: readonly GhostexSession[]): SessionCounts {
  const counts: SessionCounts = {
    workingCount: 0,
    attentionCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
  };
  for (const session of sessions) {
    const status = displayStatus(session);
    if (status === 'working') counts.workingCount++;
    if (status === 'attention') counts.attentionCount++;
    if (status === 'sleep' || status === 'sleeping') counts.sleepingCount++;
    if (isAwakeSession(session)) counts.awakeCount++;
  }
  return counts;
}

export type DrawerBuildInput = {
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
  } = input;

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
  // manual base; browser-first/pinned-first/activity sorting is applied on top
  // exactly like the gpui sidebar's default "lastActivity" mode.
  for (const [key, bucket] of sessionsByProjectKey) {
    sessionsByProjectKey.set(key, stableSort(bucket, compareForSidebarOrder));
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
    const projectSessions = sessionsByProjectKey.get(projectKey);
    if (projectSessions === undefined) return;
    const first = projectSessions.length > 0 ? projectSessions[0] : null;
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
    const counts = countSessions(projectSessions);
    const icon: GhostexProjectIcon = project !== null
      ? project.icon
      : { imageDataUrl: '', discoveredIconDataUrl: '', glyph: '', glyphColor: '', isWorktree: false };

    const namedGroups = groupsForProject(summary, projectId);
    const sessionListClipped =
      namedGroups.length === 0 && projectSessions.length > PROJECT_SESSION_LIST_COLLAPSED_COUNT;
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
      sessionCount: projectSessions.length,
      workingCount: counts.workingCount,
      attentionCount: counts.attentionCount,
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

    if (projectSessions.length === 0) {
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
      groupId,
      projectTitle,
      projectPath,
      session,
      collectionColor,
    });

    /*
     * Desktop parity (session-group-section.tsx ProjectSessionSectionToggle):
     * a project's own list is three independent disclosures. The uppercase
     * label sits above the first row of its kind, and collapsing one hides
     * only that kind's rows — the "Show N more" clip is applied first, exactly
     * like the desktop sidebar clips before it partitions the rendered ids.
     */
    const emitSessionsWithKindLabels = (
      sessions: readonly GhostexSession[],
      groupId: string,
    ): void => {
      const labelledSections = new Set<SessionKindSection>();
      for (const session of sessions) {
        const section = sessionKindSection(session);
        const kindCollapseKey = sessionKindCollapseKey(projectKey, section);
        const kindCollapsed = collapsedSessionKindKeys.has(kindCollapseKey);
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
            collectionColor,
          });
        }
        if (kindCollapsed) continue;
        items.push(sessionItem(session, groupId));
      }
    };

    if (namedGroups.length === 0) {
      // Flat project: 6-row collapse; the collapsed reveal is a session-styled
      // "Show N more" row, expanded lists collapse via the header chevron.
      const visibleCount = sessionListCollapsed
        ? PROJECT_SESSION_LIST_COLLAPSED_COUNT
        : projectSessions.length;
      emitSessionsWithKindLabels(projectSessions.slice(0, visibleCount), legacyGroupId);
      if (sessionListCollapsed) {
        items.push({
          type: 'SESSION_LIST_TOGGLE',
          key: `toggle:${projectKey}`,
          machineId,
          projectKey,
          collapsed: true,
          label: SessionCopy.showCountMore(
            projectSessions.length - PROJECT_SESSION_LIST_COLLAPSED_COUNT,
          ),
          totalSessionCount: projectSessions.length,
          collectionColor,
        });
      }
      return;
    }

    // Grouped project: ungrouped "main" sessions first, then named groups in
    // order with members in sessionIds order; empty groups are skipped.
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
    for (const group of namedGroups) {
      const groupSessions: GhostexSession[] = [];
      for (const sessionId of group.sessionIds) {
        const session = sessionsById.get(sessionId);
        if (session !== undefined) groupSessions.push(session);
      }
      if (groupSessions.length === 0) continue;
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
        collectionColor,
      });
      if (groupCollapsed) continue;
      for (const session of groupSessions) {
        items.push(sessionItem(session, group.groupId));
      }
    }
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

  const chatSessions = sessionsByProjectKey.get(CHATS_PROJECT_KEY) ?? [];
  const quickCounts = countSessions(chatSessions);
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
    awakeCount: quickCounts.awakeCount,
  });
  if (!quickCollapsed) {
    if (chatSessions.length === 0) {
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
    }
  }

  const projectSessions = orderedProjectKeys
    .filter((projectKey) => projectKey !== CHATS_PROJECT_KEY)
    .flatMap((projectKey) => sessionsByProjectKey.get(projectKey) ?? []);
  const projectCounts = countSessions(projectSessions);
  const projectsCollapsed = collapsedSectionKeys.has('projects');
  items.push({
    type: 'SECTION_LABEL',
    key: 'section:projects',
    machineId,
    section: 'projects',
    title: SessionCopy.projectsSectionTitle,
    collapsed: projectsCollapsed,
    workingCount: projectCounts.workingCount,
    attentionCount: projectCounts.attentionCount,
    awakeCount: projectCounts.awakeCount,
  });
  if (projectsCollapsed) return items;

  for (const collection of summary.projectCollections) {
    const memberKeys = orderedProjectKeys.filter(
      (key) =>
        key !== CHATS_PROJECT_KEY &&
        key.startsWith('id:') &&
        collection.projectIds.includes(key.slice(3)) &&
        !emittedProjectKeys.has(key),
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
