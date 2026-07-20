/**
 * Welcome screen (docs/specs/onboarding.md §1): dark scrollable page with app
 * icon, headline, feature list (adapted to what this app ships), and a pinned
 * Continue button. On Continue: persist hasSeenWelcome=true; App.tsx swaps to
 * the main stack.
 */

import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import appIcon from '../../assets/icon.png';
import {
  KeyGlyph,
  PersistenceGlyph,
  SessionsGlyph,
  TerminalGlyph,
} from '../components/onboarding/FeatureIcons';
import FeatureRow from '../components/onboarding/FeatureRow';
import { WelcomeCopy } from '../copy';
import { useMachinesStore } from '../machines/store';
import { GhostexPalette } from '../theme/palette';

const BADGE_BLUE = '#3B82F6';
const BADGE_TEAL = '#14B8A6';
const BADGE_GREEN = '#22C55E';

export default function WelcomeScreen() {
  const setHasSeenWelcome = useMachinesStore((state) => state.setHasSeenWelcome);
  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.topSpacer} />
        <View style={styles.iconWrap}>
          <Image source={appIcon} style={styles.appIcon} />
        </View>
        <Text style={styles.headline}>{WelcomeCopy.headline}</Text>
        <Text style={styles.subheadline}>{WelcomeCopy.subheadline}</Text>
        <View style={styles.featureList}>
          <FeatureRow
            badgeColor={BADGE_BLUE}
            icon={<TerminalGlyph color="#FFFFFF" />}
            title="SSH Terminal"
            description="Connect to servers with GPU-accelerated terminal emulation."
          />
          <FeatureRow
            badgeColor={BADGE_TEAL}
            icon={<PersistenceGlyph color="#FFFFFF" />}
            title="Session Persistence"
            description="Keep sessions alive with Ghostex and zmx, even after disconnects."
          />
          <FeatureRow
            badgeColor={BADGE_GREEN}
            icon={<KeyGlyph color="#FFFFFF" />}
            title="Secure Storage"
            description="Passwords and SSH keys protected by secure storage."
          />
          <FeatureRow
            badgeColor={GhostexPalette.ACCENT}
            icon={<SessionsGlyph color={GhostexPalette.ACCENT_FOREGROUND} />}
            title="Ghostex Sessions"
            description="See and attach to every agent session running on your Mac."
          />
        </View>
      </ScrollView>
      <View style={styles.buttonContainer}>
        <Pressable
          accessibilityRole="button"
          style={styles.continueButton}
          onPress={() => setHasSeenWelcome(true)}
        >
          <Text style={styles.continueLabel}>{WelcomeCopy.continueButton}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  scrollContent: {
    alignItems: 'center',
  },
  topSpacer: {
    height: 24,
  },
  iconWrap: {
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  appIcon: {
    width: 108,
    height: 108,
    borderRadius: 26,
  },
  headline: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 28,
    fontWeight: 'bold',
    textAlign: 'center',
    paddingTop: 18,
  },
  subheadline: {
    color: GhostexPalette.MUTED,
    fontSize: 15,
    textAlign: 'center',
    paddingTop: 6,
    paddingHorizontal: 28,
    paddingBottom: 24,
  },
  featureList: {
    alignSelf: 'stretch',
    paddingHorizontal: 24,
    gap: 20,
  },
  buttonContainer: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 24,
  },
  continueButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 17,
    fontWeight: '600',
  },
});
