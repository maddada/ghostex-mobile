/**
 * Once the computer answered a scanned code: "Check your computer" with the three words in the middle, how long the phone still waits, and help for the computer that shows nothing
 * (CDXC:RemotePairing 2026-11-10 in copy.ts `PairingCopy`).
 */

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import SetupStepsSheet from '../../components/onboarding/SetupStepsSheet';
import { SetupButton, useSetupText } from '../../components/onboarding/SetupPrimitives';
import { PairingCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

const MINUTE_TICK_MS = 15_000;

export type PairingWaitViewProps = {
  computer: string;
  words: string[];
  giveUpAtMs?: number;
  onCancel: () => void;
};

function minutesLeft(giveUpAtMs: number): number {
  return Math.max(1, Math.ceil((giveUpAtMs - Date.now()) / 60_000));
}

export default function PairingWaitView({ computer, words, giveUpAtMs, onCancel }: PairingWaitViewProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  const [helpOpen, setHelpOpen] = useState(false);
  const [left, setLeft] = useState(giveUpAtMs === undefined ? null : minutesLeft(giveUpAtMs));
  useEffect(() => {
    if (giveUpAtMs === undefined) return;
    setLeft(minutesLeft(giveUpAtMs));
    const timer = setInterval(() => setLeft(minutesLeft(giveUpAtMs)), MINUTE_TICK_MS);
    return () => clearInterval(timer);
  }, [giveUpAtMs]);

  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.intro}>
          <Text style={[setupText.titleLg, setupText.center]} accessibilityRole="header">
            {PairingCopy.checkTitle}
          </Text>
          <Text style={[setupText.lede, setupText.center]}>{PairingCopy.checkLede(computer)}</Text>
        </View>
        <View style={styles.wordsCard} accessible accessibilityLabel={words.join(', ')}>
          {words.map((word) => (
            <Text key={word} style={styles.word}>
              {word}
            </Text>
          ))}
        </View>
        <View style={styles.status}>
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={appearance.muted} />
            <Text style={styles.statusText}>{PairingCopy.waiting}</Text>
          </View>
          {left !== null ? <Text style={[setupText.small, setupText.center]}>{PairingCopy.minutesLeft(left)}</Text> : null}
        </View>
      </View>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setHelpOpen(true)} style={styles.helpLink}>
          <Text style={styles.helpLinkText}>{PairingCopy.showsNothing}</Text>
        </Pressable>
        <SetupButton large label={PairingCopy.cancel} onPress={onCancel} />
      </View>
      <SetupStepsSheet
        visible={helpOpen}
        onClose={() => setHelpOpen(false)}
        title={PairingCopy.showsNothingSheet.title}
        steps={PairingCopy.showsNothingSheet.steps}
      />
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    body: {
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      gap: 24,
    },
    intro: {
      gap: 10,
    },
    wordsCard: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: 18,
      rowGap: 6,
      paddingHorizontal: 16,
      paddingVertical: 22,
      borderRadius: GhostexRadii.section,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
    },
    // Large enough to compare at arm's length with the computer's.
    word: {
      color: appearance.foreground,
      fontSize: 28,
      lineHeight: 36,
      fontWeight: '600',
    },
    status: {
      gap: 6,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
    },
    statusText: {
      color: appearance.muted,
      fontSize: 14,
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 14,
    },
    helpLink: {
      alignSelf: 'center',
    },
    helpLinkText: {
      color: appearance.accent,
      fontSize: 14,
      fontWeight: '500',
      paddingVertical: 4,
    },
  });
