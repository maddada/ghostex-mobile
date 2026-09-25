import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import type { RootStackParamList } from '../../navigation/types';
import { Caption, LinkRow, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

export default function KeyboardPage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <SettingsScreenLayout>
      <SectionHeader title='Extra keys' />
      <SettingToggle settingKey='extraKeysToolbarVisible' label='Extra keys toolbar' />
      <Caption>Shows the row of extra keys above the keyboard in terminals.</Caption>
      <SettingToggle settingKey='keyBarHapticsEnabled' label='Key bar vibration' />
      <LinkRow title='Extra keys layout' onPress={() => navigation.navigate('ExtraKeysEditor')} />
      <LinkRow title='Agent hotkeys' onPress={() => navigation.navigate('AgentHotkeysEditor')} />
    </SettingsScreenLayout>
  );
}
