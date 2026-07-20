/**
 * PLACEHOLDER settings screen (sessions-drawer.md §1 Settings page, v1 subset
 * backed by the settings store with the Android defaults).
 */

import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSettingsStore, type GhostexSettings } from '../settings/store';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

const TOGGLES: { key: keyof GhostexSettings; label: string }[] = [
  { key: 'autoScroll', label: 'Auto scroll' },
  { key: 'doneNotificationSound', label: 'Attention notification sound' },
  { key: 'refreshButtonVisible', label: 'Show refresh button' },
  { key: 'fileUploadButtonVisible', label: 'Show upload button' },
  { key: 'keyboardButtonVisible', label: 'Show keyboard button' },
  { key: 'hideKeyboardOnStartup', label: 'Hide keyboard on startup' },
];

export default function SettingsScreen() {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.statusLine}>Edit terminal behavior and remote-session alerts.</Text>
        {TOGGLES.map((toggle) => (
          <View key={toggle.key} style={styles.row}>
            <Text style={styles.rowLabel}>{toggle.label}</Text>
            <Switch
              value={settings[toggle.key] === true}
              onValueChange={(value) => setSetting(toggle.key, value)}
            />
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Font size</Text>
          <Text style={styles.rowValue}>{`${settings.fontSize} pt`}</Text>
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
  rowValue: {
    color: GhostexPalette.MUTED,
    fontSize: 14,
  },
});
