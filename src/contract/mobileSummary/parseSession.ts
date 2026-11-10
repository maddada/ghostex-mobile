/**
 * Parsing and normalizing one wire session.
 * Part of the mobile summary contract (`./index.ts`).
 */

import { parseClaudeCloud } from '../claudeCloud';
import { programStatusFailed, programStatusLine } from '../programStatus';
import { boolValue, firstNonEmpty, isObject, parseRemoteThreads, trimmedValue, type JsonObject } from './json';
import type {
  GhostexGbotsChat,
  GhostexSessionActions,
  GhostexSessionLink,
  GhostexSessionLinks,
  GhostexSessionWork,
} from './model';
import type { GhostexAttentionKind, GhostexSession } from './session';
import {
  deriveIsLive,
  normalizeStatusToken,
  normalizedNativePaneState,
  normalizedProviderSessionState,
  normalizedToken,
} from './status';

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

/**
 * A link's `kind` on the wire: `pullRequest`, `issue`, `linear`, or a ticket command's id, which
 * draws as a generic ticket (gx-core `kind_of`), never with the Linear logo.
 */
export function linkKind(value: string): GhostexSessionLink['kind'] {
  return value === 'pullRequest' || value === 'issue' || value === 'linear' ? value : 'ticket';
}

/** One entry of `items`, `suggested` or `removed`; null without a key. */
function parseSessionLink(item: unknown): GhostexSessionLink | null {
  if (!isObject(item)) return null;
  const key = trimmedValue(item, 'key');
  if (key.length === 0) return null;
  return {
    key,
    kind: linkKind(trimmedValue(item, 'kind')),
    label: trimmedValue(item, 'label'),
    title: trimmedValue(item, 'title'),
    state: trimmedValue(item, 'state'),
    stateName: trimmedValue(item, 'stateName'),
    checks: trimmedValue(item, 'checks'),
    review: trimmedValue(item, 'review'),
    url: trimmedValue(item, 'url'),
    source: trimmedValue(item, 'source'),
    sourceLabel: trimmedValue(item, 'sourceLabel'),
    finished: item.finished === true,
    pinned: item.pinned === true,
    loading: item.loading === true,
    branch: trimmedValue(item, 'branch'),
  };
}

/** `PresentationSessionLinks` as the summary forwards it; undefined when it lists nothing. */
function parseSessionLinks(value: unknown): GhostexSessionLinks | undefined {
  if (!isObject(value)) return undefined;
  const parse = (list: unknown): GhostexSessionLink[] =>
    (Array.isArray(list) ? list : []).map(parseSessionLink).filter((link): link is GhostexSessionLink => link !== null);
  const items = parse(value.items);
  const suggested = parse(value.suggested);
  const removed = parse(value.removed);
  return items.length > 0 || suggested.length > 0 || removed.length > 0 ? { items, suggested, removed } : undefined;
}

