/**
 * The phone Beads view's data: gxserver's `/api/beadsView` snapshot, parsed with every field
 * optional (an older computer leaves newer ones out), and the tree the Beads screen lists.
 *
 * The tree follows the desktop's rules in `packages/gx-core/src/beads_view/tree.rs` (`build_tree`):
 * beads waiting on a person pinned on top, every other bead under its epic, "Not in an epic" last,
 * done beads folded per section, filters that keep the tree's shape. Change both together.
 *
 * SEE-ALSO: packages/gx-protocol/src/beads_view.rs, packages/gx-core/src/beads_view/time.rs
 */

export type BeadsWorkspaceState = 'ready' | 'none' | 'noBd' | 'failed';
export type BeadsReadiness = 'ok' | 'unavailable' | 'paused';

export type BeadsRow = {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  issueType: string;
  assignee: string | null;
  labels: string[];
  parent: string | null;
  deferUntil: string | null;
  dueAt: string | null;
  updatedAt: string;
  commentCount: number;
  ready: boolean | null;
  blockedBy: string[] | null;
  needsDecision: boolean;
};

export type BeadsSyncResult = {
  kind: string;
  ok: boolean;
  code: string;
  message: string;
  output: string;
  at: string;
};

export type BeadsSync = {
  remote: { name: string; url: string } | null;
  running: { kind: string; startedAt: string } | null;
  lastPushAt: string | null;
  lastPullAt: string | null;
  lastResult: BeadsSyncResult | null;
};

export type BeadsSnapshot = {
  workspace: {
    state: BeadsWorkspaceState;
    key: string;
    path: string;
    prefix: string;
    message: string | null;
    checkedFolder: string | null;
  };
  capabilities: string[];
  revision: string;
  unchanged: boolean;
  busy: boolean;
  readiness: BeadsReadiness;
  error: string | null;
  beads: BeadsRow[] | null;
  sync: BeadsSync;
};

type Raw = Record<string, unknown>;

const obj = (value: unknown): Raw => (value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {});
const str = (value: unknown): string => (typeof value === 'string' ? value : '');
const optStr = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);

function rowFrom(raw: unknown): BeadsRow | null {
  const row = obj(raw);
  const id = str(row.id);
  if (id.length === 0) return null;
  return {
    id,
    title: str(row.title),
    status: str(row.status),
    priority: typeof row.priority === 'number' ? row.priority : null,
    issueType: str(row.issueType),
    assignee: optStr(row.assignee),
    labels: strings(row.labels),
    parent: optStr(row.parent),
    deferUntil: optStr(row.deferUntil),
    dueAt: optStr(row.dueAt),
    updatedAt: str(row.updatedAt),
    commentCount: typeof row.commentCount === 'number' ? row.commentCount : 0,
    ready: typeof row.ready === 'boolean' ? row.ready : null,
    blockedBy: Array.isArray(row.blockedBy) ? strings(row.blockedBy) : null,
    needsDecision: row.needsDecision === true,
  };
}

function syncResultFrom(raw: unknown): BeadsSyncResult | null {
  const result = obj(raw);
  if (typeof result.ok !== 'boolean') return null;
  return {
    kind: str(result.kind),
    ok: result.ok,
    code: str(result.code),
    message: str(result.message),
    output: str(result.output),
    at: str(result.at),
  };
}

