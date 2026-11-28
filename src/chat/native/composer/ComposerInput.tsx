/**
 * The composer's text field: a multiline `TextInput` that grows to a cap, bound to the host's
 * composer model (`src/chat/rust/composer.ts`), which mirrors desktop's text-field handling.
 *
 * Reference pills (`[label](path)` in the draft, parsed by the core's `composerReferences`) show
 * in the field as one short chip each, in their kind's ink after their kind's icon as desktop
 * draws them, and the draft's markdown stays beside the field (`chipText.ts`): the caret steps
 * over a chip as one unit, Backspace after it deletes the whole reference, and every edit is made
 * to the draft, which is what the core keeps and Send sends. A picture still uploading is the same
 * chip in the muted ink, and one whose upload failed is in the error ink (`uploadTokens.ts`).
 *
 * CDXC:SessionChat 2026-11-15 FIX:
 * User (Android, a draft with an "Image #1" chip on its own line between two lines of text): "When I type in this
 * case the image pill flashes over and over and moves up and down pls fix." The field drew its chips as styled
 * children, rebuilt from the new text on every keystroke. React Native hands every change to a text field's
 * children to the native field as a new text: Android's `ReactEditText.maybeSetText` then strips every style span
 * and replaces the whole text, even when it is exactly what the field already shows (iOS's `_setAttributedString`
 * skips an identical one), and the field is measured from that pushed text instead of its own until the next
 * keystroke (`AndroidTextInputShadowNode::updateStateIfNeeded` clears `cachedAttributedStringId`). So each letter
 * re-laid the chip and the box around it. Typing never needs that push: the native field already holds the letter,
 * and spans move with the text the way `editShown` moves the chips. The children are now rebuilt only when the field
 * must change: the host replaced the text, a chip came, went or changed its look, an edit cut into a chip, or the
 * theme changed (`fieldSource` below).
 */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Text,
  TextInput,
  View,
  type TextInputInstance,
  type TextInputSelectionChangeEvent,
} from 'react-native';

import GhostexImageIntakeView from '../../../../modules/ghostex-native/src/GhostexImageIntakeView';
import type { ComposerModelState } from '../../rust/composer';
import { uploadTokenOfPath, type UploadTokenState } from '../../rust/uploadTokens';
import type { RustChat } from '../../rust/useRustChat';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CHIP_ICON_FAMILY, CHIP_IMAGE_ICON, useChipIconFont } from './chipIconFont';
import {
  draftOffset,
  editShown,
  projectDraft,
  shownOffset,
  snapSelection,
  type Chip,
  type ChipIcons,
  type ChipText,
  type Selection,
  type SnappedSelection,
} from './chipText';
import type { ComposerReference } from './references';

export type ComposerInputHandle = {
  focus(): void;
  blur(): void;
  /** Types a character at the caret (replacing a selection), as the keyboard would: the picker its key opens follows. */
  insertAtCaret(character: string): void;
};

/**
 * The collapsed field: exactly one line (`lineHeight` plus the vertical padding in `input`). The
 * field was 24 tall, a point short of its own line, and Android squeezed both placeholder lines into
 * it; collapsed, it shows only the placeholder's first line.
 */
export const COLLAPSED_INPUT_HEIGHT = 21 + 2 + 2;

/**
 * How long the field's own selection reports are ignored after the phone moved its caret (a chip
 * deleted or stepped over), so one the field sent before it saw the move cannot undo it.
 */
const FORCED_SELECTION_SETTLE_MS = 250;

/**
 * How long a caret the host placed (a pasted, dropped, keyboard or picked image's chip, a restored draft) is held
 * against the field's own reports and set on it again: the field can still be taking the focus, a sheet's modal
 * sliding away, or the new styled text, and each of those puts its caret somewhere of its own (the start, the end,
 * where it was before the chip).
 *
 * CDXC:SessionChat 2026-11-19 DECISION: User (phone chat): "on mobile app when i paste an image we should put the caret
 * right after that image. We put it very weird place now." The caret goes right after the image's chip, with the
 * keyboard up, and stays there until the user moves it or types.
 */
