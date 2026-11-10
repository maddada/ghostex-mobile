/**
 * Which question form box Dictate types into: the form's boxes (a question's note or text answer,
 * the note under "Other / none of these", "Anything else?") say here when they have the caret, and
 * the composer's Dictate asks which one has it when a recording starts (`useDictation`). The chat
 * core places the words (`insertDictation`) and answers with the box's text now
 * (`dictationInserted`), which the box's drawn copies show from here (`showDictated`).
 *
 * CDXC:Dictate 2026-11-11 DECISION:
 * Issue #552, the phone half of the computer's pull request #553: the box that has the caret when
 * the recording starts gets the words at its caret, as the chat box does. The box is chosen at the
 * start and does not change while recording or transcribing; it carries a ring until the words are
 * in. With the caret anywhere else the chat box takes them as before, and so do Transcribe again and
 * Transcribe previous. A chat core that does not name itself in the form (`core`, an older core
 * page) gets no `insertDictation`: the chat box takes the words.
 * SEE-ALSO: packages/gx-chat-core/src/questions/dictation.rs (the placing, the revisions);
 * apps/desktop/src/app/native_chat/dictation.rs (`aim_dictation`, `show_dictated`).
 */

import { useSyncExternalStore } from 'react';

/** A question's index in its form, or the form's own notes box. */
export type FormSlot = number | 'notes';

/** The core's `dictationInserted` for a form box. */
export type DictatedAnswer = {
  form: string;
  slot: FormSlot;
  core: string;
  rev: number;
  /** Texts a copy may show to take `content`: any other means it was typed in since. */
  supersedes: string[];
  content: string;
  /** UTF-16 offset after the words. */
  caret: number;
};

/** One drawn copy of a form box. */
export type DictationBox = {
  form: string;
  slot: FormSlot;
  /** What the box shows now, with its selection (UTF-16 offsets). */
  read(): { text: string; start: number; end: number };
  /** The core's answer for this box. */
  show(answer: DictatedAnswer): void;
};

/** The box a recording started in. */
export type AimedBox = { form: string; slot: FormSlot };

export function formBoxKey(form: string, slot: FormSlot): string {
  return `${form}:${slot}`;
}

const boxes = new Set<DictationBox>();
let focused: DictationBox | null = null;

/** A drawn box: `focus` and `blur` as its field gains and loses the caret, `remove` when it goes. */
export function registerDictationBox(box: DictationBox): { focus(): void; blur(): void; remove(): void } {
  boxes.add(box);
  return {
    focus: () => {
      focused = box;
    },
    blur: () => {
      if (focused === box) focused = null;
    },
    remove: () => {
      boxes.delete(box);
      if (focused === box) focused = null;
    },
  };
}

/** The form box with the caret now, or null (the chat box, or nothing). */
export function focusedDictationBox(): DictationBox | null {
  return focused;
}

/** A drawn copy of `aimed`, the focused one first, to read what it shows. */
export function drawnDictationBox(aimed: AimedBox): DictationBox | null {
  const key = formBoxKey(aimed.form, aimed.slot);
  if (focused !== null && formBoxKey(focused.form, focused.slot) === key) return focused;
  for (const box of boxes) if (formBoxKey(box.form, box.slot) === key) return box;
  return null;
}

/** Hands the core's answer to every drawn copy of its box. */
export function showDictated(answer: DictatedAnswer): void {
  const key = formBoxKey(answer.form, answer.slot);
  for (const box of [...boxes]) if (formBoxKey(box.form, box.slot) === key) box.show(answer);
}

/** The box a recording or transcription is aimed at, which shows a ring meanwhile. */
let aimedKey: string | null = null;
const aimedListeners = new Set<() => void>();

export function setDictationAim(aimed: AimedBox | null): void {
  const next = aimed === null ? null : formBoxKey(aimed.form, aimed.slot);
  if (next === aimedKey) return;
  aimedKey = next;
  for (const listener of [...aimedListeners]) listener();
}

function subscribeAim(listener: () => void): () => void {
  aimedListeners.add(listener);
  return () => {
    aimedListeners.delete(listener);
  };
}

/** True while Dictate is aimed at this box. */
export function useDictationAimed(form: string, slot: FormSlot): boolean {
  const key = formBoxKey(form, slot);
  return useSyncExternalStore(
    subscribeAim,
    () => aimedKey === key,
    () => false,
  );
}
