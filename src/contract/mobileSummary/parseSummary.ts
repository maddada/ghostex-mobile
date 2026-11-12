/**
 * Parsing and normalizing the summary root: projects, launchers, workspaces, Spaces and tags.
 * Part of the mobile summary contract (`./index.ts`).
 */

import { sessionNotesOnIn } from '../../sessions/sessionNotesSwitch';
import { boolValue, firstNonEmpty, isObject, trimmedValue, type JsonObject } from './json';
import { scanJsonObjects } from './jsonScan';
import type {
  GhostexAgentLauncher,
  GhostexCustomSessionTag,
  GhostexCustomSessionTags,
  GhostexGbotsBot,
  GhostexGbotsComputer,
  GhostexProject,
  GhostexProjectCollection,
  GhostexProjectIcon,
  GhostexQuickAction,
  GhostexRecentProject,
  GhostexSidebarSpace,
  GhostexSidebarSpaces,
  GhostexWorkspace,
  GhostexWorkspaceGroups,
  GhostexWorkspaces,
} from './model';
import { parseSession } from './parseSession';
import type { GhostexMobileSummary, GhostexSession, GhostexSummaryCapabilities } from './session';

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
      isHome: entry.isHome === true,
      gbotsProject: entry.gbotsProject === true || isObject(entry.gbotsBot) ? true : undefined,
      gbotsBot: parseGbotsBot(entry.gbotsBot),
      icon: parseProjectIcon(entry),
      themeColor: normalizedHexColor(trimmedValue(entry, 'themeColor')),
      worktreeParentProjectId: isObject(entry.worktree) ? trimmedValue(entry.worktree, 'parentProjectId') : '',
      workMode: entry.workMode === true,
      workLinear: entry.workLinear === true,
      workGithubOff: entry.workGithubOff === true,
      workTracker: entry.workTracker === 'github' || entry.workTracker === 'linear' ? entry.workTracker : undefined,
      worktree: isObject(entry.worktree)
        ? { name: trimmedValue(entry.worktree, 'name'), branch: trimmedValue(entry.worktree, 'branch') }
        : undefined,
      workspaceId: trimmedValue(entry, 'workspaceId') || undefined,
      everyWorkspace: entry.everyWorkspace === true ? true : undefined,
      gitRemoteOriginUrl: trimmedValue(entry, 'gitRemoteOriginUrl') || undefined,
      gitWorkTree: 'gitRemoteOriginUrl' in entry,
      gitRepositoryRootPath: trimmedValue(entry, 'gitRepositoryRootPath') || undefined,
    });
  }
  return projects;
}

function parseGbotsBot(value: unknown): GhostexGbotsBot | undefined {
  if (!isObject(value)) return undefined;
  const id = trimmedValue(value, 'id');
  if (id.length === 0) return undefined;
  const departmentId = trimmedValue(value, 'departmentId');
  return {
    id,
    name: trimmedValue(value, 'name') || id,
    title: trimmedValue(value, 'title'),
    icon: trimmedValue(value, 'icon'),
    color: trimmedValue(value, 'color'),
    colorHex: normalizedHexColor(trimmedValue(value, 'colorHex')),
    agentId: trimmedValue(value, 'agentId'),
    departmentId: departmentId.length > 0 ? departmentId : undefined,
    departmentName: departmentId.length > 0 ? trimmedValue(value, 'departmentName') || undefined : undefined,
    departmentIcon: departmentId.length > 0 ? trimmedValue(value, 'departmentIcon') || undefined : undefined,
    departmentOrder:
      departmentId.length > 0 && typeof value.departmentOrder === 'number' ? value.departmentOrder : undefined,
    isLead: value.isLead === true ? true : undefined,
    paused: value.paused === true ? true : undefined,
    computer: parseGbotsComputer(value.computer),
  };
}

