import { useSettingsStore, type PreferredAgentInterface, type SessionChatTheme } from '../../settings/store';
import { Caption, ChoiceRow, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

/** Same option order as the desktop app's Default Agent View control. */
const PREFERRED_AGENT_INTERFACE_ROWS: { value: PreferredAgentInterface; label: string }[] = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'chat', label: 'Chat' },
];

const SESSION_CHAT_THEME_ROWS: { value: SessionChatTheme; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
];

export default function ChatPage() {
  const preferredAgentInterface = useSettingsStore((state) => state.settings.preferredAgentInterface);
  const sessionChatTheme = useSettingsStore((state) => state.settings.sessionChatTheme);
  const setSetting = useSettingsStore((state) => state.setSetting);

  return (
    <SettingsScreenLayout>
      <SectionHeader title='Default agent view' />
      {PREFERRED_AGENT_INTERFACE_ROWS.map((row) => (
        <ChoiceRow
          key={row.value}
          label={row.label}
          selected={preferredAgentInterface === row.value}
          onPress={() => setSetting('preferredAgentInterface', row.value)}
        />
      ))}
      <Caption>
        Agent sessions that support chat open in this view. Each tab can still be switched between chat and terminal
        at any time, and a switched tab remembers its own choice.
      </Caption>

      <SectionHeader title='Chat theme' />
      {SESSION_CHAT_THEME_ROWS.map((row) => (
        <ChoiceRow
          key={row.value}
          label={row.label}
          selected={sessionChatTheme === row.value}
          onPress={() => setSetting('sessionChatTheme', row.value)}
        />
      ))}
      <Caption>Changes chat content only; the rest of the app keeps its dark theme.</Caption>

      <SectionHeader title='Messages' />
      <SettingToggle settingKey='sessionChatFileEditPreviews' label='Show file edit previews' />
      <Caption>Show the first seven code lines instead of only the path and change counts.</Caption>
      <SettingToggle settingKey='sessionChatVerboseMode' label='Verbose Mode' />
      <Caption>Expands thinking blocks to show their tool calls by default.</Caption>
    </SettingsScreenLayout>
  );
}
