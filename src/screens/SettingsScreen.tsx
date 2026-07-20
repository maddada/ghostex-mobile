/**
 * Settings page (sessions-drawer.md §1 Settings, v1 subset): toggles backed by
 * the settings store with the Android defaults, plus the terminal font size
 * stepper (4-32).
 */

import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  useSettingsStore,
  type GhostexSettings,
} from '../settings/store';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

/** Status line copy, sessions-drawer.md §1 Settings page. */
const SETTINGS_STATUS_LINE = 'Edit terminal behavior and remote-session alerts.';

type BooleanSettingKey = Exclude<keyof GhostexSettings, 'fontSize'>;

const TOGGLES: { key: BooleanSettingKey; label: string }[] = [
  { key: 'autoScroll', label: 'Auto scroll' },
  { key: 'doneNotificationSound', label: 'Attention notification sound' },
  { key: 'refreshButtonVisible', label: 'Show refresh button' },
  { key: 'fileUploadButtonVisible', label: 'Show file upload button' },
  { key: 'keyboardButtonVisible', label: 'Show keyboard button' },
  { key: 'hideKeyboardOnStartup', label: 'Hide keyboard on startup' },
];

export default function SettingsScreen() {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const stepFontSize = (delta: number): void => {
    const next = Math.min(
      TERMINAL_FONT_SIZE_MAX,
      Math.max(TERMINAL_FONT_SIZE_MIN, settings.fontSize + delta),
    );
    setSetting('fontSize', next);
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.statusLine}>{SETTINGS_STATUS_LINE}</Text>
        {TOGGLES.map((toggle) => (
          <View key={toggle.key} style={styles.row}>
            <Text style={styles.rowLabel}>{toggle.label}</Text>
            <Switch
              value={settings[toggle.key]}
              onValueChange={(value) => setSetting(toggle.key, value)}
              trackColor={{ true: GhostexPalette.ACCENT }}
            />
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Font size</Text>
          <View style={styles.stepper}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease font size"
              style={[
                styles.stepperButton,
                settings.fontSize <= TERMINAL_FONT_SIZE_MIN ? styles.stepperButtonDisabled : null,
              ]}
              disabled={settings.fontSize <= TERMINAL_FONT_SIZE_MIN}
              onPress={() => stepFontSize(-1)}
            >
              <Text style={styles.stepperGlyph}>−</Text>
            </Pressable>
            <Text style={styles.stepperValue}>{`${settings.fontSize} pt`}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase font size"
              style={[
                styles.stepperButton,
                settings.fontSize >= TERMINAL_FONT_SIZE_MAX ? styles.stepperButtonDisabled : null,
              ]}
              disabled={settings.fontSize >= TERMINAL_FONT_SIZE_MAX}
              onPress={() => stepFontSize(1)}
            >
              <Text style={styles.stepperGlyph}>+</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  list: {
    padding: 12,
    gap: 8,
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  rowLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    flex: 1,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepperButton: {
    width: 32,
    height: 32,
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperButtonDisabled: {
    opacity: 0.4,
  },
  stepperGlyph: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 18,
    lineHeight: 20,
  },
  stepperValue: {
    color: GhostexPalette.MUTED,
    fontSize: 14,
    minWidth: 44,
    textAlign: 'center',
  },
});
