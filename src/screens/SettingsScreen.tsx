/**
 * Settings page. Group and row order mirror the legacy Android Settings page
 * (artifacts/001-mobile-settings-report/report.md): Terminal behavior, Extra
 * keys, Font size, Scrollback, Cursor, Alerts and hardware keys, then the
 * appended SSH connection group. Every control drives real behavior; there
 * are no persisted-only toggles.
 */

import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CursorStyle } from '../../modules/ghostex-native/src/GhostexNative.types';
import type { RootStackParamList } from '../navigation/types';
import {
  KEEP_ALIVE_INTERVAL_MAX_SEC,
  KEEP_ALIVE_INTERVAL_MIN_SEC,
  KEEP_ALIVE_INTERVAL_STEP_SEC,
  SCROLLBACK_ROW_OPTIONS,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  useSettingsStore,
  type BellBehavior,
  type GhostexSettings,
} from '../settings/store';
import { useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

/** Status line copy, sessions-drawer.md §1 Settings page. */
const SETTINGS_STATUS_LINE = 'Edit terminal behavior and remote-session alerts.';

type BooleanSettingKey = {
  [Key in keyof GhostexSettings]: GhostexSettings[Key] extends boolean ? Key : never;
}[keyof GhostexSettings];

/** Terminal behavior rows in the legacy Android order. */
const TERMINAL_BEHAVIOR_TOGGLES: { key: BooleanSettingKey; label: string }[] = [
  { key: 'autoScroll', label: 'Auto scroll' },
  { key: 'extraKeysToolbarVisible', label: 'Extra keys toolbar' },
  { key: 'softKeyboardEnabled', label: 'Soft keyboard' },
  { key: 'keepScreenOn', label: 'Keep screen on' },
  { key: 'refreshButtonVisible', label: 'Show refresh button' },
  { key: 'fileUploadButtonVisible', label: 'Show file upload button' },
  { key: 'keyboardButtonVisible', label: 'Show keyboard button' },
  { key: 'doneNotificationSound', label: 'Attention notification sound' },
  { key: 'hideKeyboardOnStartup', label: 'Hide keyboard on startup' },
  { key: 'openUrlsOnTap', label: 'Open URLs on tap' },
];

const CURSOR_STYLE_ROWS: { value: CursorStyle; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'underline', label: 'Underline' },
  { value: 'bar', label: 'Bar' },
];

const BELL_ROWS: { value: BellBehavior; label: string }[] = [
  { value: 'vibrate', label: 'Vibrate' },
  { value: 'beep', label: 'Beep' },
  { value: 'ignore', label: 'Ignore bell' },
];

