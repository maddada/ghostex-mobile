/**
 * Full-screen progress overlay for creation flows (sessions-drawer.md §6):
 * dimmed backdrop + centered card with spinner + message.
 */

import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexStrokeWidth } from '../../theme/palette';

export type ProgressOverlayProps = {
  visible: boolean;
  message: string;
};

export default function ProgressOverlay({ visible, message }: ProgressOverlayProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ActivityIndicator size="small" color={GhostexPalette.ACCENT} />
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: GhostexPalette.BACKGROUND,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    padding: 16,
  },
  message: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
  },
});
