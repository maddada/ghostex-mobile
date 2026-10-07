/**
 * The Sessions body for a machine whose connection failed (`.cant-reach-card`
 * in docs/2026-09-03/mobile-setup/mobile-06-sessions.html): one centred card
 * with a red cloud, "Can't reach <name>", the sanitized reason, a Retry
 * button and a link to the "What can I check?" checklist. It replaces the
 * old wall-of-text state card for this one state.
 */

import { StyleSheet, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { CloudGlyph, RefreshGlyph } from '../../components/sessions/icons';
import { StripCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export default function MachineFailedCard({
  machineName,
  reason,
  retrying,
  waiting = false,
  onRetry,
  onWhatCanICheck,
}: {
  machineName: string;
  /** Sanitized failure reason from the inventory store (never a raw stderr). */
  reason: string;
  retrying: boolean;
  /** The computer answered but its Ghostex did not yet: the store keeps retrying on its own, so
   * the card says it is connecting and its button is Try now. */
  waiting?: boolean;
  onRetry: () => void;
  onWhatCanICheck: () => void;
}) {
  return (
    <View style={styles.card}>
      <CloudGlyph size={32} color={SetupPalette.ERROR} />
      <Text style={styles.title}>
        {waiting ? StripCopy.failedCard.waitingTitle(machineName) : StripCopy.failedCard.title(machineName)}
      </Text>
      <Text style={styles.reason}>{reason}</Text>
      <View style={styles.actions}>
        <SetupButton
          small
          variant="primary"
          busy={retrying}
          label={waiting ? StripCopy.failedCard.tryNow : StripCopy.failedCard.retry}
          icon={<RefreshGlyph size={14} color={SetupPalette.PRIMARY_BUTTON_FOREGROUND} />}
          onPress={onRetry}
        />
        <SetupButton
          small
          variant="secondary"
          label={StripCopy.failedCard.whatCanICheck}
          onPress={onWhatCanICheck}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    paddingVertical: 24,
    paddingHorizontal: 18,
    alignItems: 'center',
    gap: 10,
    borderRadius: GhostexRadii.section,
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  reason: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
});
