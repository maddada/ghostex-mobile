/**
 * The composer text the phone owns, and the composer requests the core addresses to it.
 *
 * On desktop the text field lives in the view (`apps/desktop/src/app/native_chat/state.rs`:
 * `draft`, `draft_id`, `draft_revision`, `composer_ready`, `pending_send`) and the view performs
 * the composer requests the core's effects become (`composerInit`, `composer`,
 * `composerClearExpected`, `draftSubmitted`, `submissionFailed`, `draftReceived`,
 * `returnedPrompt`, `attachmentReferences`, and the `readNativeComposer` read). The phone host
 * keeps that model here, so the native screen only binds a `TextInput` to `text` and reports
 * edits, focus, blur and Send, and every rule about what those mean stays where desktop keeps it.
 *
 * Offsets (`caret`, `selection`) are UTF-16, which is what a JavaScript string index already is.
 */

import type { ChatDocument } from './document';
import { nextDraftVersion, randomUuid } from './host-records';
import type { UserAction } from './actions';
import { releaseAnswerHold } from '../native/transcript/answerHold';

/** What a submission does; `interrupt` is Interrupt & Send. */
export type SubmitMode = 'send' | 'queue' | 'compact' | 'handoff' | 'interrupt';

export type ComposerModelState = {
  /** The field's text. */
  text: string;
  /** Where the caret should go after a host replacement, or null to leave it. */
  caret: number | null;
  /** The selection the screen last reported. */
  selection: { start: number; end: number };
  /** Bumped whenever the HOST replaced `text`, so the screen knows to push it into its input. */
  replaceSequence: number;
  /** The replacement came from history recall (desktop makes it undoable differently). */
  fromHistory: boolean;
  clientId: string;
  draftId: string;
  /** The draft revision, bumped per edit; the wire claims `max(1, revision)`. */
  revision: number;
  /** The boot read answered; edits and saves go to the core only from here on. */
  ready: boolean;
  /** A send left the composer and has not settled. Send does not wait for it: the core holds later sends behind it. */
  pendingSend: boolean;
  /**
   * A send pressed while an upload's pills were on their way into the field (uploaded, not written
   * yet): its mode, sent the moment they are in. An upload still uploading does not hold a send:
   * the send takes it along (core `composer/attaching.rs`). Desktop: `composer_attach.rs`.
   */
  heldSend: SubmitMode | null;
};

export type ComposerHooks = {
  dispatch(action: UserAction): void;
  document(): ChatDocument | null;
  onChange(): void;
  /** Send was pressed while `sendBlockedReason` holds: show the core's `sendBlockedToast`. */
  onSendBlocked(reason: string): void;
  onFocusRequested(): void;
};

export class ComposerModel {
  state: ComposerModelState = {
    text: '',
    caret: null,
    selection: { start: 0, end: 0 },
    replaceSequence: 0,
    fromHistory: false,
    clientId: '',
    draftId: randomUuid(),
    revision: 0,
    ready: false,
    pendingSend: false,
    heldSend: null,
  };

  /**
   * Uploads still on their way into the field: being uploaded, or uploaded with their pills not in
   * the text yet. Counted here, not from the document, which answers a turn later.
   */
  private readonly uploads: { next: number; saving: number[]; claimed: number[]; inserting: number } = {
    next: 0,
    saving: [],
    claimed: [],
    inserting: 0,
  };

  private selectionSent: { text: string; caret: number } | null = null;

  /** The field has the keyboard (`focused`, `blurred`). */
  private hasKeyboard = false;

  constructor(private readonly hooks: ComposerHooks) {}

  private set(next: Partial<ComposerModelState>): void {
    this.state = { ...this.state, ...next };
    this.hooks.onChange();
  }

  private version(): { draftId: string; revision: number } {
    return { draftId: this.state.draftId, revision: Math.max(1, this.state.revision) };
  }

  // ---- the screen's input --------------------------------------------------------------------

  /** The user typed (desktop's `InputEvent::Change`). */
  edited(text: string, selection?: { start: number; end: number }): void {
    if (text === this.state.text) {
      if (selection) this.selected(selection);
      return;
    }
    this.hooks.dispatch({ type: 'composerExpand', editor: true });
    this.set({
      text,
      revision: this.state.revision + 1,
      caret: null,
      ...(selection ? { selection } : {}),
    });
    this.persist();
    if (selection) this.selected(selection);
  }

  /**
   * The caret or selection moved (the screen reports it after every edit too). The core reads it
   * for the `@` / `$` / `/` popup; like `suggestions/window.rs`, an unchanged (text, caret) pair is
   * not sent again.
   */
  selected(selection: { start: number; end: number }): void {
    this.state = { ...this.state, selection };
    const sent = this.selectionSent;
    if (sent !== null && sent.text === this.state.text && sent.caret === selection.end) return;
    this.selectionSent = { text: this.state.text, caret: selection.end };
    this.hooks.dispatch({ type: 'composerSelection', text: this.state.text, caret: selection.end });
  }

