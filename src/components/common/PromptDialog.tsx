/**
 * Generic prompt dialog: title, optional body, single text input (optional
 * secure entry), optional checkbox row, inline error line, confirm + cancel.
 * Used for Rename session (§2) and the machine password prompt (§4).
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {body !== undefined && body.length > 0 ? <Text style={styles.body}>{body}</Text> : null}
          <TextInput
            style={[styles.input, multiline ? styles.inputMultiline : null]}
            placeholder={placeholder}
            placeholderTextColor={GhostexPalette.MUTED}
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
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              style={styles.confirmButton}
              onPress={() => onSubmit(value, checkboxValue)}
            >
              <Text style={styles.confirmLabel}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: GhostexPalette.BACKGROUND,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    padding: 16,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 8,
  },
  input: {
    marginTop: 12,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
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
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    flex: 1,
  },
  error: {
    color: GhostexPalette.DANGER,
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
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
});
