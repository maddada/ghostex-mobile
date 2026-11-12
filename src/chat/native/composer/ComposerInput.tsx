/**
 * The composer's text field: a multiline `TextInput` that grows to a cap, bound to the host's
 * composer model (`src/chat/rust/composer.ts`), which mirrors desktop's text-field handling.
 *
 * Reference pills (`[label](path)` in the draft, parsed by the core's `composerReferences`) show
 * in the field as one short tinted chip each, and the draft's markdown stays beside the field
 * (`chipText.ts`): the caret steps over a chip as one unit, Backspace after it deletes the whole
 * reference, and every edit is made to the draft, which is what the core keeps and Send sends.
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
import type { RustChat } from '../../rust/useRustChat';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import {
  draftOffset,
  editShown,
  projectDraft,
  shownOffset,
  snapSelection,
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
 * The field takes dragged text only (React Native's Android drag filter, which `TextInput.js` passes
 * on but its typings leave out), so an image held over it stays the chat view's drop.
 */
const TEXT_DROPS: Record<string, unknown> = { experimental_acceptDragAndDropTypes: ['text/*'] };

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
  /** A caret the phone moved, until the field reports it. */
  const awaited = useRef<{ selection: Selection; until: number } | null>(null);

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
  const text = useMemo(() => projectDraft(draft, live), [draft, live]);
  /** The text the field showed last; an edit is diffed against it before the next render. */
  const textRef = useRef<ChipText>(text);

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

  // The shown text changed without the field typing it (the host replaced the draft, or the core's
  // parse turned markdown into a chip): the field gets the new text, and the caret goes where it was
  // in the draft.
  useLayoutEffect(() => {
    textRef.current = text;
    const first = fieldText.current === null;
    const pushed = fieldText.current !== text.shown;
    fieldText.current = text.shown;
    if (first || (!pushed && !caretRequested.current)) return;
    caretRequested.current = false;
    const caret = shownOffset(text, draftSelection.current.end);
    force({ start: caret, end: caret });
  }, [text]);

  const onChangeText = (next: string): void => {
    const before = textRef.current;
    if (next === before.shown) return;
    // Key repeats (a held Backspace) arrive before the next render: each is diffed against the
    // text the last one left.
    const result = editShown(before, next);
    textRef.current = result.text;
    fieldText.current = result.text.shown;
    const caret = { start: result.caret, end: result.caret };
    const caretInDraft = { start: result.draftCaret, end: result.draftCaret };
    draftSelection.current = caretInDraft;
    shownSelection.current = caret;
    if (result.rewritten) force(caret);
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

  const children = useMemo(() => {
    if (text.chips.length === 0) return null;
    const parts: React.ReactNode[] = [];
    let plain = '';
    let cursor = 0;
    text.chips.forEach((chip, index) => {
      plain += text.shown.slice(cursor, chip.bodyStart);
      if (plain.length > 0) parts.push(<Text key={`text:${index}`}>{plain}</Text>);
      const tint = P.reference[chip.reference.kind] ?? P.reference.file;
      parts.push(
        <Text key={`chip:${index}`} style={[styles.chip, { color: tint, backgroundColor: `${tint}26` }]}>
          {text.shown.slice(chip.bodyStart, chip.bodyEnd)}
        </Text>,
      );
      plain = text.shown.slice(chip.bodyEnd, chip.end);
      cursor = chip.end;
    });
    plain += text.shown.slice(cursor);
    if (plain.length > 0) parts.push(<Text key="text:end">{plain}</Text>);
    return parts;
  }, [P, styles, text]);

  // A TextInput wraps its placeholder and cannot truncate it, so the field draws the placeholder's
  // first line itself, cut to one line with an ellipsis, over the empty field: at a large text size
  // the hint shortens instead of wrapping or growing the box (the phone's "Hold ↑ for options").
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
        style={[styles.input, collapsed ? styles.collapsed : { maxHeight }]}
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
  hint: { position: 'absolute', left: 0, right: 0, top: 2, fontSize: 15, lineHeight: 21 },
  collapsed: { height: COLLAPSED_INPUT_HEIGHT, maxHeight: COLLAPSED_INPUT_HEIGHT },
  chip: { fontWeight: '500' },
}));
