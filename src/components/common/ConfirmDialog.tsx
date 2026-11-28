/**
 * Generic confirm dialog: title, optional body, optional highlighted target line, confirm button (destructive tint
 * option) + cancel. When `cancelLabel` is null the dialog is informational (a single Close-style button).
 * `selectableBody` renders the body as selectable text so users can copy commands when no clipboard module is
 * available. Drawn as the app's dialog sheet (`HostedDialogSheet`), the same as `showAlert()`: buttons stacked, the
 * confirm on top and Cancel under it; Back, a tap outside or a drag down run `onDismiss`.
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HostedDialogSheet } from './dialog/AlertHost';
import { DialogButton, DialogButtons, DialogMessage, DialogTitle } from './dialog/DialogParts';

import { GhostexStrokeWidth } from '../../theme/palette';

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  body?: string;
  /** Highlighted line naming the target, e.g. "{alias} · {title}". */
  targetLine?: string;
  confirmLabel: string;
  /** null hides the cancel button (informational dialog). */
  cancelLabel?: string | null;
  destructive?: boolean;
  /** Render the body as selectable monospace text (copy-by-hand fallback). */
  selectableBody?: boolean;
  /** A box under the body, such as "Don't ask again"; the whole line toggles it. */
  checkbox?: { label: string; checked: boolean; onToggle: () => void };
  /** Both buttons drawn alike, for a question with no answer suggested (the cancel button is the other answer). */
  equalButtons?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** A tap outside or the back gesture; `onCancel` when omitted. */
  onDismiss?: () => void;
};

export default function ConfirmDialog({
  visible,
  title,
  body,
  targetLine,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  selectableBody = false,
  checkbox,
  equalButtons = false,
  onConfirm,
  onCancel,
  onDismiss = onCancel,
}: ConfirmDialogProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return (
    <HostedDialogSheet visible={visible} onDismiss={onDismiss} accessibilityLabel={title}>
      <DialogTitle>{title}</DialogTitle>
      {body !== undefined && body.length > 0 ? <DialogMessage selectable={selectableBody}>{body}</DialogMessage> : null}
      {targetLine !== undefined && targetLine.length > 0 ? (
        <Text style={styles.target} numberOfLines={1}>
          {targetLine}
        </Text>
      ) : null}
      {checkbox !== undefined ? (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: checkbox.checked }}
          accessibilityLabel={checkbox.label}
          hitSlop={8}
          onPress={checkbox.onToggle}
          style={styles.checkboxRow}
        >
          <View style={[styles.checkbox, checkbox.checked ? styles.checkboxChecked : null]}>
            {checkbox.checked ? <Text style={styles.checkboxTick}>✓</Text> : null}
          </View>
          <Text style={styles.checkboxLabel}>{checkbox.label}</Text>
        </Pressable>
      ) : null}
      <DialogButtons>
        <DialogButton
          label={confirmLabel}
          kind={equalButtons ? 'neutral' : destructive ? 'destructive' : 'primary'}
          onPress={onConfirm}
        />
        {cancelLabel !== null ? <DialogButton label={cancelLabel} kind="neutral" onPress={onCancel} /> : null}
      </DialogButtons>
    </HostedDialogSheet>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  target: {
    color: appearance.foreground,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    backgroundColor: appearance.input,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: appearance.accent,
    borderColor: appearance.accent,
  },
  checkboxTick: {
    color: appearance.accentForeground,
    fontSize: 13,
    lineHeight: 15,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: appearance.foreground,
    fontSize: 14,
    flexShrink: 1,
  },
});
