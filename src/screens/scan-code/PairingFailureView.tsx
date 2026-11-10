/**
 * A pairing that did not finish: the real reason as the title, what to do as one or two sentences, and the next
 * step as the button. It stays until the person acts (it used to be a box that vanished after 3.5 seconds).
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AlertTriangleGlyph, CameraGlyph, PasteGlyph } from '../../components/onboarding/SetupIcons';
import { SETUP_MONOSPACE, SetupButton, useSetupText } from '../../components/onboarding/SetupPrimitives';
import { PairingCopy } from '../../copy';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import type { FailureText } from './pairingFailure';

export type PairingFailureViewProps = {
  text: FailureText;
  onScanAgain: () => void;
  onPaste: () => void;
};

export default function PairingFailureView({ text, onScanAgain, onPaste }: PairingFailureViewProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  const [detailsOpen, setDetailsOpen] = useState(false);
  return (
    <View style={styles.container}>
      <View style={styles.body}>
        <View style={styles.mark}>
          <AlertTriangleGlyph size={30} color={appearance.working} strokeWidth={2.1} />
        </View>
        <View style={styles.text}>
          <Text style={[setupText.titleLg, setupText.center]} accessibilityRole="header">
            {text.title}
          </Text>
          <Text style={[setupText.lede, setupText.center]}>{text.body}</Text>
        </View>
        {text.details !== null ? (
          <View style={styles.details}>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setDetailsOpen((open) => !open)}>
              <Text style={styles.detailsToggle}>{detailsOpen ? PairingCopy.hideDetails : PairingCopy.details}</Text>
            </Pressable>
            {detailsOpen ? <Text style={styles.detailsText}>{text.details}</Text> : null}
          </View>
        ) : null}
      </View>
      <View style={styles.footer}>
        <SetupButton
          variant="primary"
          large
          label={PairingCopy.scanAgain}
          icon={<CameraGlyph size={18} color={appearance.accentForeground} />}
          onPress={onScanAgain}
        />
        <SetupButton
          label={PairingCopy.pasteInstead}
          icon={<PasteGlyph size={16} color={appearance.foreground} />}
          onPress={onPaste}
        />
      </View>
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
      alignItems: 'center',
      paddingHorizontal: 24,
      gap: 20,
    },
    mark: {
      width: 68,
      height: 68,
      borderRadius: 34,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      gap: 10,
      alignSelf: 'stretch',
    },
    details: {
      alignItems: 'center',
      gap: 8,
      alignSelf: 'stretch',
    },
    detailsToggle: {
      color: appearance.accent,
      fontSize: 14,
      fontWeight: '500',
    },
    detailsText: {
      color: appearance.muted,
      fontFamily: SETUP_MONOSPACE,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
    },
    footer: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 8,
      gap: 10,
    },
  });
