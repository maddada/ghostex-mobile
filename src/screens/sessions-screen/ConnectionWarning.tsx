import { StyleSheet, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { WarningTriangleIcon } from '../../components/terminal/icons';
import { StripCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { GhostexPalette, GhostexRadii } from '../../theme/palette';

/**
 * CDXC:Sessions 2026-09-16 DECISION:
 * User: show a warning in the React Native sessions list when there is no connection so users understand why they cannot connect.
 * Cached sessions remain visible after a failed refresh; keep the warning visible through retries until a refresh succeeds.
 */
export default function ConnectionWarning({
  machineName,
  inventory,
  onRetry,
}: {
  machineName: string;
  inventory: MachineInventory | undefined;
  onRetry: () => void;
}) {
  // Without cached sessions, the list already shows MachineFailedCard.
  if (inventory?.summary == null || inventory.lastError === null) return null;

  return (
    <View style={styles.banner}>
      <WarningTriangleIcon size={20} color={GhostexPalette.STATUS_WORKING} />
      <View style={styles.copy} accessibilityLiveRegion="polite">
        <Text style={styles.title}>{StripCopy.connectionWarning.title(machineName)}</Text>
        <Text style={styles.body}>{StripCopy.connectionWarning.body}</Text>
        <Text style={styles.body}>{inventory.lastError}</Text>
        <SetupButton
          label={StripCopy.failedCard.retry}
          accessibilityLabel={StripCopy.glyphAction.retry}
          busy={inventory.retrying}
          onPress={onRetry}
          style={styles.retry}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: 8,
    padding: 12,
    borderRadius: GhostexRadii.card,
    borderWidth: 1,
    borderColor: 'rgba(255,180,84,0.35)',
    backgroundColor: 'rgba(255,180,84,0.10)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  body: { color: GhostexPalette.MUTED, fontSize: 12, lineHeight: 17 },
  retry: { alignSelf: 'flex-start', marginTop: 4 },
});
