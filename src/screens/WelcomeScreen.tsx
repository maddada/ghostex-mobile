/**
 * The first screen: app mark and headline over the connect steps (ConnectStart), Scan the code, and the small
 * links (other ways to connect, the demo computer, which App Review needs reachable without a computer). Shown only
 * while no machine is saved (App.tsx), so there is no skip affordance.
 */

import { useMemo } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConnectActions, ConnectSteps } from '../components/onboarding/ConnectStart';
import { TerminalGlyph } from '../components/onboarding/SetupIcons';
import { useSetupText } from '../components/onboarding/SetupPrimitives';
import { WelcomeCopy } from '../copy';
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
        <ConnectActions
          onScan={() => navigation.navigate('ScanCode')}
          onPaste={() => navigation.navigate('ScanCode', { startWith: 'paste' })}
          onTailscale={() => navigation.navigate('TailscaleForm')}
          extraLink={{ label: DemoCopy.welcomeButton, onPress: () => useMachinesStore.getState().addDemoComputer() }}
        />
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
  },
});