const HOST_CARET_HOLD_MS = 400;
/** When, after the host placed a caret, it is set on the field again (ms). */
const HOST_CARET_REASSERT_MS = [0, 60, 160, 320] as const;

/**
 * The field takes dragged text only (React Native's Android drag filter, which `TextInput.js` passes
 * on but its typings leave out), so an image held over it stays the chat view's drop.
 */
const TEXT_DROPS: Record<string, unknown> = { experimental_acceptDragAndDropTypes: ['text/*'] };

/** How soon after the field was given new text an edit may mean it never took it (it was typing ahead). */
const PUSH_SETTLE_MS = 600;

const NO_ICONS: ChipIcons = {};
const ICONS: ChipIcons = { image: CHIP_IMAGE_ICON };

/** Where a chip's upload stands, or null for a landed reference; a stand-in this phone no longer runs reads as failed. */
function chipUpload(chip: Chip, uploads: ComposerModelState['uploadTokens']): UploadTokenState | null {
  const token = uploadTokenOfPath(chip.reference.path);
  if (token === null) return null;
  return uploads[token] ?? 'failed';
}

/** What the chips look like, as one string: the field gets new children when it changes. */
function chipsLook(text: ChipText, uploads: ComposerModelState['uploadTokens']): string {
  return text.chips
    .map((chip) => `${chip.reference.kind}\u0000${text.shown.slice(chip.start, chip.end)}\u0000${chipUpload(chip, uploads) ?? ''}`)
    .join('\u0001');
}

export const ComposerInput = forwardRef<
  ComposerInputHandle,
  {
    model: ComposerModelState;
    input: NonNullable<RustChat['composer']>;
    references: readonly ComposerReference[];
    /** The text the references were parsed from; they are dropped while it differs from `text`. */
    parsedFor: string;
    /** Parses a draft's references now, for an edit that lands before `references` caught up. */
    parse: (text: string) => readonly ComposerReference[];
    placeholder: string;
    collapsed: boolean;
    maxHeight: number;
    /** The expanded box (More actions' Expand): the field stands this tall even when the draft is short. */
    minHeight?: number;
    onTextChange: (text: string) => void;
    onCaret: (caret: number) => void;
    /** Images the keyboard inserted or Paste put in (`GhostexImageIntakeView`, Android). */
    onImages: (event: { nativeEvent: unknown }) => void;
  }
