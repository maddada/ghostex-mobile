/**
 * The first screen: app mark and headline over the connect steps (ConnectStart), then two equal buttons, Scan the
 * code and Use Tailscale, and one small link to the demo experience (App Review needs it reachable without a
 * computer). Paste a code stays one tap away on the Scan the code screen. Shown only while no machine is saved
 * (App.tsx), so there is no skip affordance.
 *
 * CDXC:RemotePairing 2026-11-13 DECISION:
 * Q3050 picked "Two equal buttons": Use Tailscale sits under Scan the code at the same size instead of hiding under
 * "Other ways to connect", so someone already on Tailscale skips the code in one tap. Add a computer keeps the
 * single button and the sheet (ConnectActions).
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectSteps } from '../components/onboarding/ConnectStart';
import { CameraGlyph, ShieldGlyph, TerminalGlyph } from '../components/onboarding/SetupIcons';
import { SetupButton, useSetupText } from '../components/onboarding/SetupPrimitives';
import { ConnectStartCopy, WelcomeCopy } from '../copy';
import { DemoCopy } from '../demo/copy';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

export default function WelcomeScreen({ navigation }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const setupText = useSetupText();
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <TerminalGlyph size={36} color={appearance.foreground} strokeWidth={2} />
          </View>
          <View>
            <Text style={styles.headline}>{WelcomeCopy.headline}</Text>
            <Text style={[setupText.lede, setupText.center, styles.subheadline]}>{WelcomeCopy.subheadline}</Text>
          </View>
        </View>

        <ConnectSteps />
      </View>

      <View style={styles.footer}>
        <SetupButton
          variant="primary"
          large
          label={ConnectStartCopy.scanButton}
          icon={<CameraGlyph size={18} color={appearance.accentForeground} />}
          onPress={() => navigation.navigate('ScanCode')}
        />
        <SetupButton
          large
          label={ConnectStartCopy.otherWaysSheet.tailscale.title}
          icon={<ShieldGlyph size={18} color={appearance.foreground} />}
          onPress={() => navigation.navigate('TailscaleForm')}
        />
        <Pressable
          accessibilityRole="button"
          hitSlop={8}
          style={styles.demoLink}
          onPress={() => useMachinesStore.getState().addDemoComputer()}
        >
          <Text style={styles.demoLinkText}>{DemoCopy.welcomeButton}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: appearance.background,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 36,
    paddingHorizontal: 24,
    paddingBottom: 12,
  },
  hero: {
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: appearance.cardActive,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  headline: {
    color: appearance.foreground,
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subheadline: {
    fontSize: 15,
    marginTop: 8,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
  demoLink: {
    alignSelf: 'center',
    marginTop: 4,
  },
  demoLinkText: {
    color: appearance.accent,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 4,
  },
});
