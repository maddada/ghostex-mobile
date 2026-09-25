import { Pressable, Text } from 'react-native';

import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN, useSettingsStore } from '../../settings/store';
import { useTerminalStore } from '../../terminal/sessions';
import {
  Caption,
  SectionHeader,
  SettingsScreenLayout,
  SettingToggle,
  StepperRow,
  useSettingsStyles,
} from './SettingsControls';

export default function TerminalPage() {
  const styles = useSettingsStyles();
  const fontSize = useSettingsStore((state) => state.settings.fontSize);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const hasFontOverrides = useTerminalStore((state) => Object.keys(state.fontSizeBySessionKey).length > 0);

  const stepFontSize = (delta: number): void => {
    setSetting('fontSize', Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, fontSize + delta)));
  };

  return (
    <SettingsScreenLayout>
      <SectionHeader title='Font size' />
      <StepperRow
        label='Font size'
        value={`${fontSize}`}
        canDecrease={fontSize > TERMINAL_FONT_SIZE_MIN}
        canIncrease={fontSize < TERMINAL_FONT_SIZE_MAX}
        onStep={stepFontSize}
      />
      <Caption>Applies immediately to terminals without a pinch-zoom size of their own.</Caption>
      {hasFontOverrides && (
        <Pressable
          accessibilityRole='button'
          style={styles.row}
          onPress={() => useTerminalStore.getState().clearFontSizeOverrides()}
        >
          <Text style={styles.rowLabel}>Reset pinch-zoom sizes to default</Text>
        </Pressable>
      )}

      <SectionHeader title='Behavior' />
      <SettingToggle settingKey='keepScreenOn' label='Keep screen on' />
      <Caption>Keeps the screen awake while a terminal is open.</Caption>
      <SettingToggle settingKey='confirmTabClose' label='Confirm before closing tabs' />
    </SettingsScreenLayout>
  );
}
