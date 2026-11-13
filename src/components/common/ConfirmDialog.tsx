/**
 * Generic centered confirm dialog: title, optional body, optional highlighted
 * target line, confirm button (destructive tint option) + cancel. When
 * `cancelLabel` is null the dialog is informational (single Close-style
 * button). `selectableBody` renders the body as selectable text so users can
 * copy commands when no clipboard module is available. Half folded like a laptop the card stands below the
 * fold, or above it when it does not fit there, held to that band: a longer body scrolls between the title and the
 * buttons (`useFoldCardPlacement`).
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useFoldCardPlacement } from './foldAvoidance';
import { barPadding } from './verticalBar/layout';
import { useVerticalBarSpace } from './verticalBar/VerticalBarArea';

import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

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
  const bar = useVerticalBarSpace();
  const placement = useFoldCardPlacement({ avoidsKeyboard: false });
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={[styles.backdrop, barPadding(bar, 24), placement.style]} onPress={onDismiss}>
        <Pressable
          style={[styles.card, placement.maxHeight !== null && { maxHeight: placement.maxHeight }]}
          onLayout={placement.onCardLayout}
          onPress={(event) => event.stopPropagation()}
        >
          <Text style={styles.title}>{title}</Text>
          <ScrollView style={styles.content} bounces={false}>
            {body !== undefined && body.length > 0 ? (
              <Text selectable={selectableBody} style={[styles.body, selectableBody ? styles.bodyMono : null]}>
                {body}
              </Text>
            ) : null}
            {targetLine !== undefined && targetLine.length > 0 ? (
              <Text style={styles.target} numberOfLines={1}>
                {targetLine}
              </Text>
            ) : null}
          </ScrollView>
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
          <View style={styles.buttonRow}>
            {cancelLabel !== null ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
                onPress={onCancel}
              >
                <Text style={styles.cancelLabel}>{cancelLabel}</Text>
              </Pressable>
            ) : null}
            {equalButtons ? (
              <Pressable
                accessibilityRole="button"
                style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
                onPress={onConfirm}
              >
                <Text style={styles.cancelLabel}>{confirmLabel}</Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                style={[styles.confirmButton, destructive ? styles.confirmButtonDestructive : null]}
                onPress={onConfirm}
              >
                <Text style={[styles.confirmLabel, destructive ? styles.confirmLabelDestructive : null]}>
                  {confirmLabel}
                </Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: appearance.background,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    padding: 16,
  },
  title: {
    color: appearance.foreground,
    fontSize: 15,
    fontWeight: 'bold',
  },
  // Its own height while it fits; it shrinks and scrolls where the card is held to its band.
  content: {
    flexGrow: 0,
    flexShrink: 1,
  },
  body: {
    color: appearance.muted,
    fontSize: 12,
    marginTop: 8,
  },
  bodyMono: {
    color: appearance.foreground,
    fontFamily: 'monospace',
    backgroundColor: appearance.input,
    borderRadius: GhostexRadii.input,
    padding: 10,
  },
  target: {
    color: appearance.foreground,
    fontSize: 13,
    fontWeight: 'bold',
    marginTop: 8,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
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
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    color: appearance.foreground,
    fontSize: 13,
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
    backgroundColor: appearance.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDestructive: {
    backgroundColor: appearance.danger,
  },
  confirmLabel: {
    color: appearance.accentForeground,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmLabelDestructive: {
    color: appearance.accentForeground,
  },
});
