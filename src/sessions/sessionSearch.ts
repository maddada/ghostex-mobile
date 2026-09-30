/**
 * Session search: which open sessions a query keeps, in what order, and under
 * which day heading, as the desktop Quick Access Sessions tab decides it.
 *
 * CDXC:Sessions 2026-09-30 SEE-ALSO:
 * Port of the desktop's session search rules in packages/gx-core/src/quick_access/sessions.rs (`filter_sessions`, `normalize_search_value`, `matches_token`, `visible_items`, `session_groups`) and packages/gx-core/src/quick_access/session_titles.rs (`is_default_session_search_title`), themselves ported from packages/core-ui/previous-session-search.ts. The phone reaches gx-chat-core through UniFFI but not gx-core, so the rules are mirrored here: a change to how the desktop matches, filters, orders or groups sessions changes this file in the same commit. The mobile summary carries no session `detail`, so that one search field is absent on the phone.
 */

import { effectiveSessionTag, resolveSessionTag } from '../contract/sessionTags';
import type { GhostexCustomSessionTags, GhostexSession } from '../contract/mobileSummary';
import { SessionSearchCopy } from '../copy';

// ---------------------------------------------------------------------------
// Text normalization and matching (sessions.rs).
// ---------------------------------------------------------------------------

/** `normalize_search_value`: camelCase split, every run of non-letters one space, lowercase. */
export function normalizeSessionSearchValue(value: string | undefined): string {
  if (value === undefined || value.length === 0) return '';
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .toLowerCase();
}

/** `fuzzy_includes`: the query's characters in order anywhere in the text. */
function fuzzyIncludes(text: string, query: string): boolean {
  let queryIndex = 0;
  for (const character of text) {
    if (character !== query[queryIndex]) continue;
    queryIndex += 1;
    if (queryIndex >= query.length) return true;
  }
  return query.length === 0;
}

