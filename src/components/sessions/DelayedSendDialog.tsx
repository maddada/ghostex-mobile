/**
 * Session Automations dialog, mirroring the shared gpui/web automation-card
 * design for terminal sessions. All Enter triggers dispatch through gxserver
 * to the connected desktop renderer that owns the automation runtime.
 */

import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { AGENT_ICONS } from '../../assets/agentIcons.generated';
import type { DelayedSendTrigger } from '../../commands/ghostexCli';
import { agentIconTint, resolveAgentIconId } from '../../contract/mobileSummary';
import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';
import { formatDeadlineCountdown, remainingMsUntil, useNowTick } from './timerCountdown';

/** Desktop bounds: whole minutes between 1 minute and 24 days. */
export const DELAYED_SEND_MIN_DELAY_MS = 60_000;
export const DELAYED_SEND_MAX_DELAY_MS = 24 * 24 * 60 * 60 * 1000;

export type DelayedSendDialogProps = {
  agentIcon: string;
  agentName: string;
  closeAfterDoneActive: boolean;
  visible: boolean;
  sessionTitle: string;
  /** Countdown label of the armed timer, '' when none is known. */
  remainingLabel: string;
  /**
   * Absolute deadline of the armed timer, '' when none. Prefills the duration
   * fields from the time left (desktop parity) and keeps the "Enter sends in"
   * countdown ticking while the dialog is open.
   */
  delayedSendDeadlineAt: string;
  sendWhenAllProjectSessionsStopActive: boolean;
  sendWhenAgentStopsActive: boolean;
  onConfirm: (trigger: DelayedSendTrigger, delayMs: number) => void | Promise<void>;
  onCancelTimer: () => void | Promise<void>;
  onToggleCloseAfterDone: () => void | Promise<void>;
  onCancel: () => void;
};

function parseDurationPart(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) return Number.NaN;
  return parsed;
}

/**
 * Desktop durationPartsFromMs: whole hours and minutes, rounding an active
 * remainder up to the next minute so editing an existing timer cannot silently
 * shorten a sub-minute remainder.
 */
