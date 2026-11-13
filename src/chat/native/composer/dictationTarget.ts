/**
 * Where Dictate types its words besides the chat box: the question form box that has the keyboard
 * when a recording starts (`useDictation.ts` aims and asks the core to type; `transcript/QuestionForm.tsx`'s
 * boxes report themselves). One per chat screen (`NativeChatUi.dictationTargets`), so a chat's
 * microphone only ever types into that chat's own boxes.
 *
 * CDXC:Dictate 2026-11-10 WHY: Dictate typed into the chat box even when the caret was in a question form's note, text answer or "Anything else?" box, so the words had to be cut from the draft and pasted into the box. The box that has the keyboard when the recording starts gets them, at its caret with the chat box's spacing; touching another box meanwhile does not move them, and if its form was sent or answered when they arrive they go to the chat box, so a dictation is never lost. A recording transcribed later (Transcribe again, Transcribe previous, a recording still waiting, a send that goes again on its own) keeps the chat box. This widens "typed into the draft" of the SessionChat 2026-10-08 DECISION in `useDictation.ts`. The target is the box's form and slot, never the view that draws it: a view is reused for another form when the transcript changes above it, and goes away when its row scrolls out of the list, so aimed at the view the words followed it into the other form, or went to the chat box though the form was still open. The core types the words into the box's draft (`insertDictation`), drawn or not, decides whether it still takes them, and keeps them there when a copy that has not shown them yet writes its text; a copy only ever shows what the core says the draft is, and never writes that back.
 * CDXC:Dictate 2026-11-10 SEE-ALSO: the core's rule is `insert` in `packages/gx-chat-core/src/questions/dictation.rs`; the desktop's is `aim_dictation` and `dictation_inserted` in `apps/desktop/src/app/native_chat/dictation.rs`.
 */

/** A question form's text box: a question's (by its index) or the form's own notes box. */
export type DictationBox = { form: string; slot: number | 'notes' };

/**
 * The core's `dictationInserted` host action (`insert` and `keep` in gx-chat-core's
 * questions/dictation.rs): Dictate's words are in a draft, whose text is now `content`.
 */
export type DictationInserted = {
  /** The recording the words came from, as `insertDictation` named it; null when a copy's edit moved the words. */
  id: string | null;
  /** The form box whose draft has the words; null is the chat box. */
  box: DictationBox | null;
  /** The texts a copy of the target may show to take `content` in their place. */
  supersedes: readonly string[];
  /** The target's text now, and the offset after the words in it. */
  content: string;
  caret: number;
  /**
   * What a copy of the form box that shows `content` sends with its edits (`formText`): the core
   * that holds the draft, and how many dictations it typed into the box.
   */
  core: string;
  rev: number;
  /** What was asked with, for a chat box that has to ask again; null when no recording was heard. */
  text: string | null;
  spacing: boolean;
};

export function dictationInserted(params: unknown): DictationInserted | null {
  if (typeof params !== 'object' || params === null) return null;
  const fields = params as Record<string, unknown>;
  const { form, slot, supersedes, content, caret } = fields;
  if (typeof content !== 'string' || typeof caret !== 'number' || !Array.isArray(supersedes)) return null;
  const box: DictationBox | null =
    typeof form === 'string' && (typeof slot === 'number' || slot === 'notes') ? { form, slot } : null;
  return {
    id: typeof fields.id === 'string' ? fields.id : null,
    box,
    supersedes: supersedes.filter((text): text is string => typeof text === 'string'),
    content,
    caret,
    core: typeof fields.core === 'string' ? fields.core : '',
    rev: typeof fields.rev === 'number' ? fields.rev : 0,
    text: typeof fields.text === 'string' ? fields.text : null,
    spacing: fields.spacing !== false,
  };
}

/**
 * One drawn copy of a form box. A box can be drawn twice (the transcript's and the Resources
 * sheet's) or not at all (its row is outside the list's window).
 */
export type DrawnBox = {
  /** Its text and selection now (start equals end at a caret). */
  shown(): Shown;
  /**
   * The core says the box's draft is now `result.content`. A copy showing one of the texts that
   * supersedes takes it, without reporting it as an edit; a copy showing anything else holds an
   * edit the core has not answered yet, whose own answer brings its text.
   */
  show(result: DictationInserted): void;
};

/** A box's text as drawn, and its selection in UTF-16 offsets. */
export type Shown = { text: string; start: number; end: number };

const keyOf = (box: DictationBox): string => `${box.form}:${box.slot}`;

export class DictationTargets {
  private focused: { box: DictationBox; copy: DrawnBox } | null = null;
  private aimed: DictationBox | null = null;
  /** The aimed box as its focused copy showed it when the recording started (`placeIn`). */
  private anchor: Shown | null = null;
  private readonly drawn = new Map<string, Set<DrawnBox>>();
  private readonly listeners = new Set<() => void>();

  /** `copy` draws `box` from now on; the answer takes it away again. */
  draw(box: DictationBox, copy: DrawnBox): () => void {
    const key = keyOf(box);
    const copies = this.drawn.get(key) ?? new Set<DrawnBox>();
    copies.add(copy);
    this.drawn.set(key, copies);
    return () => {
      copies.delete(copy);
      if (copies.size === 0 && this.drawn.get(key) === copies) this.drawn.delete(key);
      // A copy that leaves with the keyboard reports no blur.
      if (this.focused?.copy === copy) this.focused = null;
    };
  }

  /** `copy` of `box` took the keyboard, or lost it. */
  setFocused(box: DictationBox, copy: DrawnBox, focused: boolean): void {
    if (focused) this.focused = { box: { ...box }, copy };
    else if (this.focused?.copy === copy) this.focused = null;
  }

  /** A recording starts: its words go to the box that has the keyboard now, or to the chat box. */
  aimAtFocused(): void {
    this.anchor = this.focused?.copy.shown() ?? null;
    this.aim(this.focused?.box ?? null);
  }

  /** The run is over, or its words come later: the chat box takes what still arrives. */
  release(): void {
    this.anchor = null;
    this.aim(null);
  }

  /** The box the running dictation types into; null is the chat box. */
  target(): DictationBox | null {
    return this.aimed;
  }

  isTarget(box: DictationBox): boolean {
    return this.aimed !== null && keyOf(this.aimed) === keyOf(box);
  }

  /**
   * Where the words go in `box`: the selection the recording started with while the box still
   * shows the text it had then (CDXC:Dictate 2026-11-13 in host.ts), else the box as a drawn copy
   * shows it now; null when none is drawn.
   */
  placeIn(box: DictationBox): Shown | null {
    const now = this.shownBy(box);
    const anchor = this.isTarget(box) ? this.anchor : null;
    return now !== null && anchor !== null && anchor.text === now.text ? anchor : now;
  }

  /** `box` as a drawn copy shows it now (the one with the keyboard first); null when none is drawn. */
  shownBy(box: DictationBox): Shown | null {
    const copies = this.drawn.get(keyOf(box));
    const focused = this.focused?.copy;
    const copy = focused !== undefined && copies?.has(focused) ? focused : copies?.values().next().value;
    return copy?.shown() ?? null;
  }

  /** The core says `result.box`'s draft has Dictate's words: its drawn copies are told. */
  inserted(result: DictationInserted): void {
    if (result.box === null) return;
    this.drawn.get(keyOf(result.box))?.forEach((copy) => copy.show(result));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private aim(box: DictationBox | null): void {
    if (this.aimed === box || (this.aimed !== null && box !== null && keyOf(this.aimed) === keyOf(box))) return;
    this.aimed = box;
    this.listeners.forEach((listener) => listener());
  }
}