>(function ComposerInput(
  {
    model,
    input,
    references,
    parsedFor,
    parse,
    placeholder,
    collapsed,
    maxHeight,
    minHeight,
    onTextChange,
    onCaret,
    onImages,
  },
  ref,
) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const field = useRef<TextInputInstance>(null);
  /** The draft (markdown); the field shows it with chips. */
  const [draft, setDraft] = useState(model.text);
  const [forced, setForced] = useState<Selection | undefined>(undefined);
  const seenSequence = useRef(model.replaceSequence);
  /** The caret in the draft, which a re-parse that changes the shown text keeps. */
  const draftSelection = useRef<Selection>({ start: model.text.length, end: model.text.length });
  /** The field's last selection, in shown offsets: where an arrow key stepped from. */
  const shownSelection = useRef<Selection | null>(null);
  /** What the field holds now: its own last edit, or what this component last showed. */
  const fieldText = useRef<string | null>(null);
  /** The host asked for a caret (a send, a pick, a restore): place it once the text is shown. */
  const caretRequested = useRef(false);
  /** The caret the host placed, until the user moves it or types, or its hold runs out. */
  const hostCaret = useRef<{ offset: number; until: number } | null>(null);
  const hostCaretTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** A caret the phone moved, until the field reports it. */
  const awaited = useRef<{ selection: Selection; until: number } | null>(null);
  /** The styled children the field was last given, and what they were built for. */
  const fieldSource = useRef<{
    look: string;
    theme: ReturnType<typeof useTranscriptTheme>;
    styles: ReturnType<typeof useStyles>;
    children: React.ReactNode[];
  } | null>(null);
  /** The field must get its text again at the next render: an edit cut into a chip, or one may have missed a push. */
  const pushNext = useRef(false);
  /** Until when an edit may mean the field missed the text it was last given. */
  const settle = useRef<number | null>(null);

  useImperativeHandle(ref, () => ({
    focus: () => field.current?.focus(),
    blur: () => field.current?.blur(),
    insertAtCaret: (character) => {
      const current = textRef.current.draft;
      const { start, end } = draftSelection.current;
      const next = current.slice(0, start) + character + current.slice(end);
      const caret = { start: start + character.length, end: start + character.length };
      draftSelection.current = caret;
      caretRequested.current = true;
      setDraft(next);
      onTextChange(next);
      input.edited(next, caret);
      onCaret(caret.end);
      field.current?.focus();
    },
  }));

  /*
   * CDXC:SessionChat 2026-11-12 WHY:
   * User (Android): tap the chat box, close the keyboard with the back gesture or its hide key, tap the box again:
   * no keyboard. Android keeps the field focused when the keyboard closes that way. A tap right on the field's
   * text line brings the keyboard back, but a tap anywhere else in the box goes through the box's `focus()`, which
   * does nothing for a field React Native already holds as focused (`TextInputState.focusTextInput`), and the field
   * is a single line while the box is empty. The field lets go of its focus when the keyboard closes, so the next
   * tap focuses it afresh and opens the keyboard, as on the iPhone (whose field blurs when its keyboard goes).
   */
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (field.current?.isFocused() === true) field.current.blur();
    });
    return () => subscription.remove();
  }, []);

  const live = parsedFor === draft ? references : parse(draft);
  const icons = useChipIconFont() ? ICONS : NO_ICONS;
  const text = useMemo(() => projectDraft(draft, live, icons), [draft, live, icons]);
  /** The text the field showed last; an edit is diffed against it before the next render. */
  const textRef = useRef<ChipText>(text);

  const clearHostCaretTimers = (): void => {
    for (const timer of hostCaretTimers.current) clearTimeout(timer);
    hostCaretTimers.current = [];
  };
  /** Sets the host's caret on the field itself, whatever the `selection` prop was last given. */
  const holdHostCaret = (offset: number): void => {
    clearHostCaretTimers();
    hostCaret.current = { offset, until: Date.now() + HOST_CARET_HOLD_MS };
    hostCaretTimers.current = HOST_CARET_REASSERT_MS.map((delay) =>
      setTimeout(() => {
        const held = hostCaret.current;
        if (held === null || held.offset !== offset) return;
        if (Date.now() >= held.until) hostCaret.current = null;
        field.current?.setSelection(offset, offset);
      }, delay),
    );
  };
  useEffect(() => clearHostCaretTimers, []);

  const force = ({ start, end, backward }: SnappedSelection): void => {
    awaited.current = { selection: { start, end }, until: Date.now() + FORCED_SELECTION_SETTLE_MS };
    shownSelection.current = { start, end };
    // Android keeps a selection's first offset as its anchor, so a selection Shift+Left grew is
    // set end first and the next Shift+Left moves its start on. iOS takes only start <= end.
    setForced(backward === true && Platform.OS === 'android' ? { start: end, end: start } : { start, end });
  };

  // The host replaced the text (a send, a pick, a restore): show it.
  useEffect(() => {
    if (model.replaceSequence === seenSequence.current) return;
    seenSequence.current = model.replaceSequence;
    setDraft(model.text);
    onTextChange(model.text);
    if (model.caret !== null) {
      draftSelection.current = { start: model.caret, end: model.caret };
      caretRequested.current = true;
    }
  }, [model.replaceSequence, model.text, model.caret, onTextChange]);

  /*
   * The caret this field placed by itself is the model's too (`input.selected`).
   *
   * CDXC:Dictate 2026-11-28 FIX:
   * User (phone): "When I clicked the stop button to stop my recording, it added my recording at the start of the text
   * of the chat box even though my caret was at the end after an image." Dictate's words, and a pasted or picked
   * picture, go where the host's model says the caret is (`dictationPoint`, `placeUploads` in chat/rust/composer.ts),
   * and the model only heard where it is from the field's selection reports. iOS sends none for a caret the phone
   * sets itself (`setSelection`, the `selection` prop) and none for a tap that leaves the caret where it already was.
   * A restored draft ("Look at this [Image #1]") is drawn with the caret at its end, so a tap after the picture moved
   * nothing, the model kept the 0 it started with, and the words went before the picture. The field now tells the
   * model where its caret is when it is first drawn and whenever it is given new text, so the two never differ.
   */
  const caretPlaced = (shown: ChipText, caret: number): void => {
    const inDraft = draftOffset(shown, caret);
    draftSelection.current = { start: inDraft, end: inDraft };
    input.selected(draftSelection.current);
    onCaret(inDraft);
  };

  // The shown text changed without the field typing it (the host replaced the draft, or the core's
  // parse turned markdown into a chip): the field gets the new text, and the caret goes where it was
  // in the draft.
  useLayoutEffect(() => {
    textRef.current = text;
    const first = fieldText.current === null;
    const pushed = fieldText.current !== text.shown;
    fieldText.current = text.shown;
    if (!first && !pushed && !caretRequested.current) {
      // The field's text is unchanged (an upload landed behind its chip): its caret stands where it stood, and that
      // place in the draft follows the draft.
      const shown = shownSelection.current;
      if (shown !== null) draftSelection.current = { start: draftOffset(text, shown.start), end: draftOffset(text, shown.end) };
      return;
    }
    // A field drawn with text has its caret at the end (`draftSelection` starts there).
    if (first) {
      caretPlaced(text, shownOffset(text, draftSelection.current.end));
      return;
    }
    const hostPlaced = caretRequested.current;
    caretRequested.current = false;
    const caret = shownOffset(text, draftSelection.current.end);
    force({ start: caret, end: caret });
    if (hostPlaced) holdHostCaret(caret);
    caretPlaced(text, caret);
  }, [text]);

  const onChangeText = (next: string): void => {
    const before = textRef.current;
    if (next === before.shown) return;
    // The user typed: the caret is theirs now.
    hostCaret.current = null;
    // Key repeats (a held Backspace) arrive before the next render: each is diffed against the
    // text the last one left.
    const result = editShown(before, next);
    textRef.current = result.text;
    fieldText.current = result.text.shown;
    const caret = { start: result.caret, end: result.caret };
    const caretInDraft = { start: result.draftCaret, end: result.draftCaret };
    draftSelection.current = caretInDraft;
    shownSelection.current = caret;
    if (result.rewritten) {
      force(caret);
      // The field holds what the edit typed into a chip: it gets the text as it must read.
      pushNext.current = true;
    } else if (settle.current !== null && Date.now() < settle.current) {
      // An edit right after the field was given new text may have been typed before it took it, so it never did:
      // it gets the text once more.
      pushNext.current = true;
      settle.current = null;
    }
    setDraft(result.text.draft);
    onTextChange(result.text.draft);
    input.edited(result.text.draft, caretInDraft);
    onCaret(result.draftCaret);
  };

  const onSelectionChange = (event: TextInputSelectionChangeEvent): void => {
    const selection = event.nativeEvent.selection;
    const current = textRef.current;
    // iOS reports the text the selection belongs to: one about text the field no longer shows (the
    // chip Backspace half-deleted, before the phone's whole edit reached it) is stale.
    const reportedText = (event.nativeEvent as { text?: unknown }).text;
    if (typeof reportedText === 'string' && reportedText !== current.shown) return;
    const snapped = snapSelection(current, selection, shownSelection.current);
    const moved = snapped.start !== selection.start || snapped.end !== selection.end;
    const held = hostCaret.current;
    if (held !== null) {
      if (Date.now() >= held.until) hostCaret.current = null;
      else if (selection.start !== held.offset || selection.end !== held.offset) {
        // The field's own report, before it took the caret the host placed (or from the focus, or the new text it
        // was just given): not the user's. The host's caret is set on it again.
        field.current?.setSelection(held.offset, held.offset);
        return;
      } else hostCaret.current = null;
    }
    const waiting = awaited.current;
    if (waiting !== null) {
      const arrived = waiting.selection.start === selection.start && waiting.selection.end === selection.end;
      if (arrived || Date.now() >= waiting.until) awaited.current = null;
      // A report the field sent before it took the phone's caret: snapping it would undo that move.
      else if (moved) return;
    }
    if (forced !== undefined) setForced(undefined);
    shownSelection.current = { start: snapped.start, end: snapped.end };
    if (moved) force(snapped);
    const inDraft = { start: draftOffset(current, snapped.start), end: draftOffset(current, snapped.end) };
    draftSelection.current = inDraft;
    input.selected(inDraft);
    onCaret(inDraft.end);
  };

  // The field's styled text, rebuilt only when the field must change (see the FIX above): the host replaced the text
  // (the field holds other words), a chip came, went or changed its look, an edit cut into a chip, or the theme
  // changed. Typing elsewhere keeps the children the field was last given.
  const look = chipsLook(text, model.uploadTokens);
  const source = fieldSource.current;
  if (
    text.chips.length > 0 &&
    (source === null ||
      pushNext.current ||
      fieldText.current !== text.shown ||
      source.look !== look ||
      source.theme !== P ||
      source.styles !== styles)
  ) {
    const fresh = !pushNext.current;
    pushNext.current = false;
    // A push that may not take (the user typing ahead of it) is pushed once more by the next edit (`onChangeText`).
    settle.current = fresh ? Date.now() + PUSH_SETTLE_MS : null;
    fieldSource.current = { look, theme: P, styles, children: chipChildren(text, model.uploadTokens, P, styles) };
  } else if (text.chips.length === 0 && source !== null) {
    fieldSource.current = null;
  }
  const children = text.chips.length > 0 ? (fieldSource.current?.children ?? null) : null;

  // The field was handed new styled children (a chip came, went or changed its look: an upload landed): Android
  // applies them as a whole new text, and the field's caret goes where it likes. The caret the field had goes back.
  useLayoutEffect(() => {
    const shown = shownSelection.current;
    if (shown === null || field.current?.isFocused() !== true) return;
    field.current.setSelection(shown.start, shown.end);
  }, [children]);

  // A TextInput wraps its placeholder and cannot truncate it, so the field draws the placeholder's
  // first line itself, cut to one line with an ellipsis, over the empty field: at a large text size
  // the hint shortens instead of wrapping or growing the box (the phone's "Hold the send or mic button for more...").
  const collapsedHint = draft.length === 0 ? (placeholder.split('\n')[0] ?? '') : null;
  const field_ = (
    <GhostexImageIntakeView onImages={onImages}>
      <TextInput
        ref={field}
        accessibilityLabel="Message composer"
        multiline
        scrollEnabled
        {...(children === null ? { value: text.shown } : {})}
        {...(forced !== undefined ? { selection: forced } : {})}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        onFocus={() => input.focused()}
        onBlur={() => input.blurred()}
        placeholder=""
        placeholderTextColor={P.placeholder}
        keyboardAppearance={P.light ? 'light' : 'dark'}
        autoCapitalize="sentences"
        textAlignVertical="top"
        style={[
          styles.input,
          collapsed ? styles.collapsed : { maxHeight, ...(minHeight !== undefined ? { minHeight } : {}) },
        ]}
        {...TEXT_DROPS}
      >
        {children}
      </TextInput>
    </GhostexImageIntakeView>
  );
  // The wrapper stays whether or not the hint shows, so typing the first character never remounts the field.
  return (
    <View>
      {field_}
      {collapsedHint !== null ? (
        <Text style={[styles.hint, { color: P.placeholder }]} numberOfLines={1} pointerEvents="none">
          {collapsedHint}
        </Text>
      ) : null}
    </View>
  );
});