function durationPartsFromMs(delayMs: number): { hours: number; minutes: number } {
  const totalMinutes = Math.max(1, Math.ceil(delayMs / 60_000));
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

export default function DelayedSendDialog({
  agentIcon,
  agentName,
  closeAfterDoneActive,
  visible,
  sessionTitle,
  remainingLabel,
  delayedSendDeadlineAt,
  sendWhenAllProjectSessionsStopActive,
  sendWhenAgentStopsActive,
  onConfirm,
  onCancelTimer,
  onToggleCloseAfterDone,
  onCancel,
}: DelayedSendDialogProps) {
  const [hours, setHours] = useState('0');
  const [minutes, setMinutes] = useState('5');
  const [sendEnterEnabled, setSendEnterEnabled] = useState(true);
  const [closeAfterDoneEnabled, setCloseAfterDoneEnabled] = useState(closeAfterDoneActive);
  const [trigger, setTrigger] = useState<DelayedSendTrigger>('afterDelay');

  useEffect(() => {
    if (visible) {
      const remainingMs = remainingMsUntil(delayedSendDeadlineAt, Date.now());
      const duration = remainingMs > 0 ? durationPartsFromMs(remainingMs) : undefined;
      setHours(String(duration?.hours ?? 0));
      setMinutes(String(duration?.minutes ?? 5));
      setSendEnterEnabled(true);
      setCloseAfterDoneEnabled(closeAfterDoneActive);
      setTrigger(
        sendWhenAllProjectSessionsStopActive
          ? 'allAgentsStop'
          : sendWhenAgentStopsActive
            ? 'agentStops'
            : 'afterDelay',
      );
    }
  }, [
    closeAfterDoneActive,
    delayedSendDeadlineAt,
    sendWhenAgentStopsActive,
    sendWhenAllProjectSessionsStopActive,
    visible,
  ]);

  // The daemon's label is a snapshot from the last poll; tick the countdown from
  // the phone clock while a deadline is known, like the desktop sidebar row.
  const nowMs = useNowTick(visible && delayedSendDeadlineAt.length > 0);
  const liveCountdown = formatDeadlineCountdown(delayedSendDeadlineAt, nowMs);
  const liveRemainingLabel = liveCountdown.length > 0 ? liveCountdown : remainingLabel;

  const delayMs = parseDurationPart(hours) * 3_600_000 + parseDurationPart(minutes) * 60_000;
  const isValidDelay =
    Number.isFinite(delayMs) && delayMs >= DELAYED_SEND_MIN_DELAY_MS && delayMs <= DELAYED_SEND_MAX_DELAY_MS;
  const hasStatusTrigger = trigger !== 'afterDelay';
  const hasActiveTimer =
    remainingLabel.length > 0 ||
    sendWhenAgentStopsActive ||
    sendWhenAllProjectSessionsStopActive;
  const closeAfterDoneChanged = closeAfterDoneEnabled !== closeAfterDoneActive;
  const canSave = sendEnterEnabled
    ? hasStatusTrigger || isValidDelay
    : hasActiveTimer || closeAfterDoneChanged;
  const trimmedTitle = sessionTitle.trim();
  const sessionTargetLabel = trimmedTitle.length > 0 ? trimmedTitle : 'Current agent session';
  const targetIconId = resolveAgentIconId(agentIcon, agentName);
  const TargetIcon = AGENT_ICONS[targetIconId] ?? AGENT_ICONS.terminal;

  const saveChanges = async (): Promise<void> => {
    if (!canSave) return;
    if (closeAfterDoneChanged) {
      await onToggleCloseAfterDone();
    }
    if (sendEnterEnabled) {
      await onConfirm(trigger, delayMs);
    } else if (hasActiveTimer) {
      await onCancelTimer();
    }
    onCancel();
  };

  return (
    <Modal visible={visible} transparent animationType='fade' onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Session Automations</Text>
          <Text style={styles.body}>Configure automations for this agent session.</Text>
          <View style={styles.sessionTarget}>
            <TargetIcon size={14} color={agentIconTint(targetIconId)} />
            <Text numberOfLines={1} style={styles.sessionTargetTitle}>
              {sessionTargetLabel}
            </Text>
          </View>
          <View style={styles.automationStack}>
            <View style={styles.automationCard}>
              <View style={styles.automationHeader}>
                <View style={styles.automationCopy}>
                  <Text style={styles.automationTitle}>Send Enter</Text>
                  <Text style={styles.automationDescription}>
                    {!sendEnterEnabled
                      ? 'No Enter keypress will be scheduled.'
                      : sendWhenAllProjectSessionsStopActive
                        ? 'Active when all agents finish working.'
                        : sendWhenAgentStopsActive
                          ? 'Active when this agent finishes working.'
                          : liveRemainingLabel.length > 0
                            ? `Active. Enter sends in ${liveRemainingLabel}.`
                            : 'Press Enter later using the selected trigger.'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel='Send Enter automation'
                  value={sendEnterEnabled}
                  onValueChange={setSendEnterEnabled}
                  trackColor={{ false: GhostexPalette.CARD_ACTIVE, true: GhostexPalette.ACCENT }}
                  thumbColor={GhostexPalette.FOREGROUND}
                />
              </View>
              {sendEnterEnabled ? (
                <View style={styles.automationContent}>
                  <Text style={styles.fieldLabel}>Trigger</Text>
                  <View accessibilityRole='radiogroup' style={styles.triggerOptions}>
                    {([
                      ['afterDelay', 'After a delay'],
                      ['agentStops', 'When this agent finishes'],
                      ['allAgentsStop', 'When all agents finish'],
                    ] as const).map(([value, label]) => {
                      const selected = trigger === value;
                      return (
                        <Pressable
                          key={value}
                          accessibilityRole='radio'
                          accessibilityState={{ selected }}
                          style={[styles.triggerOption, selected ? styles.triggerOptionSelected : null]}
                          onPress={() => setTrigger(value)}
                        >
                          <View style={[styles.radio, selected ? styles.radioSelected : null]}>
                            {selected ? <View style={styles.radioDot} /> : null}
                          </View>
                          <Text style={[styles.triggerLabel, selected ? styles.triggerLabelSelected : null]}>
                            {label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <View style={styles.triggerDetailSlot}>
                    {trigger === 'afterDelay' ? (
                      <View style={styles.durationRow}>
                        <View style={styles.durationField}>
                          <Text style={styles.fieldLabel}>Hours</Text>
                          <TextInput
                            accessibilityLabel='Hours'
                            style={styles.input}
                            keyboardType='number-pad'
                            value={hours}
                            onChangeText={setHours}
                            selectTextOnFocus
                          />
                        </View>
                        <View style={styles.durationField}>
                          <Text style={styles.fieldLabel}>Minutes</Text>
                          <TextInput
                            accessibilityLabel='Minutes'
                            autoFocus
                            style={styles.input}
                            keyboardType='number-pad'
                            value={minutes}
                            onChangeText={setMinutes}
                            selectTextOnFocus
                          />
                        </View>
                      </View>
                    ) : (
                      <Text style={styles.triggerDescription}>
                        {trigger === 'agentStops'
                          ? 'Ghostex will send Enter automatically after this agent finishes working and remains idle for 10 seconds.'
                          : 'Ghostex will send Enter automatically after every agent in this project finishes working and remains idle for 10 seconds.'}
                      </Text>
                    )}
                  </View>
                </View>
              ) : null}
            </View>
            <View style={styles.automationCard}>
              <View style={styles.automationHeader}>
                <View style={styles.automationCopy}>
                  <Text style={styles.automationTitle}>Close session after Done</Text>
                  <Text numberOfLines={1} style={styles.automationDescription}>
                    Closes this terminal 3 minutes after Done.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel='Close session after Done'
                  value={closeAfterDoneEnabled}
                  onValueChange={setCloseAfterDoneEnabled}
                  trackColor={{ false: GhostexPalette.CARD_ACTIVE, true: GhostexPalette.ACCENT }}
                  thumbColor={GhostexPalette.FOREGROUND}
                />
              </View>
            </View>
          </View>
          <View style={styles.buttonRow}>
            <Pressable accessibilityRole='button' style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole='button'
              disabled={!canSave}
              style={[styles.primaryButton, !canSave ? styles.buttonDisabled : null]}
              onPress={() => void saveChanges()}
            >
              <Text style={styles.primaryLabel}>Save changes</Text>
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
  sessionTarget: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 7,
  },
  sessionTargetTitle: {
    color: GhostexPalette.FOREGROUND,
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  automationStack: {
    gap: 12,
    marginTop: 16,
  },
  automationCard: {
    backgroundColor: GhostexPalette.CARD,
    borderColor: GhostexPalette.BORDER,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    overflow: 'hidden',
  },
  automationHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 14,
  },
  automationCopy: {
    flex: 1,
    gap: 4,
  },
  automationTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  automationDescription: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  automationContent: {
    borderColor: GhostexPalette.BORDER,
    borderTopWidth: GhostexStrokeWidth,
    gap: 8,
    padding: 14,
  },
  triggerOptions: {
    gap: 6,
  },
  triggerOption: {
    alignItems: 'center',
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderColor: GhostexPalette.BORDER,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  triggerOptionSelected: {
    borderColor: GhostexPalette.ACCENT,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  triggerLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 14,
  },
  triggerLabelSelected: {
    color: GhostexPalette.FOREGROUND,
    fontWeight: '600',
  },
  radio: {
    alignItems: 'center',
    borderColor: GhostexPalette.MUTED,
    borderRadius: 7,
    borderWidth: GhostexStrokeWidth,
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  radioSelected: {
    borderColor: GhostexPalette.ACCENT,
  },
  radioDot: {
    backgroundColor: GhostexPalette.ACCENT,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  durationRow: {
    flexDirection: 'row',
    gap: 12,
  },
  triggerDetailSlot: {
    height: 86,
    justifyContent: 'center',
  },
  triggerDescription: {
    color: GhostexPalette.MUTED,
    fontSize: 14,
    lineHeight: 20,
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
  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 8,
  },
  primaryButton: {
    flex: 1,
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
  cancelButton: {
    flex: 1,
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
