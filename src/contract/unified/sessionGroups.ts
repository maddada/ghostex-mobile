/**
 * Group sessions by tags: the Unified list's cards (Drafts, Pinned, Snoozed and Parked aside) in groups, in the order
 * of the Session Tags list. The six status entries group by what a session's agent is doing, a hand tag by the tag a
 * session carries, No tag by its absence; the first enabled and visible entry that applies to a card decides its
 * group, and a card no entry applies to stays in an unheaded list after the groups.
 *
 * The status comes from `unifiedStatus` (./build.ts), the rule the row's own status mark uses, with one split: its
 * attention (`Done`) is a finished turn only when `attention.kind` says so, otherwise a wait for the user. A
 * coordinator's card stands where the most urgent session of its tree stands, by the six entries' default order.
 *
 * SEE-ALSO: packages/gx-core/src/unified_sidebar/ on the computer, which groups the desktop's Unified sidebar by the
 * same rule and the same synced `groupSessionsByTags` and `sidebarSessionTagListItems`.
 */

import { SessionGroupsCopy } from '../../copy';
import type { GhostexCustomSessionTags } from '../mobileSummary/model';
import {
  isStatusTagId,
  normalizeTagListItems,
  STATUS_TAG_IDS,
  type StatusTagId,
  type TagListItem,
} from '../sessionTagList';
import { SESSION_TAG_SECTIONS } from '../sessionTags';
import {
  unifiedStatus,
  type UnifiedRow,
  type UnifiedSessionInput,
  type UnifiedSettings,
  type UnifiedView,
} from './build';
import { orderedRepoKeys } from './grouping';
import { rowsInTree } from './tree';

/**
 * Where three kinds of session stand, kept here, beside the mapper, and the same in the computer's port:
 * - `plainWaitAfterFailure`: a wait for input on a session whose model change, program or agent failed stands in
 *   Error, as `unifiedStatus` checks a failure before attention (false: in Needs you);
 * - `unknownAttentionIsInputWait`: an attention without a kind (a computer that does not send it) is a wait for
 *   input, in Needs you, as the folded display's triage counts it (false: in Finished (not yet read));
 * - `finishedHandoverStaysFinished`: false, decided by the owner: a finished turn whose handover ends with a Blocked
 *   or Needs-you section is a wait for input, in Needs you (after an approval, a question or a failure, as any wait),
 *   also with background work; a finished turn without it stays in Finished (not yet read).
 */
export const GROUPING_POLICY = {
  plainWaitAfterFailure: true,
  unknownAttentionIsInputWait: true,
  finishedHandoverStaysFinished: false,
} as const;

export type GroupingPolicy = { readonly [K in keyof typeof GROUPING_POLICY]: boolean };

/** The status entry a session belongs to, by `unifiedStatus` with its attention split by `attention.kind`. */
export function sessionGroupStatus(
  session: UnifiedSessionInput,
  policy: GroupingPolicy = GROUPING_POLICY,
): StatusTagId {
  const status = unifiedStatus(session);
  const kind = session.attentionKind ?? '';
  const finishedTurn = kind === 'finished' || (kind === '' && !policy.unknownAttentionIsInputWait);
  const waitsOnUser =
    session.activity === 'attention' &&
    (!finishedTurn ||
      (kind === 'finished' && session.attentionHandoverNeedsYou === true && !policy.finishedHandoverStaysFinished));
  switch (status) {
    case 'Approval':
      return 'status-needs-you';
    case 'Question':
      return 'status-question';
    case 'Failed':
      return waitsOnUser && !policy.plainWaitAfterFailure ? 'status-needs-you' : 'status-error';
    case 'Working':
      return 'status-working';
    case 'Done':
      return waitsOnUser ? 'status-needs-you' : 'status-finished';
    case 'Waiting':
      return 'status-working';
    case null:
      return 'status-idle';
  }
}

