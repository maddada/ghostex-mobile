import type { CursorStyle } from '../../../modules/ghostex-native/src/GhostexNative.types';
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
  useSettingsStore,
  type BellBehavior,
} from '../../settings/store';
import {
  Caption,
  ChoiceRow,
  SectionHeader,
  SettingsScreenLayout,
  SettingsSlider,
  SettingToggle,
  StepperRow,
  type BooleanSettingKey,
} from './SettingsControls';

/** Terminal toggles carried over from the older Android app, in its order. */
const LEGACY_TERMINAL_TOGGLES: { key: BooleanSettingKey; label: string }[] = [
  { key: 'autoScroll', label: 'Auto scroll' },
  { key: 'softKeyboardEnabled', label: 'Soft keyboard' },
  { key: 'refreshButtonVisible', label: 'Show refresh button' },
  { key: 'fileUploadButtonVisible', label: 'Show file upload button' },
  { key: 'keyboardButtonVisible', label: 'Show keyboard button' },
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

export default function AdvancedPage() {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);

  const stepKeepAliveInterval = (delta: number): void => {
    const next = Math.min(
      KEEP_ALIVE_INTERVAL_MAX_SEC,
      Math.max(KEEP_ALIVE_INTERVAL_MIN_SEC, settings.keepAliveIntervalSec + delta)
    );
    setSetting('keepAliveIntervalSec', next);
  };

  return (
    <SettingsScreenLayout intro='Older and rarely needed settings. The defaults suit most people.'>
      <SectionHeader title='Terminal' />
      {LEGACY_TERMINAL_TOGGLES.map((toggle) => (
        <SettingToggle key={toggle.key} settingKey={toggle.key} label={toggle.label} />
      ))}

      <SectionHeader title='Cursor' />
      {CURSOR_STYLE_ROWS.map((row) => (
        <ChoiceRow
          key={row.value}
          label={row.label}
          selected={settings.cursorStyle === row.value}
          onPress={() => setSetting('cursorStyle', row.value)}
        />
      ))}
      <SettingToggle settingKey='cursorBlink' label='Blink' />

      <SectionHeader title='Scrollback' />
      <SettingsSlider
        label='Scrollback'
        maximumValue={SCROLLBACK_ROWS_MAX}
        minimumValue={SCROLLBACK_ROWS_MIN}
        step={SCROLLBACK_ROWS_STEP}
        value={settings.scrollbackRows}
        valueLabel={formatRows(settings.scrollbackRows)}
        onValueChange={(value) => setSetting('scrollbackRows', value)}
      />
      <Caption>Applies to newly opened terminals.</Caption>

      <SectionHeader title='Terminal bell' />
      {BELL_ROWS.map((row) => (
        <ChoiceRow
          key={row.value}
          label={row.label}
          selected={settings.bellBehavior === row.value}
          onPress={() => setSetting('bellBehavior', row.value)}
        />
      ))}

      <SectionHeader title='Chat transcript' />
      <SettingToggle settingKey='sessionChatCustomTranscriptWidthEnabled' label='Custom Transcript Width' />
      <Caption>Lets the transcript use a different width from the prompt composer.</Caption>
      {settings.sessionChatCustomTranscriptWidthEnabled ? (
        <>
          <SettingsSlider
            label='Transcript width'
            maximumValue={MAX_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT}
            minimumValue={MIN_SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT}
            step={SESSION_CHAT_TRANSCRIPT_WIDTH_PERCENT_STEP}
            value={settings.sessionChatTranscriptWidthPercent}
            valueLabel={`${settings.sessionChatTranscriptWidthPercent}%`}
            onValueChange={(value) => setSetting('sessionChatTranscriptWidthPercent', value)}
          />
          <Caption>Adjusts messages only. The prompt composer keeps its current width.</Caption>
        </>
      ) : null}

      <SectionHeader title='Sessions list' />
      <SettingsSlider
        label='Sidebar groups opacity'
        maximumValue={SIDEBAR_SURFACE_OPACITY_MAX}
        minimumValue={SIDEBAR_SURFACE_OPACITY_MIN}
        step={1}
        value={settings.sidebarGroupsOpacityPercent}
        valueLabel={`${settings.sidebarGroupsOpacityPercent}%`}
        onValueChange={(value) => setSetting('sidebarGroupsOpacityPercent', value)}
      />
      <Caption>Changes only group backgrounds and borders.</Caption>

      <SectionHeader title='SSH connection' />
      <SettingToggle settingKey='keepAliveEnabled' label='Send keep-alive packets' />
      <StepperRow
        label='Keep-alive interval'
        value={`${settings.keepAliveIntervalSec} s`}
        canDecrease={settings.keepAliveIntervalSec > KEEP_ALIVE_INTERVAL_MIN_SEC}
        canIncrease={settings.keepAliveIntervalSec < KEEP_ALIVE_INTERVAL_MAX_SEC}
        onStep={(delta) => stepKeepAliveInterval(delta * KEEP_ALIVE_INTERVAL_STEP_SEC)}
        disabled={!settings.keepAliveEnabled}
      />
      <Caption>Applies the next time a machine connects.</Caption>
    </SettingsScreenLayout>
  );
}
