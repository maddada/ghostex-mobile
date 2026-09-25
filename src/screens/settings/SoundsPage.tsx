import { Caption, SettingsScreenLayout, SettingToggle } from './SettingsControls';

export default function SoundsPage() {
  return (
    <SettingsScreenLayout>
      <SettingToggle settingKey='doneNotificationSound' label='Attention notification sound' />
      <Caption>Plays a sound when a session on your computer finishes or needs your attention.</Caption>
    </SettingsScreenLayout>
  );
}
