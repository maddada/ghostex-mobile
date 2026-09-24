/**
 * The composer's text field: a multiline `TextInput` that grows to a cap, bound to the host's
 * composer model (`src/chat/rust/composer.ts`), which mirrors desktop's text-field handling.
 *
 * Reference pills (`[label](path)` in the draft, parsed by the core's `composerReferences`) are
 * drawn inside the field as their tinted label; the markdown around the label is kept in the text
 * but drawn with no width, the way desktop's `InlineReplacement` shows a pill over the same text.
 * A pill edits as one glyph (`references.ts`): deleting into it removes the whole reference
 * (`removeAttachment`), typing inside it lands after it.
 */

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ComposerModelState } from '../../rust/composer';
import type { RustChat } from '../../rust/useRustChat';
import { ComposerPalette as P } from './palette';
import { diffEdit, guardEdit, snapCaret, type ComposerReference } from './references';

export type ComposerInputHandle = { focus(): void; blur(): void };

type Selection = { start: number; end: number };

export const ComposerInput = forwardRef<
  ComposerInputHandle,
  {
    model: ComposerModelState;
    input: NonNullable<RustChat['composer']>;
    references: readonly ComposerReference[];
    /** The text the references were parsed from; they are dropped while it differs from `text`. */
    parsedFor: string;
    placeholder: string;
    collapsed: boolean;
    maxHeight: number;
    dispatch: (action: UserAction) => void;
    onTextChange: (text: string) => void;
    onCaret: (caret: number) => void;
  }
>(function ComposerInput({ model, input, references, parsedFor, placeholder, collapsed, maxHeight, dispatch, onTextChange, onCaret }, ref) {
  const field = useRef<TextInput>(null);
  const [text, setText] = useState(model.text);
  const [forced, setForced] = useState<Selection | undefined>(undefined);
  const [, setNonce] = useState(0);
  const textRef = useRef(model.text);
  const seenSequence = useRef(model.replaceSequence);

  useImperativeHandle(ref, () => ({
    focus: () => field.current?.focus(),
    blur: () => field.current?.blur(),
  }));

  // The host replaced the text (a send, a pick, a restore): push it into the field.
  useEffect(() => {
    if (model.replaceSequence === seenSequence.current) return;
    seenSequence.current = model.replaceSequence;
    textRef.current = model.text;
    setText(model.text);
    onTextChange(model.text);
    if (model.caret !== null) setForced({ start: model.caret, end: model.caret });
  }, [model.replaceSequence, model.text, model.caret, onTextChange]);

  const live = parsedFor === text ? references : [];

  const onChangeText = (next: string): void => {
    const before = textRef.current;
    const guarded = guardEdit(before, next, live);
    if (guarded.kind === 'remove') {
      // The core answers with the text minus the whole reference; until then the field shows
      // what it had (the nonce re-renders it over the half-deleted pill).
      dispatch({ type: 'removeAttachment', text: before, start: guarded.reference.start, end: guarded.reference.end });
      setNonce((value) => value + 1);
      return;
    }
    const value = guarded.kind === 'rewrite' ? guarded.text : next;
    const edit = diffEdit(before, value);
    const caret = guarded.kind === 'rewrite' ? guarded.caret : edit.start + edit.inserted.length;
    textRef.current = value;
    setText(value);
    onTextChange(value);
    if (guarded.kind === 'rewrite') setForced({ start: caret, end: caret });
    input.edited(value, { start: caret, end: caret });
    onCaret(caret);
  };

  const onSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>): void => {
    const selection = event.nativeEvent.selection;
    if (forced !== undefined) setForced(undefined);
    if (selection.start === selection.end) {
      const snapped = snapCaret(selection.end, live);
      if (snapped !== null) {
        setForced({ start: snapped, end: snapped });
        input.selected({ start: snapped, end: snapped });
        onCaret(snapped);
        return;
      }
    }
    input.selected(selection);
    onCaret(selection.end);
  };

  const children = useMemo(() => {
    if (live.length === 0) return null;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    live.forEach((reference, index) => {
      if (reference.start > cursor) parts.push(text.slice(cursor, reference.start));
      const tint = P.reference[reference.kind] ?? P.reference.file;
      parts.push(
        <Text key={`h0:${index}`} style={styles.hidden}>
          {'['}
        </Text>,
        <Text key={`l:${index}`} style={[styles.pill, { color: tint, backgroundColor: `${tint}26` }]}>
          {text.slice(reference.labelStart, reference.labelEnd)}
        </Text>,
        <Text key={`h1:${index}`} style={styles.hidden}>
          {text.slice(reference.labelEnd, reference.end)}
        </Text>
      );
      cursor = reference.end;
    });
    if (cursor < text.length) parts.push(text.slice(cursor));
    return parts;
  }, [live, text]);

  return (
    <TextInput
      ref={field}
      accessibilityLabel="Message composer"
      multiline
      scrollEnabled
      {...(children === null ? { value: text } : {})}
      {...(forced !== undefined ? { selection: forced } : {})}
      onChangeText={onChangeText}
      onSelectionChange={onSelectionChange}
      onFocus={() => input.focused()}
      onBlur={() => input.blurred()}
      placeholder={placeholder}
      placeholderTextColor="rgba(158,158,158,0.6)"
      keyboardAppearance="dark"
      autoCapitalize="sentences"
      textAlignVertical="top"
      style={[styles.input, collapsed ? styles.collapsed : { maxHeight }]}
    >
      {children}
    </TextInput>
  );
});

const styles = StyleSheet.create({
  input: {
    color: P.foreground,
    fontSize: 15,
    lineHeight: 21,
    minHeight: 24,
    paddingTop: 2,
    paddingBottom: 2,
    paddingHorizontal: 0,
  },
  collapsed: { maxHeight: 24 },
  pill: { fontWeight: '500' },
  /** The markdown around a pill's label: in the text, drawn with no width. */
  hidden: { fontSize: 0.1, color: 'transparent', letterSpacing: 0 },
});
