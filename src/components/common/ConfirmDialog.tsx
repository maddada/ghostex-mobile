/**
 * Generic centered confirm dialog: title, optional body, optional highlighted
 * target line, confirm button (destructive tint option) + cancel. When
 * `cancelLabel` is null the dialog is informational (single Close-style
 * button). `selectableBody` renders the body as selectable text so users can
 * copy commands when no clipboard module is available.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

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
  onConfirm: () => void;
  onCancel: () => void;
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
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
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
          <View style={styles.buttonRow}>
            {cancelLabel !== null ? (
              <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
                <Text style={styles.cancelLabel}>{cancelLabel}</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              style={[styles.confirmButton, destructive ? styles.confirmButtonDestructive : null]}
              onPress={onConfirm}
            >
              <Text
                style={[styles.confirmLabel, destructive ? styles.confirmLabelDestructive : null]}
              >
                {confirmLabel}
              </Text>
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
  bodyMono: {
    color: GhostexPalette.FOREGROUND,
    fontFamily: 'monospace',
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    padding: 10,
  },
  target: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    fontWeight: 'bold',
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
  confirmButtonDestructive: {
    backgroundColor: GhostexPalette.DANGER,
  },
  confirmLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmLabelDestructive: {
    color: GhostexPalette.FOREGROUND,
  },
});