function formatRows(rows: number): string {
  return `${rows.toLocaleString('en-US')} rows`;
}

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const hasFontOverrides = useTerminalStore(
    (state) => Object.keys(state.fontSizeBySessionKey).length > 0,
  );

  const stepFontSize = (delta: number): void => {
    const next = Math.min(
      TERMINAL_FONT_SIZE_MAX,
      Math.max(TERMINAL_FONT_SIZE_MIN, settings.fontSize + delta),
    );
    setSetting('fontSize', next);
  };

  const stepKeepAliveInterval = (delta: number): void => {
    const next = Math.min(
      KEEP_ALIVE_INTERVAL_MAX_SEC,
      Math.max(KEEP_ALIVE_INTERVAL_MIN_SEC, settings.keepAliveIntervalSec + delta),
    );
    setSetting('keepAliveIntervalSec', next);
  };

  const renderToggle = (key: BooleanSettingKey, label: string) => (
    <View key={key} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={settings[key]}
        onValueChange={(value) => setSetting(key, value)}
        trackColor={{ false: '#3A3A3A', true: GhostexPalette.ACCENT }}
        thumbColor={settings[key] ? GhostexPalette.FOREGROUND : '#A8A8A8'}
        ios_backgroundColor="#3A3A3A"
      />
    </View>
  );

  const renderChoice = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      style={styles.row}
      onPress={onPress}
    >
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected && <View style={styles.radioInner} />}
      </View>
    </Pressable>
  );

  const renderStepper = (
    label: string,
    value: string,
    canDecrease: boolean,
    canIncrease: boolean,
    onStep: (delta: 1 | -1) => void,
    disabled = false,
  ) => (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          style={[styles.stepperButton, (disabled || !canDecrease) && styles.stepperButtonDisabled]}
          disabled={disabled || !canDecrease}
          onPress={() => onStep(-1)}
        >
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          style={[styles.stepperButton, (disabled || !canIncrease) && styles.stepperButtonDisabled]}
          disabled={disabled || !canIncrease}
          onPress={() => onStep(1)}
        >
          <Text style={styles.stepperGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={styles.statusLine}>{SETTINGS_STATUS_LINE}</Text>

        <Text style={styles.sectionHeader}>Terminal behavior</Text>
        {TERMINAL_BEHAVIOR_TOGGLES.map((toggle) => renderToggle(toggle.key, toggle.label))}

        <Text style={styles.sectionHeader}>Extra keys</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.row}
          onPress={() => navigation.navigate('ExtraKeysEditor')}
        >
          <Text style={styles.rowLabel}>Extra keys layout</Text>
          <Text style={styles.rowChevron}>›</Text>
        </Pressable>

        <Text style={styles.sectionHeader}>Font size</Text>
        {renderStepper(
          'Font size',
          `${settings.fontSize}`,
          settings.fontSize > TERMINAL_FONT_SIZE_MIN,
          settings.fontSize < TERMINAL_FONT_SIZE_MAX,
          stepFontSize,
        )}
        <Text style={styles.sectionCaption}>
          Applies immediately to terminals without a pinch-zoom size of their own.
        </Text>
        {hasFontOverrides && (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => useTerminalStore.getState().clearFontSizeOverrides()}
          >
            <Text style={styles.rowLabel}>Reset pinch-zoom sizes to default</Text>
          </Pressable>
        )}

        <Text style={styles.sectionHeader}>Scrollback</Text>
        {SCROLLBACK_ROW_OPTIONS.map((rows) =>
          renderChoice(`scrollback-${rows}`, formatRows(rows), settings.scrollbackRows === rows, () =>
            setSetting('scrollbackRows', rows),
          ),
        )}
        <Text style={styles.sectionCaption}>Applies to newly opened terminals.</Text>

        <Text style={styles.sectionHeader}>Cursor</Text>
        {CURSOR_STYLE_ROWS.map((row) =>
          renderChoice(`cursor-${row.value}`, row.label, settings.cursorStyle === row.value, () =>
            setSetting('cursorStyle', row.value),
          ),
        )}
        {renderToggle('cursorBlink', 'Blink')}

        <Text style={styles.sectionHeader}>Alerts and hardware keys</Text>
        {BELL_ROWS.map((row) =>
          renderChoice(`bell-${row.value}`, row.label, settings.bellBehavior === row.value, () =>
            setSetting('bellBehavior', row.value),
          ),
        )}

        <Text style={styles.sectionHeader}>SSH connection</Text>
        {renderToggle('autoReconnect', 'Auto-reconnect on disconnect')}
        {renderToggle('keepAliveEnabled', 'Send keep-alive packets')}
        {renderStepper(
          'Keep-alive interval',
          `${settings.keepAliveIntervalSec} s`,
          settings.keepAliveIntervalSec > KEEP_ALIVE_INTERVAL_MIN_SEC,
          settings.keepAliveIntervalSec < KEEP_ALIVE_INTERVAL_MAX_SEC,
          (delta) => stepKeepAliveInterval(delta * KEEP_ALIVE_INTERVAL_STEP_SEC),
          !settings.keepAliveEnabled,
        )}
        <Text style={styles.sectionCaption}>
          Connection settings apply the next time a machine connects.
        </Text>
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
  sectionHeader: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  sectionCaption: {
    color: GhostexPalette.MUTED,
    fontSize: 11,
    paddingHorizontal: 4,
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
  rowDisabled: {
    opacity: 0.5,
  },
  rowLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    flex: 1,
  },
  rowChevron: {
    color: GhostexPalette.MUTED,
    fontSize: 22,
    lineHeight: 24,
  },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#3A3A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: GhostexPalette.ACCENT,
  },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: GhostexPalette.ACCENT,
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
