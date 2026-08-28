/**
 * Settings page. Group and row order mirror the legacy Android Settings page
 * (artifacts/001-mobile-settings-report/report.md): Terminal behavior, Extra
 * keys, Font size, Scrollback, Cursor, Alerts and hardware keys, then the
 * appended SSH connection group. Every control drives real behavior; there
 * are no persisted-only toggles.
 */

import { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { CursorStyle } from '../../modules/ghostex-native/src/GhostexNative.types';
import SteppedSlider from '../components/common/SteppedSlider';
import type { RootStackParamList } from '../navigation/types';
import {
  KEEP_ALIVE_INTERVAL_MAX_SEC,
  KEEP_ALIVE_INTERVAL_MIN_SEC,
  KEEP_ALIVE_INTERVAL_STEP_SEC,
  MAX_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT,
  MIN_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT,
  SCROLLBACK_ROWS_MAX,
  SCROLLBACK_ROWS_MIN,
  SCROLLBACK_ROWS_STEP,
  SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT_STEP,
  SIDEBAR_SURFACE_OPACITY_MAX,
  SIDEBAR_SURFACE_OPACITY_MIN,
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  useSettingsStore,
  type BellBehavior,
  type GhostexSettings,
  type PreferredAgentInterface,
  type SessionChatTheme,
} from '../settings/store';
import { useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import {
  normalizeSidebarTint,
  sidebarBackgroundForSettings,
  SIDEBAR_BACKGROUND_CONTRAST_MAX,
  SIDEBAR_BACKGROUND_CONTRAST_MIN,
  SIDEBAR_BACKGROUND_TINT_OPTIONS,
} from '../theme/sidebarAppearance';

/** Status line copy, sessions-drawer.md §1 Settings page. */
const SETTINGS_STATUS_LINE = 'Edit chat, terminal behavior, and remote-session alerts.';

type BooleanSettingKey = {
  [Key in keyof GhostexSettings]: GhostexSettings[Key] extends boolean ? Key : never;
}[keyof GhostexSettings];

/** Terminal behavior rows in the legacy Android order. */
const TERMINAL_BEHAVIOR_TOGGLES: { key: BooleanSettingKey; label: string }[] = [
  { key: 'autoScroll', label: 'Auto scroll' },
  { key: 'extraKeysToolbarVisible', label: 'Extra keys toolbar' },
  { key: 'keyBarHapticsEnabled', label: 'Key bar vibration' },
  { key: 'softKeyboardEnabled', label: 'Soft keyboard' },
  { key: 'keepScreenOn', label: 'Keep screen on' },
  { key: 'refreshButtonVisible', label: 'Show refresh button' },
  { key: 'fileUploadButtonVisible', label: 'Show file upload button' },
  { key: 'keyboardButtonVisible', label: 'Show keyboard button' },
  { key: 'doneNotificationSound', label: 'Attention notification sound' },
  { key: 'hideKeyboardOnStartup', label: 'Hide keyboard on startup' },
  { key: 'openUrlsOnTap', label: 'Open URLs on tap' },
  { key: 'confirmTabClose', label: 'Confirm before closing tabs' },
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

const SESSION_CHAT_THEME_ROWS: { value: SessionChatTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

/** Same option order as the desktop app's Default Agent View control. */
const PREFERRED_AGENT_INTERFACE_ROWS: { value: PreferredAgentInterface; label: string }[] = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'chat', label: 'Chat' },
];

function formatRows(rows: number): string {
  return `${rows.toLocaleString('en-US')} rows`;
}

function SidebarTintControl({
  value,
  resolvedBackground,
  onChange,
}: {
  value: string;
  resolvedBackground: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);

  const commitDraft = (): void => {
    if (/^#[0-9a-f]{6}$/iu.test(draft.trim())) {
      onChange(normalizeSidebarTint(draft));
    } else {
      setDraft(value.toUpperCase());
    }
  };

  return (
    <View style={styles.tintCard}>
      <View style={styles.tintHeader}>
        <Text style={styles.rowLabel}>Background Tint</Text>
        <View style={[styles.resolvedBackgroundPreview, { backgroundColor: resolvedBackground }]} />
      </View>
      <View style={styles.tintSwatches}>
        {SIDEBAR_BACKGROUND_TINT_OPTIONS.map((option) => {
          const selected = option.value.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={`${option.label} sidebar tint`}
              accessibilityState={{ selected }}
              hitSlop={3}
              style={[
                styles.tintSwatch,
                { backgroundColor: option.value },
                selected ? styles.tintSwatchSelected : null,
              ]}
              onPress={() => onChange(option.value.toLowerCase())}
            />
          );
        })}
      </View>
      <TextInput
        accessibilityLabel="Sidebar background tint hex color"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
        placeholder="#808080"
        placeholderTextColor={GhostexPalette.MUTED}
        returnKeyType="done"
        spellCheck={false}
        style={styles.tintInput}
        value={draft}
        onBlur={commitDraft}
        onChangeText={(next) => {
          setDraft(next);
          if (/^#[0-9a-f]{6}$/iu.test(next.trim())) {
            onChange(normalizeSidebarTint(next));
          }
        }}
        onSubmitEditing={commitDraft}
      />
    </View>
  );
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

  const stepSidebarContrast = (delta: number): void => {
    const next = Math.min(
      SIDEBAR_BACKGROUND_CONTRAST_MAX,
      Math.max(
        SIDEBAR_BACKGROUND_CONTRAST_MIN,
        settings.sidebarBackgroundContrast + delta,
      ),
    );
    setSetting('sidebarBackgroundContrast', next);
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

        <Text style={styles.sectionHeader}>Theming</Text>
        {renderStepper(
          'Background Contrast',
          `${settings.sidebarBackgroundContrast}`,
          settings.sidebarBackgroundContrast > SIDEBAR_BACKGROUND_CONTRAST_MIN,
          settings.sidebarBackgroundContrast < SIDEBAR_BACKGROUND_CONTRAST_MAX,
          stepSidebarContrast,
        )}
        <Text style={styles.sectionCaption}>
          85 is softer gray; 100 is black. Drawer surfaces adjust automatically.
        </Text>
        <SidebarTintControl
          value={settings.sidebarBackgroundTint}
          resolvedBackground={sidebarBackgroundForSettings(
            settings.sidebarBackgroundTint,
            settings.sidebarBackgroundContrast,
          )}
          onChange={(value) => setSetting('sidebarBackgroundTint', value)}
        />
        <Text style={styles.sectionCaption}>
          Applies the same calibrated dark tint logic as the GPUI sidebar.
        </Text>
        <SteppedSlider
          label="Sidebar groups opacity"
          maximumValue={SIDEBAR_SURFACE_OPACITY_MAX}
          minimumValue={SIDEBAR_SURFACE_OPACITY_MIN}
          step={1}
          value={settings.sidebarGroupsOpacityPercent}
          valueLabel={`${settings.sidebarGroupsOpacityPercent}%`}
          onValueChange={(value) => setSetting('sidebarGroupsOpacityPercent', value)}
        />
        <SteppedSlider
          label="Sidebar projects opacity"
          maximumValue={SIDEBAR_SURFACE_OPACITY_MAX}
          minimumValue={SIDEBAR_SURFACE_OPACITY_MIN}
          step={1}
          value={settings.sidebarProjectsOpacityPercent}
          valueLabel={`${settings.sidebarProjectsOpacityPercent}%`}
          onValueChange={(value) => setSetting('sidebarProjectsOpacityPercent', value)}
        />
        <Text style={styles.sectionCaption}>
          Changes only group and project backgrounds and borders.
        </Text>

        <Text style={styles.sectionHeader}>Default agent view</Text>
        {PREFERRED_AGENT_INTERFACE_ROWS.map((row) =>
          renderChoice(
            `agent-view-${row.value}`,
            row.label,
            settings.preferredAgentInterface === row.value,
            () => setSetting('preferredAgentInterface', row.value),
          ),
        )}
        <Text style={styles.sectionCaption}>
          Agent sessions that support chat open in this view. Each tab can still be switched
          between chat and terminal at any time, and a switched tab remembers its own choice.
        </Text>

        <Text style={styles.sectionHeader}>Chat</Text>
        <Text style={styles.sectionCaption}>
          These settings change chat content only; the surrounding mobile app remains dark.
        </Text>
        {SESSION_CHAT_THEME_ROWS.map((row) =>
          renderChoice(
            `chat-theme-${row.value}`,
            row.label,
            settings.sessionChatTheme === row.value,
            () => setSetting('sessionChatTheme', row.value),
          ),
        )}
        <View style={styles.chatFontCard}>
          <Text style={styles.chatFontLabel}>Font Family</Text>
          <TextInput
            accessibilityLabel="Chat font family"
            autoCapitalize="words"
            autoCorrect={false}
            placeholder="App default"
            placeholderTextColor={GhostexPalette.MUTED}
            returnKeyType="done"
            spellCheck={false}
            style={styles.chatFontInput}
            value={settings.sessionChatFontFamily}
            onChangeText={(value) => setSetting('sessionChatFontFamily', value)}
          />
        </View>
        <Text style={styles.sectionCaption}>
          Type an installed font family name. Leave blank to use the app font.
        </Text>
        <SteppedSlider
          label="Message width"
          maximumValue={MAX_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT}
          minimumValue={MIN_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT}
          step={SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT_STEP}
          value={settings.sessionChatTranscriptWidthPercent}
          valueLabel={`${settings.sessionChatTranscriptWidthPercent}%`}
          onValueChange={(value) => setSetting('sessionChatTranscriptWidthPercent', value)}
        />
        <Text style={styles.sectionCaption}>
          Adjusts messages only. The prompt composer keeps its current width.
        </Text>
        {renderToggle('sessionChatVerboseMode', 'Verbose Mode')}
        <Text style={styles.sectionCaption}>
          Expands thinking blocks to show their tool calls by default.
        </Text>

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
        <Pressable
          accessibilityRole="button"
          style={styles.row}
          onPress={() => navigation.navigate('AgentHotkeysEditor')}
        >
          <Text style={styles.rowLabel}>Agent hotkeys</Text>
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
        <SteppedSlider
          label="Scrollback"
          maximumValue={SCROLLBACK_ROWS_MAX}
          minimumValue={SCROLLBACK_ROWS_MIN}
          step={SCROLLBACK_ROWS_STEP}
          value={settings.scrollbackRows}
          valueLabel={formatRows(settings.scrollbackRows)}
          onValueChange={(value) => setSetting('scrollbackRows', value)}
        />
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
  tintCard: {
    gap: 10,
    padding: 12,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  tintHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  resolvedBackgroundPreview: {
    width: 28,
    height: 28,
    borderRadius: GhostexRadii.pill,
    borderWidth: 1,
    borderColor: GhostexPalette.BORDER,
  },
  tintSwatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tintSwatch: {
    width: 28,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: GhostexPalette.BORDER,
  },
  tintSwatchSelected: {
    borderWidth: 3,
    borderColor: GhostexPalette.ACCENT,
  },
  tintInput: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontFamily: 'monospace',
  },
  chatFontCard: {
    gap: 8,
    padding: 12,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  chatFontLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
  },
  chatFontInput: {
    minHeight: 40,
    paddingHorizontal: 10,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
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
