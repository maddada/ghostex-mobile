import { Caption, SettingsScreenLayout, SettingToggle } from './SettingsControls';

export default function ConnectionPage() {
  return (
    <SettingsScreenLayout>
      <SettingToggle settingKey='autoReconnect' label='Auto-reconnect on disconnect' />
      <Caption>
        Reconnects when the connection to your computer drops, and reopens interrupted agent terminals.
      </Caption>
    </SettingsScreenLayout>
  );
}