/** `single_edit_distance`: equal, or one insertion, deletion or substitution apart. */
function hasSingleEditDistance(candidate: string, query: string): boolean {
  if (candidate === query) return true;
  if (Math.abs(candidate.length - query.length) > 1) return false;
  let candidateIndex = 0;
  let queryIndex = 0;
  let edits = 0;
  while (candidateIndex < candidate.length && queryIndex < query.length) {
    if (candidate[candidateIndex] === query[queryIndex]) {
      candidateIndex += 1;
      queryIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (candidate.length > query.length) {
      candidateIndex += 1;
    } else if (candidate.length < query.length) {
      queryIndex += 1;
    } else {
      candidateIndex += 1;
      queryIndex += 1;
    }
  }
  return true;
}

function isLongQueryTypoCandidate(candidate: string, query: string): boolean {
  return candidate.length >= Math.max(4, query.length - 1) && hasSingleEditDistance(candidate, query);
}

function hasAdjacentWordSingleEditDistance(words: readonly string[], query: string): boolean {
  for (let start = 0; start < words.length; start += 1) {
    let joined = '';
    for (let index = start; index < words.length; index += 1) {
      joined += words[index];
      if (joined.length > query.length + 1) break;
      if (isLongQueryTypoCandidate(joined, query)) return true;
    }
  }
  return false;
}

/** `matches_token`: short tokens match as ordered letters, long ones allow one typo. */
function matchesToken(searchText: string, query: string): boolean {
  if (query.length <= 3) return fuzzyIncludes(searchText, query);
  if (searchText.includes(query)) return true;
  const compact = searchText.replace(/\s+/g, '');
  if ((query.length >= 5 && compact.includes(query)) || hasSingleEditDistance(compact, query)) {
    return true;
  }
  const words = searchText.split(/\s+/).filter((word) => word.length > 0);
  return (
    words.some((word) => isLongQueryTypoCandidate(word, query)) ||
    hasAdjacentWordSingleEditDistance(words, query)
  );
}

// ---------------------------------------------------------------------------
// Default titles a search never lists (session_titles.rs).
// ---------------------------------------------------------------------------

const IGNORED_PLACEHOLDER_SESSION_TITLES: readonly string[] = [
  'terminal session',
  'amp cli session',
  'amp session',
  'antigravity cli session',
  'antigravity session',
  'claude session',
  'claude code session',
  'codebuddy session',
  'code buddy session',
  'codex session',
  'codex cli session',
  'command code session',
  'commandcode session',
  'copilot session',
  'cursor agent session',
  'cursor cli session',
  'cursor session',
  'mastra session',
  'mastra code session',
  'devin session',
  'droid session',
  'factory droid session',
  'gemini session',
  'grok session',
  'grok build session',
  'hermes session',
  'hermes agent session',
  'kimi session',
  'kimi code session',
  'kiro session',
  'kiro cli session',
  'omp session',
  'openclaude session',
  'open claude session',
  'opencode session',
  'open code session',
  'openai codex session',
  'pi session',
  'qoder session',
  'qodercli session',
  'rovo session',
  'rovo dev session',
  'rovodev session',
];

const DEFAULT_SESSION_AGENT_TITLE_NAMES: readonly string[] = [
  'Antigravity CLI',
  'Amp CLI',
  'Claude',
  'CodeBuddy',
  'Codex',
  'Command Code',
  'Copilot',
  'Cursor CLI',
  'Mastra Code',
  'Devin',
  'Factory Droid',
  'Gemini',
  'Grok Build',
  'Hermes Agent',
  'Kimi Code',
  'Kiro CLI',
  'OMP',
  'OpenClaude',
  'OpenCode',
  'Pi',
  'Qoder',
  'Rovo Dev',
];

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

const PLACEHOLDER_TITLES: ReadonlySet<string> = (() => {
  const titles = new Set<string>(IGNORED_PLACEHOLDER_SESSION_TITLES);
  for (const title of IGNORED_PLACEHOLDER_SESSION_TITLES) {
    if (title === 'terminal session') continue;
    if (title.endsWith(' session')) titles.add(`${title.slice(0, -' session'.length)} agent session`);
  }
  for (const name of DEFAULT_SESSION_AGENT_TITLE_NAMES) {
    const normalized = collapseWhitespace(name).toLowerCase();
    if (normalized.length === 0) continue;
    titles.add(`${normalized} session`);
    titles.add(`${normalized} agent session`);
    if (normalized.endsWith(' cli')) titles.add(`${normalized.slice(0, -' cli'.length)} agent session`);
  }
  return titles;
})();

/** `LEADING_TERMINAL_TITLE_STATUS_MARKER_PATTERN` and the `OC |` prefixes `normalize_terminal_title` strips. */
const LEADING_STATUS_MARKERS = /^[\s⠀-⣿·•⋅◦✳*∗✶✻✽✸✹✺✷✴◐◑◒◓✦◇🤖🔔]+/u;
const LEADING_OC_PREFIXES = /^(?:OC\s*\|\s*)+/iu;
/** Cursor CLI's ` - ✅ Ready` and ` - ⏳ Working ...` suffixes (`normalize_cursor_title`). */
const CURSOR_STATUS_SUFFIX = /\s*-\s*(?:✅ Ready|⏳ Working [.·]+)$/u;
const CODEX_SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCodexSessionIdTitle(title: string): boolean {
  const sanitized = title
    .trim()
    .replace(LEADING_STATUS_MARKERS, '')
    .replace(LEADING_OC_PREFIXES, '')
    .trim()
    .replace(CURSOR_STATUS_SUFFIX, '')
    .trim();
  return CODEX_SESSION_ID.test(sanitized);
}

/** `is_default_session_search_title`: creation defaults, numbers, paths and status words. */
export function isDefaultSessionSearchTitle(title: string): boolean {
  const normalized = collapseWhitespace(title);
  if (normalized.length === 0) return false;
  const lower = normalized.toLowerCase();
  return (
    /^session \d+$/.test(lower) ||
    isCodexSessionIdTitle(normalized) ||
    /^👻(?:\s+Terminal Session)?$/u.test(normalized) ||
    /^[\s.:[\](){}!|\/\\_-]*(?:done|error|idle|thinking|working)[\s.:[\](){}!|\/\\_-]*$/i.test(normalized) ||
    PLACEHOLDER_TITLES.has(lower) ||
    normalized.startsWith('~') ||
    normalized.startsWith('/') ||
    ['…/', '…\\', '.../', '...\\'].some((prefix) => normalized.startsWith(prefix))
  );
}

// ---------------------------------------------------------------------------
// Rows and day groups (visible_items / session_groups).
// ---------------------------------------------------------------------------

/** `card_title`: the first non-empty of the display, primary and terminal titles, else the alias. */
export function sessionSearchTitle(session: GhostexSession): string {
  for (const value of [session.displayTitle, session.primaryTitle, session.terminalTitle, session.title]) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return session.alias;
}

function sessionSearchText(session: GhostexSession, catalog: GhostexCustomSessionTags | undefined): string {
  const tag = effectiveSessionTag(session) === undefined ? undefined : resolveSessionTag(session, catalog);
  return [
    session.alias,
    session.displayTitle,
    session.primaryTitle,
    session.terminalTitle,
    tag?.label,
  ]
    .map((part) => normalizeSessionSearchValue(part))
    .filter((part) => part.length > 0)
    .join(' ');
}

/** One open session a machine reported, as the search reads it. */
export type SessionSearchCandidate = {
  machineId: string;
  session: GhostexSession;
  /** The owning project's title (`Chats` for chat projects), shown beside the title. */
  projectLabel: string;
  customSessionTags: GhostexCustomSessionTags | undefined;
};

export type SessionSearchRow = SessionSearchCandidate & {
  key: string;
  title: string;
  timestamp: number;
};

export type SessionSearchGroup = {
  heading: string;
  rows: SessionSearchRow[];
};

function parseTimestamp(value: string): number {
  if (value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `day_label`: `Tuesday, September 30, 2026` in the phone's time zone. */
function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/** `relative_time(stamp, false, now).0`: `12s`, `5m`, `3h`, `2d`. */
export function sessionSearchRelativeTime(timestamp: number, nowMs: number): string {
  if (timestamp === 0) return '';
  const seconds = Math.floor(Math.max(0, nowMs - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * The sessions a query keeps, newest first and grouped by the day they were
 * last used. Every token of the query must match; an empty query keeps every
 * session whose title is not a creation default.
 */
export function searchSessions(
  candidates: readonly SessionSearchCandidate[],
  query: string,
): SessionSearchGroup[] {
  const tokens = normalizeSessionSearchValue(query)
    .split(/\s+/)
    .filter((token) => token.length > 0);
  const rows: SessionSearchRow[] = [];
  for (const candidate of candidates) {
    const title = sessionSearchTitle(candidate.session);
    if (isDefaultSessionSearchTitle(title)) continue;
    if (tokens.length > 0) {
      const text = sessionSearchText(candidate.session, candidate.customSessionTags);
      if (!tokens.every((token) => matchesToken(text, token))) continue;
    }
    rows.push({
      ...candidate,
      key: `open:${candidate.machineId}:${candidate.session.sessionId}`,
      title,
      timestamp: parseTimestamp(candidate.session.lastInteractionAt),
    });
  }
  rows.sort((left, right) => right.timestamp - left.timestamp || left.key.localeCompare(right.key));
  const groups: SessionSearchGroup[] = [];
  for (const row of rows) {
    const heading = row.timestamp === 0 ? SessionSearchCopy.unknownDay : dayLabel(row.timestamp);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.heading === heading) {
      last.rows.push(row);
    } else {
      groups.push({ heading, rows: [row] });
    }
  }
  return groups;
}