export function snapshotFrom(raw: unknown): BeadsSnapshot {
  const answer = obj(raw);
  const workspace = obj(answer.workspace);
  const sync = obj(answer.sync);
  const remote = obj(sync.remote);
  const running = obj(sync.running);
  const state = str(workspace.state);
  const readiness = str(answer.readiness);
  return {
    workspace: {
      state: state === 'ready' || state === 'noBd' || state === 'failed' ? state : 'none',
      key: str(workspace.key),
      path: str(workspace.path),
      prefix: str(workspace.prefix),
      message: optStr(workspace.message),
      checkedFolder: optStr(workspace.checkedFolder),
    },
    capabilities: strings(answer.capabilities),
    revision: str(answer.revision),
    unchanged: answer.unchanged === true,
    busy: answer.busy === true,
    readiness: readiness === 'unavailable' || readiness === 'paused' ? readiness : 'ok',
    error: optStr(answer.error),
    beads: Array.isArray(answer.beads) ? answer.beads.map(rowFrom).filter((row): row is BeadsRow => row !== null) : null,
    sync: {
      remote: str(remote.name).length > 0 ? { name: str(remote.name), url: str(remote.url) } : null,
      running: str(running.kind).length > 0 ? { kind: str(running.kind), startedAt: str(running.startedAt) } : null,
      lastPushAt: optStr(sync.lastPushAt),
      lastPullAt: optStr(sync.lastPullAt),
      lastResult: syncResultFrom(sync.lastResult),
    },
  };
}

/** A `knownRevision` answer keeps the rows the phone already has. */
export function mergeSnapshot(previous: BeadsSnapshot | null, next: BeadsSnapshot): BeadsSnapshot {
  if (next.unchanged && previous !== null) return { ...next, beads: previous.beads };
  return next;
}

export const BEADS_LINKS_CAPABILITY = 'links';
export const BEADS_SYNC_CAPABILITY = 'sync';

// ---- time (gx-core beads_view/time.rs) ----

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** bd's timestamps: `YYYY-MM-DDTHH:MM:SS`, optional fraction, then `Z` or `±HH:MM`; a bare date is midnight UTC. */
export function parseBdTime(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|z|[+-]\d{2}:\d{2})?)?$/u.exec(text.trim());
  if (match === null) return null;
  const [, y, mo, d, h, mi, s, zone] = match;
  const base = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  if (zone === undefined || zone === 'Z' || zone === 'z') return base;
  const sign = zone.startsWith('-') ? -1 : 1;
  return base - sign * (Number(zone.slice(1, 3)) * HOUR_MS + Number(zone.slice(4, 6)) * MINUTE_MS);
}