function parseGbotsComputer(value: unknown): GhostexGbotsComputer | undefined {
  if (!isObject(value)) return undefined;
  const kind = trimmedValue(value, 'kind');
  return {
    kind: kind === 'computer' || kind === 'cloudBox' ? kind : 'this',
    name: trimmedValue(value, 'name'),
    computerUse: value.computerUse === true,
  };
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
    glyphColor: kind === 'tabler' && icon !== null ? normalizedHexColor(trimmedValue(icon, 'color')) : '',
    isWorktree:
      isObject(worktree) || (typeof worktree === 'string' && worktree.trim().length > 0 && worktree.trim() !== 'null'),
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
      sessionCount: typeof rawCount === 'number' && Number.isFinite(rawCount) ? Math.max(0, rawCount) : 0,
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

/** One action list, project or global: the runnable types only, with the fields the computer sends. */
function parseQuickActions(value: unknown): GhostexQuickAction[] {
  if (!Array.isArray(value)) return [];
  const actions: GhostexQuickAction[] = [];
  for (const entry of value) {
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
  return actions;
}

function parseQuickActionsByProject(value: unknown): Record<string, GhostexQuickAction[]> {
  if (!isObject(value)) return {};
  const byProject: Record<string, GhostexQuickAction[]> = {};
  for (const rawProjectId of Object.keys(value)) {
    const projectId = rawProjectId.trim();
    if (projectId.length === 0) continue;
    const actions = parseQuickActions(value[rawProjectId]);
    if (actions.length > 0) byProject[projectId] = actions;
  }
  return byProject;
}

/**
 * The summary without Global Actions: what the phone keeps of a computer whose connection failed or is being
 * re-established, so a Global Action is only ever shown or run from a summary read over the current connection.
 */
export function withoutGlobalQuickActions(summary: GhostexMobileSummary): GhostexMobileSummary {
  return { ...summary, globalQuickActions: [], globalQuickActionsSupported: false };
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
      color: rawColor !== 'transparent' && /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#4f5663',
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
      workspaceId: trimmedValue(entry, 'workspaceId') || undefined,
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

/**
 * Parse the `sidebarWorkspaces` wire key (gx-protocol `SidebarWorkspacesState`). Null when the
 * daemon has no workspaces, which is also what leaves the phone's list unfiltered. The default
 * workspace is `personal` when the document names none, as `SidebarWorkspacesState::default_id`.
 */
export function parseWorkspaces(value: unknown): GhostexWorkspaces | null {
  if (!isObject(value) || !isObject(value.workspaces)) return null;
  const byId = value.workspaces as JsonObject;
  const workspaces: Record<string, GhostexWorkspace> = {};
  for (const workspaceId of Object.keys(byId)) {
    const entry = byId[workspaceId];
    if (workspaceId.trim().length === 0 || !isObject(entry)) continue;
    const name = firstNonEmpty(trimmedValue(entry, 'name')) || workspaceId;
    const rawColor = trimmedValue(entry, 'color');
    workspaces[workspaceId] = {
      workspaceId,
      name,
      color: /^#[0-9a-f]{6}$/i.test(rawColor) ? rawColor : '#4f5663',
      letter: firstNonEmpty(trimmedValue(entry, 'letter')) || name.slice(0, 1).toUpperCase(),
      kind: trimmedValue(entry, 'kind'),
    };
  }
  if (Object.keys(workspaces).length === 0) return null;
  // Ids missing from `order` are appended so a workspace can never become unreachable here.
  const order: string[] = [];
  if (Array.isArray(value.order)) {
    for (const entry of value.order) {
      if (typeof entry === 'string' && entry in workspaces && !order.includes(entry)) order.push(entry);
    }
  }
  for (const workspaceId of Object.keys(workspaces)) {
    if (!order.includes(workspaceId)) order.push(workspaceId);
  }
  return {
    defaultWorkspaceId: trimmedValue(value, 'defaultWorkspaceId') || 'personal',
    order,
    workspaces,
  };
}

function normalizeRoot(root: JsonObject): GhostexMobileSummary {
  const rawSessions = Array.isArray(root.sessions) ? root.sessions : [];
  const sessions: GhostexSession[] = [];
  let anySortOrder = false;
  const builtInFeaturesOff = Array.isArray(root.builtInFeaturesOff)
    ? root.builtInFeaturesOff.filter((id): id is string => typeof id === 'string')
    : undefined;
  // While Session notes is off on the computer a row draws no note dot; the note stays saved there.
  const sessionNotesOn = sessionNotesOnIn({ builtInFeaturesOff });
  for (const entry of rawSessions) {
    if (isObject(entry) && typeof entry.sortOrder === 'number' && Number.isFinite(entry.sortOrder)) {
      anySortOrder = true;
    }
    const session = parseSession(entry);
    if (session !== null && !sessionNotesOn) session.sessionNote = '';
    if (session !== null && session.provider === 'zmx') sessions.push(session);
  }
  const workspaceGroups = parseWorkspaceGroups(root.workspaceGroups);
  const globalQuickActionsSupported = isObject(root.capabilities) && root.capabilities.globalQuickActions === true;
  return {
    sessions,
    projects: parseProjects(root.projects),
    recentProjects: parseRecentProjects(root.recentProjects),
    agents: parseAgents(root.agents),
    quickActionsByProject: parseQuickActionsByProject(root.quickActionsByProject),
    globalQuickActions: globalQuickActionsSupported ? parseQuickActions(root.globalQuickActions) : [],
    globalQuickActionsSupported,
    workspaceGroups,
    projectCollections: parseProjectCollections(root.sidebarProjectCollections),
    projectCollectionsState: isObject(root.sidebarProjectCollections) ? root.sidebarProjectCollections : null,
    sidebarSpaces: parseSidebarSpaces(root.sidebarSpaces),
    customSessionTags: parseCustomSessionTags(root.customSessionTags),
    workspaces: parseWorkspaces(root.sidebarWorkspaces),
    preserveSessionOrder: workspaceGroups !== null || anySortOrder,
    builtInFeatures: Array.isArray(root.builtInFeatures)
      ? root.builtInFeatures.filter((id): id is string => typeof id === 'string')
      : [],
    builtInFeaturesOff,
    sessionLinkOpenTarget: root.sessionLinkOpenTarget === 'external' ? 'external' : 'embedded',
    sidebarSessionLinks: typeof root.sidebarSessionLinks === 'string' ? root.sidebarSessionLinks : 'badge',
    dimSleepingSessions: root.dimSleepingSessions === true,
    changesHideTestFiles: root.changesHideTestFiles === true,
    newSessionAgentScope:
      root.newSessionAgentScope === 'space' || root.newSessionAgentScope === 'everywhere'
        ? root.newSessionAgentScope
        : undefined,
    sidebarView: root.sidebarView === 'unified' ? 'unified' : 'project',
    unifiedWorkingSection: root.unifiedWorkingSection !== false,
    unifiedGroupByProject: root.unifiedGroupByProject === true,
    unifiedProjectOrder: Array.isArray(root.unifiedProjectOrder)
      ? root.unifiedProjectOrder.filter((key): key is string => typeof key === 'string')
      : [],
    unifiedSessionCardHoverButtons: Array.isArray(root.unifiedSessionCardHoverButtons)
      ? root.unifiedSessionCardHoverButtons
      : undefined,
    sidebarHideProjectsWithoutSessions: root.sidebarHideProjectsWithoutSessions === true,
    chiefShowOnAllSpaces: root.chiefShowOnAllSpaces === true,
    chiefConfirmNewChat: root.chiefConfirmNewChat !== false,
    enableSessionParking: root.enableSessionParking !== false,
    sidebarActiveProjects: root.sidebarActiveProjects !== false,
    worktreeSessionsInProject: root.worktreeSessionsInProject !== false,
    mergeRepositoryCopies: root.sidebarMergeRepositoryCopies !== false,
    separateByMachine: root.sidebarSeparateByMachine === true,
    pinnedSessionOrder: root.pinnedSessionOrder === 'recent' ? 'recent' : 'manual',
    capabilities: parseCapabilities(root.capabilities),
  };
}

/** The capability flags the phone uses; other keys are ignored, and only a boolean `true` sets a flag. */
function parseCapabilities(value: unknown): GhostexSummaryCapabilities {
  const flags: JsonObject = isObject(value) ? value : {};
  return {
    awaitingAnswer: boolValue(flags, 'awaitingAnswer', false),
    attentionNotificationId: boolValue(flags, 'attentionNotificationId', false),
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