  focused(): void {
    this.hasKeyboard = true;
    this.hooks.dispatch({ type: 'composerExpand', editor: true });
  }

  /** Blur pushes the draft to gxserver, as desktop's `InputEvent::Blur` does. */
  blurred(): void {
    this.hasKeyboard = false;
    this.save();
  }

  /**
   * Where Dictate's words go in the field as it is now: over the selection (at the caret when
   * nothing is selected), or after the text when the field has no keyboard (it has no caret the
   * reader chose then).
   */
  dictationPoint(): { text: string; start: number; end: number } {
    const { text, selection } = this.state;
    if (!this.hasKeyboard) return { text, start: text.length, end: text.length };
    const start = Math.min(selection.start, selection.end, text.length);
    return { text, start, end: Math.min(Math.max(selection.start, selection.end), text.length) };
  }

  /**
   * Send, Queue, Compact, Handoff, or Interrupt & Send (a send that stops the agent's running turn
   * first), with desktop's gates (`native_chat/composer.rs`, `submit`).
   * Returns whether the text left the composer.
   */
  submit(requested: SubmitMode): boolean {
    const interrupt = requested === 'interrupt';
    const mode = interrupt ? 'send' : requested;
    const document = this.hooks.document();
    if (!this.state.ready) return false;
    // An upload's pills on their way into the field: the message waits the moment it takes them.
    if (this.uploads.inserting > 0) {
      this.set({ heldSend: requested });
      return false;
    }
    // CDXC:Clipboard 2026-11-09 DECISION: a picture still uploading goes with the message, which
    // leaves now and waits for it in the transcript (core `composer/attaching.rs`, where the
    // user's words are). Even a message of pictures alone.
    const uploading = this.uploads.saving.length > 0;
    if (this.state.text.trim().length === 0 && !uploading) return false;
    if (mode !== 'send' && mode !== 'handoff' && document?.queue.capabilities.canQueue !== true) return false;
    const blocked = document?.sendBlockedReason ?? null;
    if (blocked !== null) {
      this.hooks.onSendBlocked(blocked);
      return false;
    }
    if (mode === 'send' && typeof document?.composerCommand === 'string') {
      this.hooks.dispatch({ type: 'completeComposerCommand' });
      return false;
    }
    const submission = {
      type: mode,
      text: this.state.text,
      draftVersion: this.version(),
      ...(interrupt ? { interrupt } : {}),
      ...(uploading ? { caret: utf16Caret(this.state.text, this.state.selection.end) } : {}),
    } as UserAction;
    if (uploading) this.uploads.claimed.push(...this.uploads.saving.splice(0));
    this.set({
      pendingSend: true,
      text: '',
      draftId: randomUuid(),
      revision: 1,
      caret: 0,
      replaceSequence: this.state.replaceSequence + 1,
      fromHistory: false,
    });
    // A send from the chat box follows the newest row again (`answerHold.ts`).
    releaseAnswerHold();
    this.hooks.dispatch(submission);
    return true;
  }

  // ---- the core's composer requests ----------------------------------------------------------

  /** `composerInit`: the boot read's client id, draft identity and stored text. */
  init(read: { clientId?: unknown; entry?: unknown }, sessionId: string): void {
    const entry = (read.entry ?? {}) as { text?: unknown; parked?: unknown; submitted?: unknown; version?: unknown };
    const version = (entry.version ?? {}) as { draftId?: unknown; revision?: unknown };
    // A core that restarted (its page crashed or reloaded) finds the field already ready: what it
    // shows is the draft, however far the last save got, and adding it to the restored copy doubled
    // it. Only text typed before the first boot read answered goes after the restored draft.
    const restarted = this.state.ready;
    const typedBeforeReady = !restarted && this.state.revision > 0 ? this.state.text : null;
    const restored =
      entry.parked === true || entry.submitted === true ? '' : typeof entry.text === 'string' ? entry.text : '';
    const text = restarted ? this.state.text : typedBeforeReady === null ? restored : `${restored}${typedBeforeReady}`;
    this.set({
      clientId: typeof read.clientId === 'string' ? read.clientId : '',
      draftId: typeof version.draftId === 'string' ? version.draftId : nextDraftVersion().draftId,
      revision: typeof version.revision === 'number' ? version.revision : 1,
      ready: true,
      text,
      caret: null,
      replaceSequence: text === this.state.text ? this.state.replaceSequence : this.state.replaceSequence + 1,
    });
    // The new core gets what the field shows when it is not what the store held.
    if (typedBeforeReady !== null || (restarted && text !== restored)) {
      this.set({ revision: this.state.revision + 1 });
      this.persist();
      this.save();
    }
    // The stash badge and the session-note dot need their first read (`native-composer-chrome.ts`).
    this.hooks.dispatch({ type: 'refreshComposerChrome', sessionId });
  }

  /** An upload into the field began (`RustChatHost.attachFiles`); answers the id the core knows it by. */
  uploadStarted(): number {
    this.uploads.next += 1;
    this.uploads.saving.push(this.uploads.next);
    return this.uploads.next;
  }

