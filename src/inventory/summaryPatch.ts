/**
 * Folds the frames of a computer's pushed sessions list (`/api/events?stream=sessionsList`) into the
 * whole mobile summary, the object `ghostex sessions --json --mobile-summary` prints. Kept free of
 * React Native, so the rule runs under `bun`.
 *
 * Frames: `sessionsListSummary {seq, summary}` is the whole list; `sessionsListPatch {seq, set?, unset?,
 * upsert?, remove?, order?}` is what changed since `seq - 1` (sessions keyed by `[projectId,
 * sessionId]`, an added row appended unless `order` gives every row's place); `sessionsListAlive {seq}`
 * says nothing changed. A patch or alive frame that does not follow the list held answers `resync`:
 * the caller opens the stream again and gets the whole list.
 * SEE-ALSO: server/src/server/sessions_list_stream.rs (`list_patch`, the side that writes them).
 */

export type ListState = { seq: number; summary: Record<string, unknown> };

export type FoldResult =
  | { kind: 'changed'; state: ListState }
  | { kind: 'same'; state: ListState }
  | { kind: 'resync' }
  | { kind: 'ignored' };

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rowKey(row: unknown): string | null {
  if (!isRecord(row)) return null;
  const { projectId, sessionId } = row;
  return typeof projectId === 'string' && typeof sessionId === 'string' ? `${projectId}\u001f${sessionId}` : null;
}

function pairKey(pair: unknown): string | null {
  if (!Array.isArray(pair) || pair.length !== 2) return null;
  const [projectId, sessionId] = pair as unknown[];
  return typeof projectId === 'string' && typeof sessionId === 'string' ? `${projectId}\u001f${sessionId}` : null;
}

function applyPatch(summary: Record<string, unknown>, frame: Record<string, unknown>): Record<string, unknown> | null {
  const next: Record<string, unknown> = { ...summary };
  if (frame.set !== undefined) {
    if (!isRecord(frame.set)) return null;
    for (const [key, value] of Object.entries(frame.set)) next[key] = value;
  }
  if (frame.unset !== undefined) {
    if (!Array.isArray(frame.unset)) return null;
    for (const key of frame.unset) if (typeof key === 'string') delete next[key];
  }
  const touchesRows = frame.upsert !== undefined || frame.remove !== undefined || frame.order !== undefined;
  if (!touchesRows) return next;
  const rows = Array.isArray(summary.sessions) ? (summary.sessions as Row[]) : [];
  const byKey = new Map<string, Row>();
  const keys: string[] = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (key === null) return null;
    byKey.set(key, row);
    keys.push(key);
  }
  if (frame.remove !== undefined) {
    if (!Array.isArray(frame.remove)) return null;
    for (const pair of frame.remove) {
      const key = pairKey(pair);
      if (key === null) return null;
      byKey.delete(key);
    }
  }
  if (frame.upsert !== undefined) {
    if (!Array.isArray(frame.upsert)) return null;
    for (const row of frame.upsert) {
      const key = rowKey(row);
      if (key === null) return null;
      if (!byKey.has(key)) keys.push(key);
      byKey.set(key, row as Row);
    }
  }
  let order = keys.filter((key, index) => byKey.has(key) && keys.indexOf(key) === index);
  if (frame.order !== undefined) {
    if (!Array.isArray(frame.order)) return null;
    const given: string[] = [];
    for (const pair of frame.order) {
      const key = pairKey(pair);
      if (key === null || !byKey.has(key)) return null;
      given.push(key);
    }
    if (given.length !== byKey.size) return null;
    order = given;
  }
  next.sessions = order.map((key) => byKey.get(key) as Row);
  return next;
}

/** Folds one frame into `state` (null before the first whole list). */
export function foldListFrame(state: ListState | null, frame: unknown): FoldResult {
  if (!isRecord(frame) || typeof frame.seq !== 'number') return { kind: 'ignored' };
  const { seq } = frame;
  if (frame.type === 'sessionsListSummary') {
    if (!isRecord(frame.summary) || !Array.isArray(frame.summary.sessions)) return { kind: 'resync' };
    return { kind: 'changed', state: { seq, summary: frame.summary } };
  }
  if (frame.type === 'sessionsListAlive') {
    if (state === null || seq !== state.seq) return { kind: 'resync' };
    return { kind: 'same', state };
  }
  if (frame.type === 'sessionsListPatch') {
    if (state === null || seq !== state.seq + 1) return { kind: 'resync' };
    const summary = applyPatch(state.summary, frame);
    if (summary === null) return { kind: 'resync' };
    return { kind: 'changed', state: { seq, summary } };
  }
  return { kind: 'ignored' };
}
