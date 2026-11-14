import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { CommandPadCopy } from '../../copy';
import { useSettingsStore } from '../../settings/store';
import type { RootStackParamList } from '../../navigation/types';
import { SettingsSection } from './SectionBoundary';
import { Caption, LinkRow, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

/**
 * The Befehlspad's switch (the key bar's `extraKeysToolbarVisible`, same meaning), key vibration and its nine
 * keys, then the editors whose keys fill its Keys and Agent layers (the design).
 */
function CommandPadSection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const padOn = useSettingsStore((state) => state.settings.extraKeysToolbarVisible);

  return (
    <>
      <SectionHeader title={CommandPadCopy.settingsSection} />
      <SettingToggle settingKey="extraKeysToolbarVisible" label={CommandPadCopy.toggle} />
      <Caption>{CommandPadCopy.settingsCaption}</Caption>
      <SettingToggle settingKey="keyBarHapticsEnabled" label={CommandPadCopy.vibration} />
      {/* CDXC:Settings 2026-11-14 DECISION (AGENTS.md, Q3107): the pad's keys and layers show only
          while the pad is on (TerminalScreen draws no key bar or pad while it is off). */}
      {padOn ? (
        <>
          <LinkRow
            title={CommandPadCopy.padKeys}
            description={CommandPadCopy.padKeysDescription}
            onPress={() => navigation.navigate('CommandPadKeysEditor')}
          />
          <SectionHeader title={CommandPadCopy.layersSection} />
          <LinkRow
            title={CommandPadCopy.extraKeysLayout}
            description={CommandPadCopy.extraKeysLayoutDescription}
            onPress={() => navigation.navigate('ExtraKeysEditor')}
          />
          <LinkRow
            title={CommandPadCopy.agentHotkeys}
            description={CommandPadCopy.agentHotkeysDescription}
            onPress={() => navigation.navigate('AgentHotkeysEditor')}
          />
        </>
      ) : null}
    </>
  );
}

export default function KeyboardPage() {
  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:keyboard:command-pad">
        <CommandPadSection />
      </SettingsSection>
    </SettingsScreenLayout>
  );
}