function parseSessionWork(value: unknown): GhostexSessionWork | null {
  if (!isObject(value)) return null;
  const linearIssues: GhostexSessionWork['linearIssues'] = [];
  if (Array.isArray(value.linearIssues)) {
    for (const issue of value.linearIssues) {
      if (!isObject(issue)) continue;
      const identifier = trimmedValue(issue, 'identifier');
      if (identifier.length > 0) {
        linearIssues.push({
          identifier,
          url: trimmedValue(issue, 'url'),
          title: trimmedValue(issue, 'title'),
          stateType: trimmedValue(issue, 'stateType'),
          stateName: trimmedValue(issue, 'stateName'),
        });
      }
    }
  }
  const githubIssues = (Array.isArray(value.githubIssues) ? value.githubIssues.filter(isObject) : []).flatMap(
    (issue) =>
      typeof issue.number === 'number'
        ? [
            {
              number: issue.number,
              title: trimmedValue(issue, 'title'),
              state: trimmedValue(issue, 'state'),
              url: trimmedValue(issue, 'url'),
            },
          ]
        : [],
  );
  const pullRequest = isObject(value.pullRequest) ? value.pullRequest : null;
  const pullRequestNumber = pullRequest === null ? undefined : pullRequest.number;
  return {
    branch: trimmedValue(value, 'branch'),
    pullRequestUrl: pullRequest === null ? '' : trimmedValue(pullRequest, 'url'),
    pullRequestNumber: typeof pullRequestNumber === 'number' ? pullRequestNumber : null,
    pullRequestState: pullRequest === null ? '' : trimmedValue(pullRequest, 'state'),
    pullRequestChecks: pullRequest === null ? '' : trimmedValue(pullRequest, 'checks'),
    linearIssues,
    githubIssues,
    githubIssueUrls: githubIssues.map((issue) => issue.url).filter((url) => url.length > 0),
    githubIssueNumbers: githubIssues.map((issue) => issue.number),
    linearProjectName: isObject(value.linearProject) ? trimmedValue(value.linearProject, 'name') : '',
    linearProjectUrl: isObject(value.linearProject) ? trimmedValue(value.linearProject, 'url') : '',
    githubProjectName: isObject(value.githubProject)
      ? trimmedValue(value.githubProject, 'title') ||
        `${trimmedValue(value.githubProject, 'owner')}/${String(value.githubProject.number ?? '')}`
      : '',
    githubProjectUrl: isObject(value.githubProject) ? trimmedValue(value.githubProject, 'url') : '',
    githubProjectStatus: isObject(value.githubProject) ? trimmedValue(value.githubProject, 'status') : '',
    handSet: value.handSet === true,
    offerCleanup: value.offerCleanup === true,
  };
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
  const providerSessionState = normalizedProviderSessionState(trimmedValue(value, 'providerSessionState'));
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
  const rawSidebarOrder = value.sidebarOrder;

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
    agentbox: parseAgentbox(value.agentbox),
    cloudBox: parseCloudBox(value.cloudBox),
    hasComposerDraft: value.hasComposerDraft === true ? true : undefined,
    lastInteractionAt: trimmedValue(value, 'lastInteractionAt'),
    lastActiveAt: trimmedValue(value, 'lastActiveAt'),
    primaryTitle: trimmedValue(value, 'primaryTitle'),
    renameFailedTitle: trimmedValue(value, 'renameFailedTitle'),
    renameFailedAt: trimmedValue(value, 'renameFailedAt'),
    terminalTitle: trimmedValue(value, 'terminalTitle'),
    titleSource: trimmedValue(value, 'titleSource'),
    trustedResumeTitle: trimmedValue(value, 'trustedResumeTitle'),
    updatedAt: trimmedValue(value, 'updatedAt'),
    zmxName: trimmedValue(value, 'zmxName'),
    nativePaneState,
    providerSessionState,
    sortOrder: typeof rawSortOrder === 'number' && Number.isFinite(rawSortOrder) ? rawSortOrder : null,
    sidebarOrder: typeof rawSidebarOrder === 'number' && Number.isFinite(rawSidebarOrder) ? rawSidebarOrder : null,
    isFocused: boolValue(value, 'isFocused', false),
    isFavorite: boolValue(value, 'isFavorite', false),
    // Chief of Staff is always pinned (gx-core `SessionRow::is_pinned`).
    isPinned: boolValue(value, 'isPinned', false) || value.isChief === true,
    isParked: boolValue(value, 'isParked', false),
    gitBranch: isObject(value.gitStatus) ? trimmedValue(value.gitStatus, 'branch') : '',
    work: parseSessionWork(value.work) ?? undefined,
    claudeCloud: parseClaudeCloud(value.claudeCloud),
    links: parseSessionLinks(value.links),
    sessionTag: trimmedValue(value, 'sessionTag'),
    delayedSendRemainingLabel: trimmedValue(value, 'delayedSendRemainingLabel'),
    delayedSendDeadlineAt: trimmedValue(value, 'delayedSendDeadlineAt'),
    queuedPromptCount:
      typeof value.queuedPromptCount === 'number' && Number.isFinite(value.queuedPromptCount)
        ? Math.max(0, Math.floor(value.queuedPromptCount))
        : 0,
    queuedPromptFailedCount:
      typeof value.queuedPromptFailedCount === 'number' && Number.isFinite(value.queuedPromptFailedCount)
        ? Math.max(0, Math.floor(value.queuedPromptFailedCount))
        : 0,
    sessionNote: trimmedValue(value, 'sessionNote'),
    isCoordinator: trimmedValue(value, 'coordinatorRole') === 'coordinator',
    isMainCoordinator: trimmedValue(value, 'coordinatorRole') === 'coordinator' && value.isMainCoordinator === true,
    isChief: value.isChief === true,
    gbotsChat: parseGbotsChat(value.gbotsChat),
    coordinatorProjectId: trimmedValue(value, 'coordinatorProjectId'),
    coordinatorSessionId: trimmedValue(value, 'coordinatorSessionId'),
    coordinatorThreadState: trimmedValue(value, 'coordinatorThreadState'),
    coordinatorRemoteThreads: parseRemoteThreads(value.coordinatorRemoteThreads),
    stuckSince: trimmedValue(value, 'stuckSince'),
    sideChatParentSessionId: trimmedValue(value, 'sideChatParentSessionId'),
    agentSessionId: trimmedValue(value, 'agentSessionId'),
    sendWhenAllProjectSessionsStopActive: boolValue(value, 'sendWhenAllProjectSessionsStopActive', false),
    sendWhenAgentStopsActive: boolValue(value, 'sendWhenAgentStopsActive', false),
    closeAfterDone: boolValue(value, 'closeAfterDone', false),
    closeAfterDoneDeadlineAt: trimmedValue(value, 'closeAfterDoneDeadlineAt'),
    pendingQuestionCount:
      typeof value.pendingQuestionCount === 'number' && Number.isFinite(value.pendingQuestionCount)
        ? Math.max(0, Math.floor(value.pendingQuestionCount))
        : 0,
    backgroundWorkDetectedAt: trimmedValue(value, 'backgroundWorkDetectedAt'),
    awaitingApproval: boolValue(value, 'awaitingApproval', false),
    awaitingAnswer: boolValue(value, 'awaitingAnswer', false),
    programStatusLine: programStatusLine(value.programStatus),
    programStatusFailed: programStatusFailed(value.programStatus),
    workingStartedAt: trimmedValue(value, 'workingStartedAt'),
    modelSelectionFailed:
      trimmedValue(value, 'modelSelectionFailure').length > 0 ||
      trimmedValue(value, 'sendFailure').length > 0 ||
      trimmedValue(value, 'blockedSince').length > 0,
    blockedSince: trimmedValue(value, 'blockedSince') || undefined,
    blockedReason: trimmedValue(value, 'blockedSince') ? trimmedValue(value, 'blockedReason') || undefined : undefined,
    snoozedUntil: trimmedValue(value, 'snoozedUntil'),
    isSleeping: legacySleeping && !isLive,
    isLive,
    isPrimaryTitleTerminalTitle: boolValue(value, 'isPrimaryTitleTerminalTitle', false),
    isTemporaryTitle: boolValue(value, 'isTemporaryTitle', false),
    visibleInSidebarByDefault: boolValue(value, 'visibleInSidebarByDefault', false),
    shouldSubmitStagedFirstPromptTitleCommand: boolValue(value, 'shouldSubmitStagedFirstPromptTitleCommand', false),
    attentionEnteredAt: attention === null ? '' : trimmedValue(attention, 'enteredAt'),
    attentionAcknowledged: attention === null ? false : boolValue(attention, 'acknowledged', false),
    attentionEventId: attention === null ? '' : trimmedValue(attention, 'eventId'),
    attentionNotificationId: attention === null ? '' : trimmedValue(attention, 'notificationId'),
    attentionKind: attention === null ? '' : attentionKindOf(attention),
    attentionHandoverNeedsYou: attention === null ? false : boolValue(attention, 'handoverNeedsYou', false),
    attentionAlerts: attention === null || typeof attention.alerts !== 'boolean' ? null : attention.alerts,
    attentionWorkingStartedAt: attention === null ? '' : trimmedValue(attention, 'workingStartedAt'),
    actions: parseActions(value.actions),
  };
}