  /**
   * Upload `id` ended; with `references` its pills are on their way (`attachmentReferences`),
   * unless a send took it, whose message they go to instead.
   */
  uploadFinished(id: number, references: boolean): void {
    const claimed = this.uploads.claimed.indexOf(id);
    if (claimed >= 0) {
      this.uploads.claimed.splice(claimed, 1);
      return;
    }
    const at = this.uploads.saving.indexOf(id);
    if (at >= 0) this.uploads.saving.splice(at, 1);
    if (references) this.uploads.inserting += 1;
  }

  /** The held send goes once the pills it waited for are in. */
  private releaseHeldSend(): void {
    const held = this.state.heldSend;
    if (held === null || this.uploads.inserting > 0) return;
    this.set({ heldSend: null });
    this.submit(held);
  }

  /** `setComposerText` (desktop's `replace_draft`). */
  replace(content: string, caret: number | null, fromHistory: boolean, preserveError = false): void {
    this.set({
      text: content,
      revision: this.state.revision + 1,
      caret: caret ?? content.length,
      fromHistory,
      replaceSequence: this.state.replaceSequence + 1,
    });
    this.hooks.onFocusRequested();
    if (this.state.ready) {
      this.hooks.dispatch({
        type: 'editDraft',
        text: this.state.text,
        draftVersion: this.version(),
        history: fromHistory,
        preserveError,
      });
    }
    // Desktop reports every (text, caret) the field shows (`suggestions/window.rs`); a programmatic
    // value change fires no selection event on iOS, so a picked `@` file kept its popup open.
    const at = this.state.caret ?? content.length;
    this.selected({ start: at, end: at });
    this.save(preserveError);
    // The core wrote an upload's pills into the field.
    if (this.uploads.inserting > 0) {
      this.uploads.inserting -= 1;
      this.releaseHeldSend();
    }
  }

  /** `composerClearExpected`: clear only if the field still holds exactly this text. */
  clearIfUnchanged(text: string): void {
    if (this.state.text === text) this.replace('', null, false);
  }

  /** `returnedPrompt`: the core decides how the returned text merges with what is typed now. */
  returnedPrompt(text: string): void {
    this.hooks.dispatch({ type: 'applyReturned', text, current: this.state.text });
  }

  /** `draftSubmitted`: the send settled; a handoff that took this exact revision clears the field. */
  submitted(method: string, params: Record<string, unknown>): void {
    this.set({ pendingSend: false });
    if (method !== 'handoff') return;
    const version = (params.version ?? {}) as { draftId?: unknown; revision?: unknown };
    if (version.draftId !== this.state.draftId || version.revision !== this.state.revision) return;
    const next = (params.nextVersion ?? {}) as { draftId?: unknown };
    this.set({
      text: '',
      draftId: typeof next.draftId === 'string' ? next.draftId : randomUuid(),
      revision: 1,
      caret: 0,
      replaceSequence: this.state.replaceSequence + 1,
    });
    this.hooks.onFocusRequested();
  }

  /** `submissionFailed`: the core merges the failed text back with what was typed since. */
  failed(text: string): void {
    this.set({ pendingSend: false });
    this.hooks.dispatch({ type: 'restoreSubmission', text, current: this.state.text });
  }

  /** `draftReceived`: a draft from another client replaces the field if it is still untouched. */
  received(params: Record<string, unknown>): void {
    if (params.previous !== this.state.text) return;
    const version = (params.version ?? {}) as { draftId?: unknown; revision?: unknown };
    this.set({
      text: typeof params.content === 'string' ? params.content : '',
      draftId: typeof version.draftId === 'string' ? version.draftId : this.state.draftId,
      revision: typeof version.revision === 'number' ? version.revision : 1,
      caret: null,
      replaceSequence: this.state.replaceSequence + 1,
    });
    this.hooks.onFocusRequested();
  }

  /** `attachmentReferences`: insert pills for machine paths at the current selection. */
  insertAttachments(paths: unknown): void {
    this.hooks.dispatch({
      type: 'insertAttachments',
      paths: Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string') : [],
      text: this.state.text,
      start: this.state.selection.start,
      end: this.state.selection.end,
    });
  }

  // ---- saves ---------------------------------------------------------------------------------

  private persist(): void {
    if (!this.state.ready) return;
    this.hooks.dispatch({ type: 'editDraft', text: this.state.text, draftVersion: this.version() });
  }

  private save(preserveError = false): void {
    if (!this.state.ready) return;
    this.hooks.dispatch({
      type: 'saveDraft',
      content: this.state.text,
      draftVersion: { draftId: this.state.draftId, revision: this.state.revision },
      ...(preserveError ? { preserveError: true } : {}),
    });
  }
}

/** `selection` (a JavaScript string index, UTF-16 already) clamped to `text`. */
function utf16Caret(text: string, selection: number): number {
  return Math.max(0, Math.min(selection, text.length));
}
