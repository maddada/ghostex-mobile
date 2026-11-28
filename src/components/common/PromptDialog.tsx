/**
 * Generic prompt dialog: title, optional body, single text input (optional
 * secure entry), optional checkbox row, inline error line, confirm + cancel.
 * Used for Rename session (§2) and the machine password prompt (§4). Drawn as the app's dialog sheet
 * (`HostedDialogSheet`), riding on the keyboard: the confirm button on top, Cancel under it.
 */

import { useMemo, useEffect, useState } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import { Pressable, StyleSheet, Switch, Text, TextInput } from 'react-native';

import { colorWithOpacity, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { HostedDialogSheet } from './dialog/AlertHost';
import { DialogButton, DialogButtons, DialogTitle } from './dialog/DialogParts';
import KeyboardAwareScrollView from './keyboard/KeyboardAwareScrollView';

export type PromptDialogProps = {
  visible: boolean;
  title: string;
  body?: string;
  placeholder: string;
  initialValue?: string;
  /**
   * Multi-line body input (session notes) instead of the single-line default.
   * Off for every existing caller, whose values are all one-line titles.
   */
  multiline?: boolean;
  secureTextEntry?: boolean;
  /** When set, renders a checkbox row under the input. */
  checkboxLabel?: string;
  initialCheckboxValue?: boolean;
  /** Inline error line (e.g. "Enter a session title."). */
  error?: string | null;
  confirmLabel: string;
  onSubmit: (value: string, checkboxValue: boolean) => void;
  onCancel: () => void;
};

export default function PromptDialog({
  visible,
  title,
  body,
  placeholder,
  initialValue = '',
  multiline = false,
  secureTextEntry = false,
  checkboxLabel,
  initialCheckboxValue = false,
  error = null,
  confirmLabel,
  onSubmit,
  onCancel,
}: PromptDialogProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createPromptDialogStyles(appearance), [appearance]);
  const [value, setValue] = useState(initialValue);
  const [checkboxValue, setCheckboxValue] = useState(initialCheckboxValue);

  // Reset the form whenever the dialog opens with fresh initial values.
  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setCheckboxValue(initialCheckboxValue);
    }
  }, [visible, initialValue, initialCheckboxValue]);

  return (
    <HostedDialogSheet visible={visible} onDismiss={onCancel} accessibilityLabel={title}>
      <KeyboardAwareScrollView bounces={false} style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
        <DialogTitle>{title}</DialogTitle>
        {body !== undefined && body.length > 0 ? <Text style={styles.sheetBody}>{body}</Text> : null}
        <TextInput
          keyboardAppearance={appearance.light ? 'light' : 'dark'}
          accessibilityLabel={title}
          style={[styles.input, styles.sheetInput, multiline ? styles.inputMultiline : null]}
          placeholder={placeholder}
          placeholderTextColor={appearance.muted}
          autoCapitalize={multiline ? 'sentences' : 'none'}
          autoCorrect={multiline}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          secureTextEntry={secureTextEntry}
          value={value}
          onChangeText={setValue}
        />
        {checkboxLabel !== undefined ? (
          <Pressable style={styles.checkboxRow} onPress={() => setCheckboxValue(!checkboxValue)}>
            <Switch value={checkboxValue} onValueChange={setCheckboxValue} />
            <Text style={styles.checkboxLabel}>{checkboxLabel}</Text>
          </Pressable>
        ) : null}
        {error !== null && error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
        <DialogButtons>
          <DialogButton label={confirmLabel} kind="primary" onPress={() => onSubmit(value, checkboxValue)} />
          <DialogButton label="Cancel" kind="neutral" onPress={onCancel} />
        </DialogButtons>
      </KeyboardAwareScrollView>
    </HostedDialogSheet>
  );
}

/** Shared with dialogs drawn in the same look (src/links/LinkDialog.tsx). */
export const createPromptDialogStyles = (appearance: Appearance) => StyleSheet.create({
  // The dim sits on the keyboard-avoiding layer so it also covers the strip the keyboard leaves while it slides away.
  keyboardFill: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    maxHeight: '100%',
    backgroundColor: appearance.background,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    overflow: 'hidden',
  },
  cardContent: {
    padding: 16,
  },
  // In the dialog sheet (`PromptDialog`): its content scrolls above the keyboard when it does not fit.
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { color: colorWithOpacity(appearance.foreground, 74), fontSize: 14, lineHeight: 20, marginTop: 6 },
  sheetInput: { marginTop: 14, height: 46, fontSize: 15 },
  title: {
    color: appearance.foreground,
    fontSize: 15,
    fontWeight: 'bold',
  },
  body: {
    color: appearance.muted,
    fontSize: 12,
    marginTop: 8,
  },
  input: {
    marginTop: 12,
    backgroundColor: appearance.input,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    color: appearance.foreground,
    paddingHorizontal: 12,
    height: 44,
  },
  /*
    A note is prose, so the box grows with it instead of scrolling one line:
    fixed height gives way to a min/max range that still leaves the confirm row
    on screen above the keyboard.
  */
  inputMultiline: {
    height: undefined,
    minHeight: 112,
    maxHeight: 220,
    paddingVertical: 10,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
  },
  checkboxLabel: {
    color: appearance.foreground,
    fontSize: 13,
    flex: 1,
  },
  error: {
    color: appearance.danger,
    fontSize: 12,
    marginTop: 8,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  cancelButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: GhostexRadii.card,
    backgroundColor: appearance.neutralFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonPressed: {
    backgroundColor: appearance.neutralFillPressed,
  },
  cancelLabel: {
    color: appearance.foreground,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: GhostexRadii.card,
    backgroundColor: appearance.primaryFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: {
    color: appearance.foreground,
    fontSize: 13,
    fontWeight: '600',
  },
});
