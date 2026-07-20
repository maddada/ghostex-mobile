/**
 * Connection-state overlays over the terminal area (terminal-screen.md §1):
 * opening → spinner + "Connecting...", failed → triangle + "Connection
 * Failed" + error caption + Retry, closed → "Disconnected" + Reconnect.
 * Returns null while the tab is open.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { TerminalTab } from '../../terminal/sessions';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { WarningTriangleIcon } from './icons';

export type TerminalStateOverlayProps = {
  tab: TerminalTab;
  /** Failure caption already summarized for humans. */
  errorCaption: string | null;
  onRetry: () => void;
  onReconnect: () => void;
};

export default function TerminalStateOverlay({
  tab,
  errorCaption,
  onRetry,
  onReconnect,
}: TerminalStateOverlayProps) {
  if (tab.state === 'open') return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      {tab.state === 'opening' && (
        <View style={styles.stack}>
          <ActivityIndicator size="small" color={GhostexPalette.MUTED} />
          <Text style={styles.secondaryText}>Connecting...</Text>
        </View>
      )}
      {tab.state === 'failed' && (
        <View style={styles.stack}>
          <WarningTriangleIcon size={40} color={GhostexPalette.DANGER} />
          <Text style={styles.headline}>Connection Failed</Text>
          {errorCaption !== null && errorCaption.length > 0 && (
            <Text style={styles.caption}>{errorCaption}</Text>
          )}
          <Pressable accessibilityRole="button" style={styles.button} onPress={onRetry}>
            <Text style={styles.buttonLabel}>Retry</Text>
          </Pressable>
        </View>
      )}
      {tab.state === 'closed' && (
        <View style={styles.stack}>
          <Text style={styles.headline}>Disconnected</Text>
          <Pressable accessibilityRole="button" style={styles.button} onPress={onReconnect}>
            <Text style={styles.buttonLabel}>Reconnect</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  stack: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  secondaryText: {
    color: GhostexPalette.MUTED,
    fontSize: 15,
  },
  headline: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 17,
    fontWeight: '600',
  },
  caption: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    marginTop: 4,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  buttonLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
});
