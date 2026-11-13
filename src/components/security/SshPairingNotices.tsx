/**
 * GitHub #495, 11.1.0: the card for the computers this phone is pairing with over SSH
 * (`machines/sshPairing.ts`). It floats at the top of whatever screen is open, so it shows on the
 * first sign-in and right where an action would have waited: what to do on the computer, the three
 * words to compare there, what waits until then, and the outcome (paired, denied, lapsed) with
 * Ask again. Mounting it also registers pairing over SSH with the chat link (the module's import).
 *
 * CDXC:RemotePairing 2026-11-09 WHY: one compact card for every computer waiting, not one tall card
 * each (the user's phone stacked two above SESSIONS); a computer the phone can't reach right now,
 * one still being asked, and one hidden show nothing (CDXC:RemotePairing 2026-11-09 in `copy.ts`).
 */

import { useMemo } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SshPairingCopy } from '../../copy';
import { hideSshPairing, startSshPairing, useSshPairings, type SshPairing } from '../../machines/sshPairing';
import { machineDisplayLabel, useMachinesStore } from '../../machines/store';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

function canAskAgain(pairing: SshPairing): boolean {
  return pairing.phase === 'denied' || pairing.phase === 'lapsed' || pairing.phase === 'failed';
}

function waitsForOwner(pairing: SshPairing): boolean {
  return pairing.phase === 'pending' || pairing.phase === 'lapsed';
}

function singleTitle(pairing: SshPairing): string {
  switch (pairing.phase) {
    case 'paired':
      return SshPairingCopy.pairedTitle(pairing.computer);
    case 'denied':
      return SshPairingCopy.deniedTitle(pairing.computer);
    case 'failed':
      return SshPairingCopy.failedTitle;
    default:
      return SshPairingCopy.approveTitle(pairing.computer);
  }
}

export default function SshPairingNotices() {
  const pairings = useSshPairings((state) => state.pairings);
  const hidden = useSshPairings((state) => state.hidden);
  const unreachable = useSshPairings((state) => state.unreachable);
  const machines = useMachinesStore((state) => state.machines);
  const insets = useSafeAreaInsets();
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const shown = Object.values(pairings).filter(
    (pairing) => pairing.phase !== 'asking' && hidden[pairing.machineId] !== true && unreachable[pairing.machineId] !== true,
  );
  if (shown.length === 0) return null;
  const askAgain = (machineId: string) => {
    const machine = machines.find((record) => record.id === machineId);
    // An Easy Connect request asks for Easy Connect again, not only to approve the phone.
    const easyConnect = pairings[machineId]?.easyConnect === true;
    if (machine !== undefined) void startSshPairing(machine, { auto: false, easyConnect });
  };
  const hideAll = () => shown.forEach((pairing) => hideSshPairing(pairing.machineId));
  const askAgainButton = (machineId: string) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => askAgain(machineId)}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
      testID="ssh-pairing-ask-again"
    >
      <Text style={styles.buttonLabel}>{SshPairingCopy.askAgain}</Text>
    </Pressable>
  );
  const single = shown.length === 1 ? shown[0] : null;
  // The hint names the computer as the Machines list shows it, which may be its address.
  const singleRecord = single === null ? undefined : machines.find((record) => record.id === single.machineId);
  const listLabel = singleRecord !== undefined ? machineDisplayLabel(singleRecord) : (single?.computer ?? '');
  const anyWaiting = shown.some(waitsForOwner);
  return (
    <View pointerEvents="box-none" style={[styles.layer, { top: insets.top + 8 }]}>
      <View style={styles.card} accessibilityRole="alert" testID="ssh-pairing-notice">
        <View style={styles.header}>
          <Text style={styles.title}>
            {single !== null ? singleTitle(single) : SshPairingCopy.approveTitleMany(shown.length)}
          </Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={hideAll}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          >
            <Text style={styles.buttonLabel}>{SshPairingCopy.hide}</Text>
          </Pressable>
        </View>
        {single !== null ? (
          <>
            {single.phase === 'pending' && (
              <>
                <Text style={styles.body}>
                  {single.easyConnect === true
                    ? SshPairingCopy.pendingStepsEasyConnect(single.computer)
                    : SshPairingCopy.pendingSteps(single.computer)}
                </Text>
                <Text style={styles.words} testID="ssh-pairing-words">
                  {single.words.join(' · ')}
                </Text>
              </>
            )}
            {single.phase === 'lapsed' && <Text style={styles.body}>{SshPairingCopy.lapsedSteps(single.computer)}</Text>}
            {single.phase === 'paired' && <Text style={styles.body}>{SshPairingCopy.pairedBody}</Text>}
            {single.phase === 'denied' && <Text style={styles.body}>{SshPairingCopy.deniedBody}</Text>}
            {single.phase === 'failed' && single.message !== undefined && <Text style={styles.body}>{single.message}</Text>}
            {canAskAgain(single) && <View style={styles.askAgain}>{askAgainButton(single.machineId)}</View>}
          </>
        ) : (
          <>
            {anyWaiting && <Text style={styles.body}>{SshPairingCopy.pendingStepsMany}</Text>}
            {shown.map((pairing) => (
              <View key={pairing.machineId} style={styles.row} testID="ssh-pairing-row">
                <Text style={styles.rowName} numberOfLines={1}>
                  {pairing.computer}
                </Text>
                {pairing.phase === 'pending' ? (
                  <Text style={styles.rowWords} testID="ssh-pairing-words">
                    {pairing.words.join(' · ')}
                  </Text>
                ) : (
                  <View style={styles.rowStatus}>
                    <Text style={styles.rowStatusText} numberOfLines={2}>
                      {pairing.phase === 'lapsed'
                        ? SshPairingCopy.lapsedRow
                        : pairing.phase === 'paired'
                          ? SshPairingCopy.pairedRow
                          : pairing.phase === 'denied'
                            ? SshPairingCopy.deniedRow
                            : (pairing.message ?? SshPairingCopy.failedTitle)}
                    </Text>
                    {canAskAgain(pairing) && askAgainButton(pairing.machineId)}
                  </View>
                )}
              </View>
            ))}
          </>
        )}
        {anyWaiting && <Text style={styles.why}>{SshPairingCopy.meanwhile}</Text>}
        {anyWaiting && (
          <Text style={styles.hint}>
            {single !== null ? SshPairingCopy.hideHint(listLabel) : SshPairingCopy.hideHintMany}
          </Text>
        )}
      </View>
    </View>
  );
}

function createStyles(appearance: Appearance) {
  return StyleSheet.create({
    layer: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 12 },
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
    words: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: appearance.foreground, textAlign: 'center', marginVertical: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
      paddingVertical: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: appearance.border,
    },
    rowName: { flexShrink: 1, fontSize: 14, fontWeight: '600', color: appearance.foreground },
    rowWords: { fontSize: 15, fontWeight: '700', color: appearance.foreground },
    rowStatus: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
    rowStatusText: { flexShrink: 1, fontSize: 13, color: appearance.muted, textAlign: 'right' },
    why: { fontSize: 12.5, lineHeight: 17, color: appearance.muted },
    hint: { fontSize: 12, lineHeight: 16, color: appearance.muted },
  });
}