/** `attention.kind` as the host defines it; any other value reads as no kind. */
function attentionKindOf(attention: JsonObject): GhostexAttentionKind {
  const kind = trimmedValue(attention, 'kind');
  return kind === 'finished' || kind === 'needsInput' ? kind : '';
}

function parseGbotsChat(value: unknown): GhostexGbotsChat | undefined {
  if (!isObject(value)) return undefined;
  const botId = trimmedValue(value, 'botId');
  if (botId.length === 0) return undefined;
  return { botId, openedBy: trimmedValue(value, 'openedBy') || 'user' };
}

/** `PresentationAgentbox` as the summary forwards it, or undefined for a session on the computer. */
function parseAgentbox(value: unknown): GhostexSession['agentbox'] {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const provider = text('provider');
  const boxName = text('boxName');
  if (provider.length === 0 || boxName.length === 0) return undefined;
  return {
    provider,
    boxName,
    providerLabel: text('providerLabel'),
    pending: record.pending === true ? true : undefined,
  };
}

/**
 * `PresentationCloudBox` as gxserver sends it, or what src/cloudBoxes/boxSessions.ts stamped on a
 * box's session; undefined for a session on the computer.
 */
function parseCloudBox(value: unknown): GhostexSession['cloudBox'] {
  if (value === null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string).trim() : '');
  const boxId = text('boxId');
  // A home draft's box does not exist yet (`pending`), so it may have no id.
  if (boxId.length === 0 && record.pending !== true) return undefined;
  return {
    boxId,
    provider: text('provider'),
    state: text('state'),
    boxName: text('boxName'),
    homeProjectId: text('homeProjectId') || undefined,
    pending: record.pending === true ? true : undefined,
    machineId: text('machineId') || undefined,
    boxProjectId: text('boxProjectId') || undefined,
    startedAt: text('startedAt') || undefined,
    costTotalUsd: typeof record.costTotalUsd === 'number' ? record.costTotalUsd : undefined,
    usdPerHour: typeof record.usdPerHour === 'number' ? record.usdPerHour : undefined,
  };
}
