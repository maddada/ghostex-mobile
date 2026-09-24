/**
 * Lenient readers for the document's untyped subtrees, the same reads desktop does with
 * `text(value, key)` and `value["key"] == true`: a missing or mistyped field reads as empty.
 */

export type JsonRecord = { [key: string]: unknown };

export function obj(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `text(value, key)`: the string at `key`, or `''`. */
export function str(value: unknown, key: string): string {
  const field = obj(value)?.[key];
  return typeof field === 'string' ? field : '';
}

export function num(value: unknown, key: string): number | null {
  const field = obj(value)?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

/** `value[key] == true`. */
export function isTrue(value: unknown, key: string): boolean {
  return obj(value)?.[key] === true;
}
