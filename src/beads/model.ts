/**
 * The phone Beads view's data: gxserver's `/api/beadsView` snapshot, parsed with every field
 * optional (an older computer leaves newer ones out), and the tree the Beads screen lists.
 *
 * The tree itself comes from the desktop's rules in the WebAssembly core (`tree.ts`). The few
 * date words here are the sync line's and a comment's age, and the date a Defer preset sends.
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

// ---- time (as gx-core beads_view/time.rs says it) ----

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

/** The local date `days` after today, as bd's `--until` takes it (`YYYY-MM-DD`). */
export function localDateAfter(days: number, now = Date.now()): string {
  const date = new Date(now);
  date.setDate(date.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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
