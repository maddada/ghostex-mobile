/**
 * PLACEHOLDER welcome screen (docs/specs/onboarding.md §1).
 * On Continue: persist hasSeenWelcome=true; App.tsx swaps to the main stack.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WelcomeCopy } from '../copy';
import { useMachinesStore } from '../machines/store';
import { GhostexPalette, GhostexRadii } from '../theme/palette';

export default function WelcomeScreen() {
  const setHasSeenWelcome = useMachinesStore((state) => state.setHasSeenWelcome);
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.headline}>{WelcomeCopy.headline}</Text>
        <Text style={styles.subheadline}>{WelcomeCopy.subheadline}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        style={styles.continueButton}
        onPress={() => setHasSeenWelcome(true)}
      >
        <Text style={styles.continueLabel}>{WelcomeCopy.continueButton}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
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
  },
  continueButton: {
    height: 50,
    borderRadius: 12,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 24,
    marginBottom: 24,
    marginTop: 8,
  },
  continueLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 17,
    fontWeight: '600',
  },
});