/**
 * The field's text as styled children: plain runs, and each chip as desktop draws its pill (`replacements` in
 * apps/desktop/src/app/native_chat/composer_references.rs): its kind's icon, then the label in its kind's ink, no
 * frame and no fill.
 */
function chipChildren(
  text: ChipText,
  uploads: ComposerModelState['uploadTokens'],
  P: ReturnType<typeof useTranscriptTheme>,
  styles: ReturnType<typeof useStyles>,
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let plain = '';
  let cursor = 0;
  text.chips.forEach((chip, index) => {
    plain += text.shown.slice(cursor, chip.bodyStart);
    if (plain.length > 0) parts.push(<Text key={`text:${index}`}>{plain}</Text>);
    const tint = P.reference[chip.reference.kind] ?? P.reference.file ?? P.foreground;
    const upload = chipUpload(chip, uploads);
    // CDXC:SessionChat 2026-11-15 DECISION: User: "Also pls make it look like it does on desktop." A reference in the chat box is desktop's pill: its kind's icon (a picture's, `chipIconFont.ts`) and its label in its kind's ink, no tinted box and no heavier weight. Supersedes the tinted run of 2026-11-07; the ink stays the transcript's brighter reference colour the phone's chips took before (theme.ts `reference`). A picture still uploading is the same chip in the muted ink; one whose upload failed is in the error ink until Send uploads it again.
    // CDXC:SessionChat 2026-11-15 DECISION: User, after mentions lost their frame in the chat (CDXC:SessionChat 2026-11-15 on `mention_card` in gx-chat-core): the chat box too, "plain text with the same faint dotted underline ... instead of the framed pill, keeping it one piece for delete and cursor moves". A session's run is the field's own text in the sent name's ink with the faint dotted underline (`dottedUnderline`, Android draws it solid), no fill; the caret still steps over it whole. Supersedes the tinted run of 2026-11-13 (Q3062).
    // CDXC:SessionChat 2026-11-16 DECISION: the user picked the "Soft chip" (on `mention_card` in gx-chat-core): a session's run is the field's own text in medium weight on a faint fill, no underline and no state dot, its no-break edges keeping it clear of the words beside it; the caret still steps over it whole. A field's run cannot round its corners or draw the logo and computer icon, which the sent chip has (SessionPill.tsx). Supersedes the dotted run of 2026-11-15 below.
    const look =
      chip.reference.kind === 'session'
        ? { color: P.foreground, fontWeight: '500' as const, backgroundColor: P.ink(0.1) }
        : { color: upload === 'failed' ? P.error : upload === 'uploading' ? P.muted : tint };
    const body = text.shown.slice(chip.bodyStart, chip.bodyEnd);
    const icon = chip.iconAt === null ? -1 : chip.iconAt - chip.bodyStart;
    parts.push(
      <Text key={`chip:${index}`} style={look}>
        {icon < 0 ? (
          body
        ) : (
          <>
            {body.slice(0, icon)}
            <Text style={styles.chipIcon}>{body.slice(icon, icon + 1)}</Text>
            {body.slice(icon + 1)}
          </>
        )}
      </Text>,
    );
    plain = text.shown.slice(chip.bodyEnd, chip.end);
    cursor = chip.end;
  });
  plain += text.shown.slice(cursor);
  if (plain.length > 0) parts.push(<Text key="text:end">{plain}</Text>);
  return parts;
}

const useStyles = themedStyles((P) => ({
  input: {
    color: P.foreground,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 24,
    paddingTop: 2,
    paddingBottom: 2,
    paddingHorizontal: 0,
  },
  // A bit fainter than the theme's placeholder ink (layout A, `placeholder.ts`), so the hint reads as a hint.
  hint: { position: 'absolute', left: 0, right: 0, top: 2, fontSize: 15, lineHeight: 21, opacity: 0.7 },
  collapsed: { height: COLLAPSED_INPUT_HEIGHT, maxHeight: COLLAPSED_INPUT_HEIGHT },
  // The picture glyph sits in its font's 0.6em cell; a size up from the line's 15 brings it near desktop's 1em icon.
  chipIcon: { fontFamily: CHIP_ICON_FAMILY, fontSize: 17 },
}));
