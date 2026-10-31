/**
 * The Unified list: every session of every computer, Space and project in one list, with Drafts
 * on top and Working, Snoozed and Parked folded into shelves below.
 *
 * A port of packages/gx-core/src/unified_sidebar/build.rs, the desktop's Unified sidebar builder.
 *
 * CDXC:Sidebar 2026-10-30 WHY:
 * The phone draws the same list as the desktop, so its rules are the desktop's, rule for rule:
 * which shelf a session sits on, its status word, when it last came back to the user, the
 * repository a project is and the filter's choices. The builder cannot run here (gxserver does
 * not link gx-core, and the phone's WebAssembly chat core answers asynchronously from a hidden
 * WebView, too late for the session list), so this is a port, held to the desktop by
 * `unifiedFixture.json`: a gx-core test writes the desktop builder's answers for a set of cases
 * into it and fails when they change, and `unifiedFixture.test.ts` runs the same cases through
 * this file.
 */

import { repoIdentity, type RepoIdentity } from './repo';

export const LOCAL_MACHINE_KEY = 'local';
export const OTHER_SPACE_ID = 'other';

/** One session as the builder reads it. */
export type UnifiedSessionInput = {
  sessionId: string;
  projectId: string;
  /** What the search field reads besides the project and the computer. */
  title?: string;
  branch?: string;
  activity: string;
  awaitingApproval: boolean;
  pendingQuestionCount: number;
  modelSelectionFailed: boolean;
  programStatusFailed: boolean;
  hasBackgroundWork: boolean;
  isPinned: boolean;
  isParked: boolean;
  /** Never sent a message (gxserver's `draftStatus`, the row's pencil). */
  isDraft: boolean;
  isBrowser: boolean;
  createdMs: number | null;
  lastInteractionMs: number | null;
  workingStartedMs: number | null;
  snoozedUntilMs: number | null;
};

export type UnifiedProjectInput = {
  projectId: string;
  title: string;
  path: string;
  gitRemoteOriginUrl: string | null;
  /** A worktree's parent checkout, whose origin or folder it shares. */
  worktreeParentPath: string | null;
  /** A worktree's parent project, whose Space it follows. */
  parentProjectId: string | null;
  /** The project's collection, which a grouped project takes its Space from. */
  collectionId: string | null;
};

export type UnifiedSpaceInput = {
  spaceId: string;
  name: string;
  memberProjectIds: string[];
  memberCollectionIds: string[];
};

/** One computer's projects and sessions. */
export type UnifiedMachineInput<S = unknown> = {
  /** The computer's id; `local` is the desktop's own computer, which shows no name on cards. */
  machine: string;
  /** Whether cards leave this computer's name off (the desktop's own computer). */
  isLocal: boolean;
  label: string;
  /** The computer's Spaces in order, when its Spaces are on. */
  spaces: UnifiedSpaceInput[] | null;
  projects: UnifiedProjectInput[];
  sessions: Array<UnifiedSessionInput & { source?: S }>;
};

export type UnifiedSettings = {
  /** `unifiedWorkingSection`: working sessions fold into the Working shelf. */
  workingSection: boolean;
  /** `enableSessionParking`: parked sessions sit in the Parked shelf. */
  parking: boolean;
};

/** What the filter keeps. An empty list keeps everything of its kind; the kinds narrow together. */
export type UnifiedFilter = {
  repos: string[];
  machines: string[];
  spaces: string[];
  /** What is typed in the header's search field; no pick of the filter menu, and not saved. */
  query?: string;
};

export const EMPTY_UNIFIED_FILTER: UnifiedFilter = { repos: [], machines: [], spaces: [], query: '' };

export function isUnifiedFilterEmpty(filter: UnifiedFilter): boolean {
  return filter.repos.length === 0 && filter.machines.length === 0 && filter.spaces.length === 0;
}

export type UnifiedShelf = 'drafts' | 'pinned' | 'active' | 'working' | 'snoozed' | 'parked';

export type UnifiedStatus = 'Approval' | 'Question' | 'Failed' | 'Working' | 'Waiting' | 'Done';

export type UnifiedRow<S = unknown> = {
  /** `machine|sessionId`. */
  id: string;
  machine: string;
  /** The computer's name, for a session on another computer; `null` for this one. */
  machineLabel: string | null;
  session: UnifiedSessionInput & { source?: S };
  /** The routed id the desktop orders ties by. */
  sidebarSessionId: string;
  repo: RepoIdentity;
  /** `machine|space` of the Space that shows the project; `null` when its computer has Spaces off. */
  spaceKey: string | null;
  shelf: UnifiedShelf;
  status: UnifiedStatus | null;
  cameBackMs: number;
};

