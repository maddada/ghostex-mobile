/**
 * JSON reading helpers, narrowing at the parse boundary.
 * Part of the mobile summary contract (`./index.ts`).
 */

// ---------------------------------------------------------------------------
// JSON reading helpers (narrowing at the parse boundary).
// ---------------------------------------------------------------------------

export type JsonObject = Record<string, unknown>;

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Treat JSON nulls as missing; stringify scalars like the Android parser does. */
/** A coordinator's `coordinatorRemoteThreads`, each by the `globalRef` its own computer lists it under. */
export function parseRemoteThreads(value: unknown): Array<{ globalRef: string; threadState: string }> {
  if (!Array.isArray(value)) return [];
  const threads: Array<{ globalRef: string; threadState: string }> = [];
  for (const entry of value) {
    if (!isObject(entry)) continue;
    const serverId = trimmedValue(entry, 'serverId');
    const projectId = trimmedValue(entry, 'projectId');
    const sessionId = trimmedValue(entry, 'sessionId');
    if (serverId === '' || projectId === '' || sessionId === '') continue;
    threads.push({ globalRef: `${serverId}:${projectId}:${sessionId}`, threadState: trimmedValue(entry, 'threadState') });
  }
  return threads;
}

export function trimmedValue(json: JsonObject, key: string): string {
  const value = json[key];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return '';
  return String(value).trim();
}

export function boolValue(json: JsonObject, key: string, fallback: boolean): boolean {
  const value = json[key];
  return typeof value === 'boolean' ? value : fallback;
}

export function firstNonEmpty(...values: string[]): string {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}
