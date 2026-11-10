/**
 * Where Dictate types its words besides the chat box: the question form box that has the keyboard
 * when a recording starts (`useDictation.ts` aims and types; `transcript/QuestionForm.tsx`'s boxes
 * report themselves). One per chat screen (`NativeChatUi.dictationTargets`), so a chat's microphone
 * only ever types into that chat's own boxes.
 *
 * CDXC:Dictate 2026-11-10 WHY: Dictate typed into the chat box even when the caret was in a question form's note, text answer or "Anything else?" box, so the words had to be cut from the draft and pasted into the box. The box that has the keyboard when the recording starts gets them, at its caret with the chat box's spacing; touching another box meanwhile does not move them, and if the box is gone when they arrive (its form was sent or answered, its row left the list) they go to the chat box, so a dictation is never lost. A recording transcribed later (Transcribe again, Transcribe previous, a recording still waiting, a send that goes again on its own) keeps the chat box. This widens "typed into the draft" of the SessionChat 2026-10-08 DECISION in `useDictation.ts`.
 * CDXC:Dictate 2026-11-10 SEE-ALSO: the desktop's rule is `aim_dictation` in `apps/desktop/src/app/native_chat/dictation.rs`.
 */

/** A text box Dictate can type into: its text and caret as the words arrive, and the write. */
export type DictationField = {
  draft(): { text: string; caret: number };
  replace(text: string): void;
};

export class DictationTargets {
  private focused: DictationField | null = null;
  private aimed: DictationField | null = null;
  private readonly listeners = new Set<() => void>();

  /** `field` took the keyboard, or lost it. */
  setFocused(field: DictationField, focused: boolean): void {
    if (focused) this.focused = field;
    else if (this.focused === field) this.focused = null;
  }

  /** `field` no longer takes text: its form was sent or answered, or its row left the list. */
  remove(field: DictationField): void {
    if (this.focused === field) this.focused = null;
    if (this.aimed === field) this.aim(null);
  }

  /** A recording starts: its words go to the box that has the keyboard now, or to the chat box. */
  aimAtFocused(): void {
    this.aim(this.focused);
  }

  /** The run is over, or its words come later: the chat box takes what still arrives. */
  release(): void {
    this.aim(null);
  }

  /** The box the running dictation types into; null is the chat box. */
  target(): DictationField | null {
    return this.aimed;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private aim(field: DictationField | null): void {
    if (this.aimed === field) return;
    this.aimed = field;
    this.listeners.forEach((listener) => listener());
  }
}