export type UnifiedFilterOption = {
  key: string;
  label: string;
  /** What the menu prints after the label: the computers a repository is on, or a Space's computer. */
  detail: string | null;
};

export type UnifiedFilterOptions = {
  repos: UnifiedFilterOption[];
  machines: UnifiedFilterOption[];
  spaces: UnifiedFilterOption[];
};

export type UnifiedView<S = unknown> = {
  drafts: UnifiedRow<S>[];
  pinned: UnifiedRow<S>[];
  active: UnifiedRow<S>[];
  working: UnifiedRow<S>[];
  snoozed: UnifiedRow<S>[];
  parked: UnifiedRow<S>[];
  options: UnifiedFilterOptions;
  /** Rows before the filter, so an empty list can tell "nothing here" from "nothing left". */
  total: number;
};

/** The status a session shows, most urgent first, in the order the desktop row's dots use. */
export function unifiedStatus(session: UnifiedSessionInput): UnifiedStatus | null {
  if (session.awaitingApproval) return 'Approval';
  if (session.pendingQuestionCount > 0) return 'Question';
  if (session.modelSelectionFailed || session.programStatusFailed) return 'Failed';
  if (session.activity === 'working') return 'Working';
  if (session.activity === 'attention') return 'Done';
  if (session.hasBackgroundWork) return 'Waiting';
  return null;
}

/**
 * When a session last came back to the user: started, a turn begun, or a turn ended. While the
 * agent works that is the stint's start; once it stops, the meaningful-activity clock; the
 * creation time is the floor.
 */
export function cameBackMs(session: UnifiedSessionInput): number {
  const created = session.createdMs ?? 0;
  const moment =
    session.activity === 'working'
      ? (session.workingStartedMs ?? session.lastInteractionMs)
      : session.lastInteractionMs;
  return Math.max(created, moment ?? 0);
}

/**
 * The shelf of a session: Snoozed until it wakes, Parked while parking is on, Pinned, Drafts for
 * a session nobody has sent a message to, Working while the Working section is on and its agent
 * works or still runs something in the background, else the list.
 */
export function unifiedShelf(
  session: UnifiedSessionInput,
  settings: UnifiedSettings,
  nowMs: number,
): UnifiedShelf {
  if (session.snoozedUntilMs !== null && session.snoozedUntilMs > nowMs) return 'snoozed';
  if (settings.parking && session.isParked) return 'parked';
  if (session.isPinned) return 'pinned';
  if (session.isDraft) return 'drafts';
  const status = unifiedStatus(session);
  if (settings.workingSection && (status === 'Working' || status === 'Waiting')) return 'working';
  return 'active';
}

export function spaceFilterKey(machineKey: string, spaceId: string): string {
  return `${machineKey}|${spaceId}`;
}

function machineKeyOf(machine: UnifiedMachineInput<unknown>): string {
  return machine.isLocal ? LOCAL_MACHINE_KEY : machine.machine;
}

/** The Space that shows a project: the first Space in order that claims it, else Other. */
function spaceOfProject(spaces: UnifiedSpaceInput[], project: UnifiedProjectInput): string {
  const claimed = spaces.find((space) =>
    project.collectionId !== null
      ? space.memberCollectionIds.includes(project.collectionId)
      : space.memberProjectIds.includes(project.parentProjectId ?? project.projectId),
  );
  return claimed?.spaceId ?? OTHER_SPACE_ID;
}

