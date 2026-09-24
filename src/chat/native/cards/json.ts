/**
 * Readers for the document's untyped subtrees, the same lenient reads desktop does with
 * `text(value, key)` and `value["key"] == true`: a missing or mistyped field reads as empty.
 */

import type { Json } from '../../rust/document';

export type JsonRecord = { [key: string]: unknown };

/** The value as an object, or null. */
export function obj(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/** The value as an array, or `[]`. */
export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** `text(value, key)`: the string at `key`, or `''`. */
export function str(value: unknown, key: string): string {
  const field = obj(value)?.[key];
  return typeof field === 'string' ? field : '';
}

/** The number at `key`, or null. */
export function num(value: unknown, key: string): number | null {
  const field = obj(value)?.[key];
  return typeof field === 'number' && Number.isFinite(field) ? field : null;
}

/** `value[key] == true`. */
export function isTrue(value: unknown, key: string): boolean {
  return obj(value)?.[key] === true;
}

/** Narrows an unknown to the document's JSON type for an action payload. */
export function asJson(value: unknown): Json {
  return (value === undefined ? null : value) as Json;
}
