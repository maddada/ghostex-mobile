/**
 * Delayed Send dialog, mirroring the desktop gpui modal
 * (sidebar/delayed-send-modal.tsx) for terminal sessions: Hours + Minutes
 * whole-number inputs (default 0h 5m), the "Press Enter in …" description with
 * the current-timer line when one is armed, and Set Timer / Cancel Timer /
 * Cancel buttons. The status-trigger checkboxes are desktop command-session
 * options and never apply to these terminal sessions, so they are not shown —
 * same as the desktop modal with those capabilities absent.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

/** Desktop bounds: whole minutes between 1 minute and 24 days. */
export const DELAYED_SEND_MIN_DELAY_MS = 60_000;
export const DELAYED_SEND_MAX_DELAY_MS = 24 * 24 * 60 * 60 * 1000;

export type DelayedSendDialogProps = {
  visible: boolean;
  sessionTitle: string;
  /** Countdown label of the armed timer, '' when none is known. */
  remainingLabel: string;
  onConfirm: (delayMs: number) => void;
  onCancelTimer: () => void;
  onCancel: () => void;
};

function parseDurationPart(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return Number.NaN;
  return parsed;
}

export default function DelayedSendDialog({
  visible,
  sessionTitle,
  remainingLabel,
  onConfirm,
  onCancelTimer,
  onCancel,
}: DelayedSendDialogProps) {
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('5');

  useEffect(() => {
    if (visible) {
      setHours('0');
      setMinutes('5');
    }
  }, [visible]);

  const delayMs =
    parseDurationPart(hours) * 3_600_000 + parseDurationPart(minutes) * 60_000;
  const isValidDelay =
    Number.isFinite(delayMs) &&
    delayMs >= DELAYED_SEND_MIN_DELAY_MS &&
    delayMs <= DELAYED_SEND_MAX_DELAY_MS;
  const hasActiveTimer = remainingLabel.length > 0;
  const trimmedTitle = sessionTitle.trim();
  const sessionLabel = trimmedTitle.length > 0 ? `"${trimmedTitle}" agent session` : 'this agent session';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Delayed Send</Text>
          <Text style={styles.body}>
            {`Press Enter in ${sessionLabel} after this delay.`}
            {hasActiveTimer ? `\nCurrent timer sends in ${remainingLabel}.` : ''}
          </Text>
          <View style={styles.durationRow}>
            <View style={styles.durationField}>
              <Text style={styles.fieldLabel}>Hours</Text>
              <TextInput
                accessibilityLabel="Hours"
                style={styles.input}
                keyboardType="number-pad"
                value={hours}
                onChangeText={setHours}
                selectTextOnFocus
              />
            </View>
            <View style={styles.durationField}>
              <Text style={styles.fieldLabel}>Minutes</Text>
              <TextInput
                accessibilityLabel="Minutes"
                autoFocus
                style={styles.input}
                keyboardType="number-pad"
                value={minutes}
                onChangeText={setMinutes}
                selectTextOnFocus
              />
            </View>
          </View>
          <View style={styles.buttonColumn}>
            <Pressable
              accessibilityRole="button"
              disabled={!isValidDelay}
              style={[styles.primaryButton, !isValidDelay ? styles.buttonDisabled : null]}
              onPress={() => {
                if (isValidDelay) onConfirm(delayMs);
              }}
            >
              <Text style={styles.primaryLabel}>Set Timer</Text>
            </Pressable>
            {hasActiveTimer ? (
              <Pressable
                accessibilityRole="button"
                style={styles.destructiveButton}
                onPress={onCancelTimer}
              >
                <Text style={styles.destructiveLabel}>Cancel Timer</Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
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
    fontSize: 17,
    fontWeight: 'bold',
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 17,
  },
  durationRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
  },
  durationField: {
    flex: 1,
  },
  fieldLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginBottom: 4,
  },
  input: {
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: 'rgba(255,255,255,0.06)',
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  buttonColumn: {
    marginTop: 16,
    gap: 8,
  },
  primaryButton: {
    borderRadius: 8,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    paddingVertical: 10,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  destructiveButton: {
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: 'rgba(248,113,113,0.6)',
    alignItems: 'center',
    paddingVertical: 10,
  },
  destructiveLabel: {
    color: '#F87171',
    fontSize: 14,
    fontWeight: '600',
  },
  cancelButton: {
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    paddingVertical: 10,
  },
  cancelLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
  },
});