/** Byte order, as the desktop compares strings. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repoDisambiguator(key: string): string {
  if (key.startsWith('dir:')) return 'no remote';
  const parts = key.split('/');
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : key;
}

function keeps(filter: UnifiedFilter, row: UnifiedRow<unknown>, machineKey: string): boolean {
  return (
    (filter.repos.length === 0 || filter.repos.includes(row.repo.key)) &&
    (filter.machines.length === 0 || filter.machines.includes(machineKey)) &&
    (filter.spaces.length === 0 || (row.spaceKey !== null && filter.spaces.includes(row.spaceKey)))
  );
}

/** Builds the list. */
/** Whether every word typed in the search field is in a row's title, project, branch or computer. */
function queryMatches(query: string, row: UnifiedRow<unknown>): boolean {
  const words = query.toLowerCase().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return true;
  const haystack = [row.session.title ?? '', row.repo.label, row.session.branch ?? '', row.machineLabel ?? '']
    .join('\n')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function buildUnifiedList<S>(
  machines: UnifiedMachineInput<S>[],
  settings: UnifiedSettings,
  filter: UnifiedFilter,
  nowMs: number,
): UnifiedView<S> {
  const rows: Array<{ row: UnifiedRow<S>; machineKey: string }> = [];
  const repoMachines = new Map<string, { label: string; machines: Set<string> }>();
  const options: UnifiedFilterOptions = { repos: [], machines: [], spaces: [] };
  for (const machine of machines) {
    const machineKey = machineKeyOf(machine);
    options.machines.push({ key: machineKey, label: machine.label, detail: null });
    const remoteName = machine.isLocal ? null : machine.label;
    if (machine.spaces !== null) {
      for (const space of machine.spaces) {
        options.spaces.push({
          key: spaceFilterKey(machineKey, space.spaceId),
          label: space.name,
          detail: remoteName,
        });
      }
      options.spaces.push({
        key: spaceFilterKey(machineKey, OTHER_SPACE_ID),
        label: 'Other',
        detail: remoteName,
      });
    }
    for (const project of machine.projects) {
      const repo = repoIdentity(
        project.gitRemoteOriginUrl,
        project.path,
        project.worktreeParentPath,
        project.title,
      );
      const entry = repoMachines.get(repo.key) ?? { label: repo.label, machines: new Set<string>() };
      entry.machines.add(machine.label);
      repoMachines.set(repo.key, entry);
      const spaceKey =
        machine.spaces === null
          ? null
          : spaceFilterKey(machineKey, spaceOfProject(machine.spaces, project));
      for (const session of machine.sessions) {
        if (session.projectId !== project.projectId || session.isBrowser) continue;
        rows.push({
          machineKey,
          row: {
            id: `${machine.machine}|${session.sessionId}`,
            machine: machine.machine,
            machineLabel: remoteName,
            session,
            sidebarSessionId: machine.isLocal
              ? session.sessionId
              : `${machine.machine}:${session.projectId}:${session.sessionId}`,
            repo: { ...repo },
            spaceKey,
            shelf: unifiedShelf(session, settings, nowMs),
            status: unifiedStatus(session),
            cameBackMs: cameBackMs(session),
          },
        });
      }
    }
  }
  options.repos = [...repoMachines.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      detail:
        entry.machines.size > 1 ? [...entry.machines].sort(compareText).join(', ') : null,
    }));
  options.repos.sort((left, right) =>
    compareText(left.label.toLowerCase(), right.label.toLowerCase()),
  );
  // Two different repositories with the same name (a fork, another owner's, a folder with no
  // remote) say which is which.
  const names = options.repos.map((option) => option.label.toLowerCase());
  options.repos.forEach((option, index) => {
    const shared = names.some((name, other) => other !== index && name === names[index]);
    if (!shared) return;
    const which = repoDisambiguator(option.key);
    option.detail = option.detail === null ? which : `${which} · ${option.detail}`;
  });
  // One repository reads the same on every computer.
  for (const { row } of rows) {
    const option = options.repos.find((candidate) => candidate.key === row.repo.key);
    if (option !== undefined) row.repo.label = option.label;
  }
  const view: UnifiedView<S> = {
    drafts: [],
    pinned: [],
    active: [],
    working: [],
    snoozed: [],
    parked: [],
    options,
    total: rows.length,
  };
  for (const { row, machineKey } of rows) {
    if (keeps(filter, row, machineKey) && queryMatches(filter.query ?? '', row)) view[row.shelf].push(row);
  }
  const tie = (left: UnifiedRow<S>, right: UnifiedRow<S>) =>
    compareText(left.sidebarSessionId, right.sidebarSessionId);
  const newestFirst = (value: (row: UnifiedRow<S>) => number) => (left: UnifiedRow<S>, right: UnifiedRow<S>) =>
    value(right) - value(left) || tie(left, right);
  view.drafts.sort(newestFirst((row) => row.session.createdMs ?? 0));
  view.pinned.sort(newestFirst((row) => row.cameBackMs));
  view.active.sort(newestFirst((row) => row.cameBackMs));
  view.working.sort(newestFirst((row) => row.session.workingStartedMs ?? 0));
  view.snoozed.sort(
    (left, right) =>
      (left.session.snoozedUntilMs ?? Number.MAX_SAFE_INTEGER) -
        (right.session.snoozedUntilMs ?? Number.MAX_SAFE_INTEGER) || tie(left, right),
  );
  view.parked.sort(newestFirst((row) => row.session.lastInteractionMs ?? 0));
  return view;
}
