/**
 * Welcome (docs/2026-09-03/mobile-setup/mobile-01-welcome.html): app mark,
 * headline, the three things the phone can do, and one button. Shown only
 * while no machine is saved (App.tsx), so there is no skip affordance.
 */

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FoldersGlyph, SparklesGlyph, TerminalGlyph } from '../components/onboarding/SetupIcons';
import { SetupButton, setupText } from '../components/onboarding/SetupPrimitives';
import { WelcomeCopy } from '../copy';
import type { RootStackParamList } from '../navigation/types';
import { GhostexStrokeWidth, SetupPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Welcome'>;

const FEATURE_GLYPHS = {
  sessions: SparklesGlyph,
  terminal: TerminalGlyph,
  projects: FoldersGlyph,
} as const;

export default function WelcomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.body}>
        <View style={styles.hero}>
          <View style={styles.logo}>
            <TerminalGlyph size={36} color={SetupPalette.FOREGROUND} strokeWidth={2} />
          </View>
          <View>
            <Text style={styles.headline}>{WelcomeCopy.headline}</Text>
            <Text style={[setupText.lede, setupText.center, styles.subheadline]}>
              {WelcomeCopy.subheadline}
            </Text>
          </View>
        </View>

        <View style={styles.features}>
          {WelcomeCopy.features.map((feature) => {
            const Glyph = FEATURE_GLYPHS[feature.key];
            return (
              <View key={feature.key} style={styles.feature}>
                <View style={styles.featureIcon}>
                  <Glyph size={16} color={SetupPalette.ACCENT} />
                </View>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureDescription}>{feature.description}</Text>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <SetupButton
          variant="primary"
          large
          label={WelcomeCopy.connectButton}
          onPress={() => navigation.navigate('ConnectChoose')}
        />
        <Text style={[setupText.small, setupText.center]}>{WelcomeCopy.footnote}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
    gap: 28,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  hero: {
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#1f1f1f',
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 12 },
    elevation: 8,
  },
  headline: {
    color: SetupPalette.FOREGROUND,
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  subheadline: {
    fontSize: 15,
    marginTop: 8,
  },
  features: {
    gap: 14,
    paddingHorizontal: 6,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  featureIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
    gap: 1,
  },
  featureTitle: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  featureDescription: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    gap: 10,
  },
});