/** A card's status entry: the most urgent among it and every thread under it, by the entries' default order. */
export function treeGroupStatus<S>(top: UnifiedRow<S>, policy: GroupingPolicy = GROUPING_POLICY): StatusTagId {
  let rank = STATUS_TAG_IDS.length - 1;
  for (const row of rowsInTree(top))
    rank = Math.min(rank, STATUS_TAG_IDS.indexOf(sessionGroupStatus(row.session, policy)));
  return STATUS_TAG_IDS[rank] ?? 'status-idle';
}

/** The state colours of the status headers, named as the approved design names them. */
export type GroupColorToken = '--failure' | '--question' | '--attention' | '--working' | '--background-work';

/** Each status entry's symbol (the design's icon id) and colour; a hand tag's group takes the neutral colour. */
export const STATUS_GROUP_LOOK: Readonly<Record<StatusTagId, { symbol: string; colorToken: GroupColorToken }>> = {
  'status-needs-you': { symbol: 'alert-triangle', colorToken: '--failure' },
  'status-question': { symbol: 'help-circle', colorToken: '--question' },
  'status-error': { symbol: 'alert-circle', colorToken: '--failure' },
  'status-finished': { symbol: 'circle-check', colorToken: '--attention' },
  'status-working': { symbol: 'circle-dashed', colorToken: '--working' },
  'status-idle': { symbol: 'state-idle', colorToken: '--background-work' },
};

/** What a group's header shows: the entry's symbol, name and colour, and its count of top-level cards. */
export type SessionGroupHeader = {
  /** The Session Tags entry: a status id, a tag id, or `untagged`. */
  id: string;
  kind: 'status' | 'tag' | 'untagged';
  name: string;
  /** The status's icon id, a built-in tag's own id, or a custom tag's catalog icon. */
  symbol: string;
  colorToken: GroupColorToken;
  count: number;
};

/** With Group by project on: one project's cards inside a group, under a heading that neither folds nor drags. */
export type SessionGroupProject<S> = { repoKey: string; label: string; rows: UnifiedRow<S>[] };

export type SessionGroup<S> = {
  key: string;
  /** `null` for the unheaded list of cards no enabled entry applies to. */
  header: SessionGroupHeader | null;
  rows: UnifiedRow<S>[];
  /**
   * The rows by project, in the Unified project order, while Group by project is on; else `null`. Always `null` for
   * the unheaded list, which has no heading of any kind, as on the computer.
   */
  projects: SessionGroupProject<S>[] | null;
};

export type SessionGroupsInput = {
  /** `sidebarSessionTagListItems` as synced (the first-run list when absent). */
  tagList: unknown;
  catalog: GhostexCustomSessionTags | null;
  /** `unifiedProjectOrder`. */
  projectOrder: readonly string[];
  /** `unifiedGroupByProject`. */
  groupByProject: boolean;
};

/**
 * The list's settings while grouping is on: no Moving section, whatever `unifiedWorkingSection` holds (its stored value
 * is kept and applies again once grouping is off).
 */
export function groupedUnifiedSettings(settings: UnifiedSettings, grouping: boolean): UnifiedSettings {
  return grouping && settings.workingSection ? { ...settings, workingSection: false } : settings;
}

const TAG_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SESSION_TAG_SECTIONS.flatMap((section) => section.options.map((option) => [option.value, option.label])),
);

function headerOf(entry: TagListItem, catalog: GhostexCustomSessionTags | null, count: number): SessionGroupHeader {
  if (isStatusTagId(entry.id)) {
    return {
      id: entry.id,
      kind: 'status',
      name: SessionGroupsCopy.status[entry.id],
      ...STATUS_GROUP_LOOK[entry.id],
      count,
    };
  }
  if (entry.kind === 'untagged') {
    return {
      id: entry.id,
      kind: 'untagged',
      name: SessionGroupsCopy.noTag,
      symbol: 'tag',
      colorToken: '--background-work',
      count,
    };
  }
  const custom = catalog?.tags[entry.id];
  return {
    id: entry.id,
    kind: 'tag',
    name: TAG_LABELS[entry.id] ?? custom?.name ?? entry.id,
    symbol: custom?.icon ?? entry.id,
    colorToken: '--background-work',
    count,
  };
}

