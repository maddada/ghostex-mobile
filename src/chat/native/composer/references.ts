/**
 * The draft's markdown references as the core parses them (`composerReferences`, the rules in
 * `packages/shared/session-chat-presentation/reference-pills.ts`), and the edit rules that keep a
 * pill whole inside a plain `TextInput`, the job gpui-component's `InlineReplacement` does on
 * desktop (`composer_references.rs`).
 */

import { arr, obj } from './json';

export type ComposerReference = {
  /** UTF-16 range of `[label](path)` in the draft. */
  start: number;
  end: number;
  kind: string;
  label: string;
  path: string;
  /** Where the label sits: `[` is at `start`, the label follows, then `](path)` to `end`. */
  labelStart: number;
  labelEnd: number;
};

/** Decodes the core's answer; references that are revealed (shown as source) are skipped. */
export function parseReferences(draft: string, answer: unknown): ComposerReference[] {
  const references: ComposerReference[] = [];
  for (const entry of arr(answer)) {
    const reference = obj(entry);
    if (reference === null || reference.revealed === true) continue;
    const { start, end, kind, label, path } = reference;
    if (typeof start !== 'number' || typeof end !== 'number' || typeof kind !== 'string') continue;
    if (typeof label !== 'string' || typeof path !== 'string' || start >= end || end > draft.length) continue;
    const labelEnd = draft.indexOf('](', start);
    if (draft[start] !== '[' || labelEnd < 0 || labelEnd >= end) continue;
    references.push({ start, end, kind, label, path, labelStart: start + 1, labelEnd });
  }
  return references;
}

/** The single edit that turns `before` into `after`: `[start, removedEnd)` of `before` replaced. */
export function diffEdit(before: string, after: string): { start: number; removedEnd: number; inserted: string } {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < max - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  return { start, removedEnd: before.length - tail, inserted: after.slice(start, after.length - tail) };
}

export type GuardedEdit =
  /** Keep the edit as typed. */
  | { kind: 'accept' }
  /** Typing landed inside a pill: the text moves after it. */
  | { kind: 'rewrite'; text: string; caret: number }
  /** The edit cut into a pill: the whole reference goes (`removeAttachment`). */
  | { kind: 'remove'; reference: ComposerReference };

/**
 * A pill is one glyph to the user: an edit that deletes any part of it removes all of it, and text
 * typed inside it lands after it.
 */
export function guardEdit(before: string, after: string, references: readonly ComposerReference[]): GuardedEdit {
  if (references.length === 0) return { kind: 'accept' };
  const edit = diffEdit(before, after);
  for (const reference of references) {
    const deletesInside = edit.removedEnd > edit.start && edit.start < reference.end && edit.removedEnd > reference.start;
    if (deletesInside) {
      const covers = edit.start <= reference.start && edit.removedEnd >= reference.end;
      if (covers) continue;
      return { kind: 'remove', reference };
    }
    const insertsInside = edit.removedEnd === edit.start && edit.start > reference.start && edit.start < reference.end;
    if (insertsInside) {
      const text = before.slice(0, reference.end) + edit.inserted + before.slice(reference.end);
      return { kind: 'rewrite', text, caret: reference.end + edit.inserted.length };
    }
  }
  return { kind: 'accept' };
}

/** A caret strictly inside a pill snaps to its end, so the next keystroke lands after it. */
export function snapCaret(caret: number, references: readonly ComposerReference[]): number | null {
  for (const reference of references) {
    if (caret > reference.start && caret < reference.end) return reference.end;
  }
  return null;
}
