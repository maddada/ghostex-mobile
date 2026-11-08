/**
 * GitHub #495, 11.1.0: one card per computer this phone is pairing with over SSH
 * (`machines/sshPairing.ts`). It floats at the top of whatever screen is open, so it shows on the
 * first sign-in after the update and right where an action would have waited: the three words to
 * compare on the computer, what waits until then, and the outcome (paired, denied, lapsed) with
 * Ask again. Mounting it also registers pairing over SSH with the chat link (the module's import).
 */

import { useMemo } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SshPairingCopy } from '../../copy';
import { hideSshPairing, startSshPairing, useSshPairings, type SshPairing } from '../../machines/sshPairing';
import { useMachinesStore } from '../../machines/store';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

function title(pairing: SshPairing): string {
  switch (pairing.phase) {
    case 'asking':
      return SshPairingCopy.askingTitle(pairing.computer);
    case 'pending':
      return SshPairingCopy.pendingTitle(pairing.computer);
    case 'paired':
      return SshPairingCopy.pairedTitle(pairing.computer);
    case 'denied':
      return SshPairingCopy.deniedTitle(pairing.computer);
    case 'expired':
      return SshPairingCopy.expiredTitle;
    case 'failed':
      return SshPairingCopy.failedTitle;
  }
}

export default function SshPairingNotices() {
  const pairings = useSshPairings((state) => state.pairings);
  const hidden = useSshPairings((state) => state.hidden);
  const insets = useSafeAreaInsets();
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const shown = Object.values(pairings).filter((pairing) => hidden[pairing.machineId] !== true);
  if (shown.length === 0) return null;
  const askAgain = (machineId: string) => {
    const machine = useMachinesStore.getState().machines.find((record) => record.id === machineId);
    if (machine !== undefined) void startSshPairing(machine, { auto: false });
  };
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 8 }]}>
      {shown.map((pairing) => {
        const retry = pairing.phase === 'denied' || pairing.phase === 'expired' || pairing.phase === 'failed';
        return (
          <View key={pairing.machineId} style={styles.card} accessibilityRole="alert" testID="ssh-pairing-notice">
            <View style={styles.header}>
              <Text style={styles.title}>{title(pairing)}</Text>
              <Pressable
                accessibilityRole="button"
                hitSlop={10}
                onPress={() => hideSshPairing(pairing.machineId)}
                style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonLabel}>{SshPairingCopy.hide}</Text>
              </Pressable>
            </View>
            {pairing.phase === 'pending' && (
              <>
                <Text style={styles.body}>{SshPairingCopy.pendingBody(pairing.computer)}</Text>
                <Text style={styles.words} testID="ssh-pairing-words">
                  {pairing.words.join(' · ')}
                </Text>
                <Text style={styles.why}>{SshPairingCopy.pendingWhy}</Text>
              </>
            )}
            {pairing.phase === 'paired' && <Text style={styles.body}>{SshPairingCopy.pairedBody}</Text>}
            {pairing.phase === 'denied' && <Text style={styles.body}>{SshPairingCopy.deniedBody}</Text>}
            {pairing.phase === 'failed' && pairing.message !== undefined && (
              <Text style={styles.why}>{pairing.message}</Text>
            )}
            {retry && (
              <Pressable
                accessibilityRole="button"
                onPress={() => askAgain(pairing.machineId)}
                style={({ pressed }) => [styles.button, styles.askAgain, pressed && styles.buttonPressed]}
              >
                <Text style={styles.buttonLabel}>{SshPairingCopy.askAgain}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

function createStyles(appearance: Appearance) {
  return StyleSheet.create({
    layer: { position: 'absolute', left: 12, right: 12, gap: 8, zIndex: 1000, elevation: 12 },
    card: {
      borderRadius: 14,
      padding: 14,
      gap: 6,
      backgroundColor: appearance.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: appearance.border,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    title: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: appearance.foreground },
    button: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: appearance.neutralFill },
    buttonPressed: { backgroundColor: appearance.neutralFillPressed },
    buttonLabel: { fontSize: 13, fontWeight: '600', color: appearance.foreground },
    askAgain: { alignSelf: 'flex-start', marginTop: 2 },
    body: { fontSize: 14, lineHeight: 19, color: appearance.foreground },
    words: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: appearance.foreground, textAlign: 'center', marginVertical: 4 },
    why: { fontSize: 12.5, lineHeight: 17, color: appearance.muted },
  });
}