function applies<S>(entry: TagListItem, top: UnifiedRow<S>, status: StatusTagId): boolean {
  const tag = top.session.sessionTag;
  switch (entry.kind) {
    case 'status':
      return entry.id === status;
    case 'tag':
      return tag === entry.id;
    case 'untagged':
      return tag === undefined || tag === '';
    case 'separator':
      return false;
  }
}

/**
 * The grouping's array inputs (the saved project order and the stored tag list) as one string a memo can depend on,
 * new arrays with the same content giving the same string; JSON keeps every key whole, newlines included.
 */
export function sessionGroupInputsKey(projectOrder: readonly string[], tagList: readonly unknown[] | null): string {
  return JSON.stringify({ projectOrder, tagList });
}

/** The inputs back from `sessionGroupInputsKey`. */
export function sessionGroupInputsOf(key: string): { projectOrder: string[]; tagList: unknown[] | null } {
  const parsed: unknown = JSON.parse(key);
  const object = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const projectOrder = 'projectOrder' in object && Array.isArray(object.projectOrder) ? object.projectOrder : [];
  const tagList = 'tagList' in object && Array.isArray(object.tagList) ? object.tagList : null;
  return { projectOrder: projectOrder.filter((item): item is string => typeof item === 'string'), tagList };
}

/**
 * The active cards (`view.active`) in their groups, in the Session Tags order, then the unheaded rest. Only groups
 * with cards are returned. Inside each, cards follow the Unified project order (the saved order, then A to Z) and,
 * within one project, the list's own order.
 */
export function groupUnifiedBySessionTags<S>(
  view: UnifiedView<S>,
  input: SessionGroupsInput,
  policy: GroupingPolicy = GROUPING_POLICY,
): SessionGroup<S>[] {
  const entries = normalizeTagListItems(input.tagList, input.catalog).filter(
    (entry) => entry.kind !== 'separator' && entry.enabled && entry.visible,
  );
  const repoKeys = orderedRepoKeys(view.options.repos, input.projectOrder);
  const repoPlace = new Map(repoKeys.map((key, index) => [key, index]));
  const place = (row: UnifiedRow<S>) => repoPlace.get(row.repo.key) ?? repoKeys.length;
  const cards = view.active
    .map((row, index) => ({ row, index }))
    .sort((left, right) => place(left.row) - place(right.row) || left.index - right.index)
    .map(({ row }) => row);
  const byEntry = new Map<string, UnifiedRow<S>[]>();
  const rest: UnifiedRow<S>[] = [];
  for (const top of cards) {
    const status = treeGroupStatus(top, policy);
    const entry = entries.find((candidate) => applies(candidate, top, status));
    if (entry === undefined) {
      rest.push(top);
      continue;
    }
    const rows = byEntry.get(entry.id) ?? [];
    rows.push(top);
    byEntry.set(entry.id, rows);
  }
  const projectsOf = (rows: UnifiedRow<S>[]): SessionGroupProject<S>[] | null => {
    if (!input.groupByProject) return null;
    const projects: SessionGroupProject<S>[] = [];
    for (const row of rows) {
      let project = projects[projects.length - 1];
      if (project === undefined || project.repoKey !== row.repo.key) {
        const option = view.options.repos.find((candidate) => candidate.key === row.repo.key);
        project = { repoKey: row.repo.key, label: option?.label ?? row.repo.label, rows: [] };
        projects.push(project);
      }
      project.rows.push(row);
    }
    return projects;
  };
  const groups: SessionGroup<S>[] = [];
  for (const entry of entries) {
    const rows = byEntry.get(entry.id);
    if (rows === undefined) continue;
    groups.push({
      key: entry.id,
      header: headerOf(entry, input.catalog, rows.length),
      rows,
      projects: projectsOf(rows),
    });
  }
  if (rest.length > 0) groups.push({ key: 'ungrouped', header: null, rows: rest, projects: null });
  return groups;
}