/** "4 min ago", "2 h ago", "3 days ago", for the sync line. */
export function relativeAgo(time: number, now = Date.now()): string {
  const age = Math.max(0, now - time);
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  const days = Math.floor(age / DAY_MS);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function localDay(time: number): number {
  const date = new Date(time);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** A date as a row says it: "today", "tomorrow", the weekday within a week ("Fri"), else "Mon, Nov 17". */
export function shortDate(time: number, alwaysMonth: boolean, now = Date.now()): string {
  const day = localDay(time);
  const today = localDay(now);
  if (day === today) return 'today';
  if (day === today + 1) return 'tomorrow';
  const date = new Date(time);
  const weekday = WEEKDAYS[date.getDay()];
  if (!alwaysMonth && day > today && day - today < 7) return weekday;
  return `${weekday}, ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** The local date `days` after today, as bd's `--until` takes it (`YYYY-MM-DD`). */
export function localDateAfter(days: number, now = Date.now()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---- tree (gx-core beads_view/tree.rs) ----

export type BeadsFilter = 'all' | 'needsDecision' | 'ready' | 'inProgress' | 'blocked' | 'deferred';

export const BEADS_FILTERS: { key: BeadsFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'needsDecision', label: 'Needs a decision' },
  { key: 'ready', label: 'Ready' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'deferred', label: 'Deferred' },
];

const needsReadiness = (filter: BeadsFilter) => filter === 'ready' || filter === 'blocked';

export const isClosed = (row: BeadsRow) => row.status === 'closed';
export const isEpic = (row: BeadsRow) => row.issueType === 'epic';
export const isBlocked = (row: BeadsRow) => row.status === 'blocked' || (row.blockedBy?.length ?? 0) > 0;

export function matchesFilter(row: BeadsRow, filter: BeadsFilter): boolean {
  if (isClosed(row)) return filter === 'all';
  switch (filter) {
    case 'all':
      return true;
    case 'needsDecision':
      return row.needsDecision;
    case 'ready':
      return row.ready === true;
    case 'inProgress':
      return row.status === 'in_progress';
    case 'blocked':
      return isBlocked(row);
    case 'deferred':
      return row.status === 'deferred';
  }
}

function matchesQuery(row: BeadsRow, query: string): boolean {
  if (query.length === 0) return true;
  return (
    row.title.toLowerCase().includes(query) ||
    row.id.toLowerCase().includes(query) ||
    row.labels.some((label) => label.toLowerCase().includes(query))
  );
}

/** "In progress", "In review", "Backlog": a status name as people say it. */
export function statusLabel(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'In progress';
    case 'review':
      return 'In review';
    case 'test':
      return 'In test';
    case 'open':
      return 'Open';
    case 'closed':
      return 'Done';
    case 'deferred':
      return 'Deferred';
    case 'blocked':
      return 'Blocked';
    default: {
      const spaced = status.replace(/[_-]/gu, ' ');
      return spaced.length > 0 ? spaced[0].toUpperCase() + spaced.slice(1) : '';
    }
  }
}

export const typeLabel = statusLabel;

export type BeadGlyph = 'open' | 'inProgress' | 'blocked' | 'snoozed' | 'onIce' | 'review' | 'decision' | 'closed' | 'epic';

export function glyphOf(row: BeadsRow): BeadGlyph {
  if (isClosed(row)) return 'closed';
  if (row.needsDecision) return 'decision';
  if (row.status === 'in_progress') return 'inProgress';
  if (row.status === 'deferred') return row.deferUntil !== null ? 'snoozed' : 'onIce';
  if (row.status === 'review' || row.status === 'test') return 'review';
  if (isBlocked(row)) return 'blocked';
  if (isEpic(row)) return 'epic';
  return 'open';
}

export type BeadRowModel = {
  id: string;
  title: string;
  glyph: BeadGlyph;
  /** "Task", "In Epic one", "Waiting on …", "Until Fri", "On ice", "Due Mon, Nov 17", a custom status. */
  meta: string[];
  labels: string[];
  commentCount: number;
  priority: string | null;
  assignee: string | null;
  closed: boolean;
};

export type EpicSummary = { total: number; done: number; text: string };

export type BeadsSection = {
  key: string;
  kind: 'needsDecision' | 'epic' | 'notInEpic';
  title: string;
  epic: BeadRowModel | null;
  count: number;
  summary: EpicSummary | null;
  rows: BeadRowModel[];
  doneRows: BeadRowModel[];
  doneCount: number;
  doneOpen: boolean;
  collapsed: boolean;
};

export type BeadsTree = {
  sections: BeadsSection[];
  counts: Record<BeadsFilter, number>;
  readinessOk: boolean;
};

export type BeadsTreeOptions = {
  filter: BeadsFilter;
  query: string;
  openDone: ReadonlySet<string>;
  collapsed: ReadonlySet<string>;
};

function sortRows(rows: BeadsRow[], byChange = false): BeadsRow[] {
  const changed = (row: BeadsRow) => parseBdTime(row.updatedAt) ?? 0;
  return rows.sort((a, b) => {
    if (!byChange) {
      const priority = (a.priority ?? 9) - (b.priority ?? 9);
      if (priority !== 0) return priority;
    }
    const age = changed(b) - changed(a);
    if (age !== 0) return age;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** The nearest epic above a bead, following parents. */
export function epicOf(row: BeadsRow, byId: ReadonlyMap<string, BeadsRow>): BeadsRow | null {
  let current = row.parent;
  for (let seen = 0; current !== null && seen <= 32; seen += 1) {
    const parent = byId.get(current);
    if (parent === undefined) return null;
    if (isEpic(parent)) return parent;
    current = parent.parent;
  }
  return null;
}

export function rowModel(
  row: BeadsRow,
  byId: ReadonlyMap<string, BeadsRow>,
  readinessOk: boolean,
  epicTitle: string | null,
  now = Date.now(),
): BeadRowModel {
  const meta = [typeLabel(row.issueType)];
  if (epicTitle !== null) meta.push(`In ${epicTitle}`);
  if (readinessOk && !isClosed(row) && row.blockedBy !== null && row.blockedBy.length > 0) {
    const first = row.blockedBy[0];
    const more = row.blockedBy.length - 1;
    meta.push(`Waiting on ${byId.get(first)?.title ?? first}${more > 0 ? ` +${more}` : ''}`);
  }
  if (row.status === 'deferred') {
    const until = parseBdTime(row.deferUntil);
    meta.push(until !== null ? `Until ${shortDate(until, true, now)}` : 'On ice');
  }
  if (!isClosed(row)) {
    const due = parseBdTime(row.dueAt);
    if (due !== null) meta.push(`Due ${shortDate(due, false, now)}`);
  }
  if (!['open', 'in_progress', 'closed', 'deferred', 'blocked'].includes(row.status)) meta.push(statusLabel(row.status));
  return {
    id: row.id,
    title: row.title,
    glyph: glyphOf(row),
    meta,
    labels: row.labels.filter((label) => label !== 'human'),
    commentCount: row.commentCount,
    priority: row.priority !== null ? `P${row.priority}` : null,
    assignee: row.assignee,
    closed: isClosed(row),
  };
}

type Members = { total: number; done: number; inProgress: number; blocked: number; ready: number; needsDecision: number };

function summaryText(m: Members): string {
  const parts = [`${m.done} of ${m.total} done`];
  if (m.inProgress > 0) parts.push(`${m.inProgress} in progress`);
  if (m.blocked > 0) parts.push(`${m.blocked} blocked`);
  if (m.ready > 0) parts.push(`${m.ready} ready`);
  if (m.needsDecision > 0) parts.push(`${m.needsDecision} ${m.needsDecision === 1 ? 'needs' : 'need'} a decision`);
  return parts.join(' · ');
}

export function epicSummary(members: BeadsRow[], readinessOk: boolean): EpicSummary {
  const m: Members = {
    total: members.length,
    done: members.filter(isClosed).length,
    inProgress: members.filter((row) => row.status === 'in_progress').length,
    blocked: readinessOk ? members.filter((row) => !isClosed(row) && isBlocked(row)).length : 0,
    ready: readinessOk ? members.filter((row) => !isClosed(row) && row.ready === true).length : 0,
    needsDecision: members.filter((row) => row.needsDecision).length,
  };
  return { total: m.total, done: m.done, text: summaryText(m) };
}

export function buildTree(rows: BeadsRow[], readiness: BeadsReadiness, options: BeadsTreeOptions, now = Date.now()): BeadsTree {
  const readinessOk = readiness === 'ok';
  const byId = new Map(rows.map((row) => [row.id, row]));
  const query = options.query.trim().toLowerCase();
  const counts = {} as Record<BeadsFilter, number>;
  for (const { key } of BEADS_FILTERS) {
    counts[key] = rows.filter((row) => !isEpic(row) && !isClosed(row) && matchesFilter(row, key) && matchesQuery(row, query)).length;
  }
  const filter: BeadsFilter = !readinessOk && needsReadiness(options.filter) ? 'all' : options.filter;
  const keep = (row: BeadsRow) => matchesQuery(row, query) && matchesFilter(row, filter);
  const model = (row: BeadsRow, epicTitle: string | null = null) => rowModel(row, byId, readinessOk, epicTitle, now);

  const epics = sortRows(rows.filter(isEpic));
  const children = new Map<string, BeadsRow[]>();
  const loose: BeadsRow[] = [];
  const decisions: BeadsRow[] = [];
  for (const row of rows) {
    if (isEpic(row)) continue;
    if (row.needsDecision) decisions.push(row);
    const epic = epicOf(row, byId);
    if (epic === null) loose.push(row);
    else children.set(epic.id, [...(children.get(epic.id) ?? []), row]);
  }

  const sections: BeadsSection[] = [];
  const decisionRows = sortRows(decisions.filter(keep));
  if (decisionRows.length > 0) {
    sections.push({
      key: 'decisions',
      kind: 'needsDecision',
      title: 'Needs a decision',
      epic: null,
      count: decisionRows.length,
      summary: null,
      rows: decisionRows.map((row) => model(row, epicOf(row, byId)?.title ?? null)),
      doneRows: [],
      doneCount: 0,
      doneOpen: false,
      collapsed: false,
    });
  }

  const buildSection = (
    key: string,
    kind: 'epic' | 'notInEpic',
    title: string,
    epic: BeadsRow | null,
    members: BeadsRow[],
    epicMatches: boolean,
  ): BeadsSection | null => {
    const open = sortRows(
      members.filter((row) => !isClosed(row) && !row.needsDecision && (epicMatches || keep(row)) && matchesFilter(row, filter)),
    );
    const done = sortRows(
      members.filter((row) => isClosed(row) && (epicMatches || matchesQuery(row, query))),
      true,
    );
    const showDoneRows = filter === 'all';
    const unfiltered = showDoneRows && (query.length === 0 || epicMatches);
    const visible = open.length > 0 || (unfiltered && done.length > 0) || (unfiltered && kind === 'epic' && members.length === 0);
    if (!visible) return null;
    const doneOpen = options.openDone.has(key);
    return {
      key,
      kind,
      title,
      epic: epic !== null ? model(epic) : null,
      count: open.length,
      summary: kind === 'epic' ? epicSummary(members, readinessOk) : null,
      rows: open.map((row) => model(row)),
      doneRows: showDoneRows && doneOpen ? done.map((row) => model(row)) : [],
      doneCount: showDoneRows ? done.length : 0,
      doneOpen,
      collapsed: options.collapsed.has(key),
    };
  };

  for (const epic of epics) {
    if (isClosed(epic)) continue;
    const epicMatches = query.length > 0 && matchesQuery(epic, query);
    const section = buildSection(epic.id, 'epic', epic.title, epic, children.get(epic.id) ?? [], epicMatches);
    if (section !== null) sections.push(section);
  }
  const looseSection = buildSection('loose', 'notInEpic', 'Not in an epic', null, loose, false);
  if (looseSection !== null) sections.push(looseSection);
  return { sections, counts, readinessOk };
}

// ---- a bead's `show` answer ----

export type BeadComment = { author: string; text: string; createdAt: string };

export type BeadDetails = {
  description: string;
  externalRef: string;
  specId: string;
  assignee: string;
  comments: BeadComment[];
};

/** bd's `show --json` answer (an array or `{data}`), as runBeadsAction returns it (`issue` or `stdout`). */
export function detailsFrom(reply: unknown): BeadDetails | null {
  const answer = obj(reply);
  let issue: unknown = answer.issue;
  if (issue === undefined && typeof answer.stdout === 'string') {
    try {
      const parsed: unknown = JSON.parse(answer.stdout);
      const data = obj(parsed).data ?? parsed;
      issue = Array.isArray(data) ? data[0] : data;
    } catch {
      return null;
    }
  }
  if (issue === undefined || issue === null) return null;
  const shown = obj(issue);
  const comments = Array.isArray(shown.comments) ? shown.comments : [];
  return {
    description: str(shown.description),
    externalRef: str(shown.external_ref).trim(),
    specId: str(shown.spec_id).trim(),
    assignee: str(shown.assignee),
    comments: comments.map((comment) => {
      const entry = obj(comment);
      return { author: str(entry.author), text: str(entry.text), createdAt: str(entry.created_at) };
    }),
  };
}

/** A link as the row shows it: a URL without its scheme, a path as it is. */
export function linkLabel(link: string): string {
  return link.replace(/^https?:\/\//u, '').replace(/\/$/u, '');
}

export const isWebLink = (link: string) => /^https?:\/\//iu.test(link);
