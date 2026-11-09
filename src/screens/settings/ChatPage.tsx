import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';

import type { RootStackParamList } from '../../navigation/types';
import {
  READ_ALOUD_RATES,
  useSettingsStore,
  type MarkedHandoversStyle,
  type PreferredAgentInterface,
} from '../../settings/store';
import { VOICE_SUPPORTED } from '../../voice/conversation';
import { readAloudVoices, useReadAloudOnAnywhere } from '../../voice/readAloud';
import { voiceLabel } from './ReadAloudVoicePage';
import { SettingsSection } from './SectionBoundary';
import { Caption, ChoiceRow, LinkRow, SectionHeader, SettingsScreenLayout, SettingToggle } from './SettingsControls';

/** Same option order as the desktop app's Default Agent View control. */
const PREFERRED_AGENT_INTERFACE_ROWS: { value: PreferredAgentInterface; label: string }[] = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'chat', label: 'Chat' },
];

/** The desktop's Marked sections style options, in its order, plus Plain text (see `MarkedSections.tsx`). */
const MARKED_HANDOVERS_STYLE_ROWS: { value: MarkedHandoversStyle; label: string }[] = [
  { value: 'labels', label: 'Coloured labels' },
  { value: 'rule', label: 'Thin left rule' },
  { value: 'badge', label: 'Coloured badge' },
  { value: 'plain', label: 'Plain text' },
];

export default function ChatPage() {
  const preferredAgentInterface = useSettingsStore((state) => state.settings.preferredAgentInterface);
  const markedHandoversStyle = useSettingsStore((state) => state.settings.markedHandoversStyle);
  const setSetting = useSettingsStore((state) => state.setSetting);

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:chat:default-agent-view">
        <SectionHeader title="Default agent view" />
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
      </SettingsSection>
      <SettingsSection name="settings:chat:messages">
        <SectionHeader title="Messages" />
        <SettingToggle settingKey="sessionChatFileEditPreviews" label="Show file edit previews" />
        <Caption>Show the first seven code lines instead of only the path and change counts.</Caption>
        <SettingToggle settingKey="sessionChatMutedThinking" label="Grey thinking" />
        <Caption>
          Show the agent's thinking in grey, so it reads apart from the agent's replies.
        </Caption>
        <SettingToggle settingKey="chatToolCallCards" label="Tool call cards (preview)" />
        <Caption>
          Show each run of tool calls as one line that says which call is running now; tap it to see every call with its
          result, time and the reason for any failure.
        </Caption>
        <SettingToggle settingKey="chatToolCallLines" label="Tool call lines (experimental)" />
        <Caption>
          Draw each run of an agent's tool calls as one quiet line that says what it is doing or did, with the calls as
          rows under it. Detailed view opens the lines, Simple keeps them shut. Off keeps the tool rows.
        </Caption>
        <Caption>
          Show the session's pull requests, issues and Linear tickets under the chat's header. Turn off to keep the
          header to the title; the session list still shows them.
        </Caption>
      </SettingsSection>
      <SettingsSection name="settings:chat:marked-sections">
        <SectionHeader title="Marked sections" />
        {MARKED_HANDOVERS_STYLE_ROWS.map((row) => (
          <ChoiceRow
            key={row.value}
            label={row.label}
            selected={markedHandoversStyle === row.value}
            onPress={() => setSetting('markedHandoversStyle', row.value)}
          />
        ))}
        {markedHandoversStyle !== 'plain' ? (
          <SettingToggle settingKey="markedHandoversEmoji" label="Show marker emojis" />
        ) : null}
        <Caption>
          How the chat colours the sections an agent marks with ❓ Needs you, ✅ Done, ⚠️ Read this and the other
          markers (Marked handovers in the desktop app's Settings &gt; Chat). Show marker emojis puts the marker emoji
          in front of each coloured section; while it is off the colour and the label show the kind.
        </Caption>
      </SettingsSection>
      <SettingsSection name="settings:chat:read-aloud">
        <ReadAloudRows />
      </SettingsSection>
    </SettingsScreenLayout>
  );
}

/**
 * Read aloud's Voice and Speed on this phone, shown while a configured computer has Read aloud on.
 *
 * CDXC:VoiceMode 2026-10-22 WHY: the phone's voices are not the computer's, so Voice and Speed are the phone's own settings and never synced (spec 6.4). They are two rows on Settings › Chat like the desktop's (the user's Q26 for the desktop), and Speed offers the desktop's choices, 0.75x to 2x.
 */
function ReadAloudRows() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const onAnywhere = useReadAloudOnAnywhere();
  const shown = VOICE_SUPPORTED && onAnywhere;
  const voice = useSettingsStore((state) => state.settings.readAloudVoice);
  const rate = useSettingsStore((state) => state.settings.readAloudRate);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const [voiceName, setVoiceName] = useState<string | null>(null);

  useEffect(() => {
    if (!shown || voice === '') {
      setVoiceName(null);
      return undefined;
    }
    let live = true;
    void readAloudVoices()
      .catch(() => null)
      .then((answer) => {
        const match = answer?.voices.find((entry) => entry.name === voice);
        if (live) setVoiceName(match === undefined ? voice : `${match.localeLabel}, ${voiceLabel(match)}`);
      });
    return () => {
      live = false;
    };
  }, [shown, voice]);

  if (!shown) return null;
  return (
    <>
      <SectionHeader title="Read aloud" />
      <LinkRow
        title="Voice"
        description={voice === '' ? "Phone's default voice" : (voiceName ?? voice)}
        onPress={() => navigation.navigate('SettingsPage', { page: 'readAloudVoice' })}
      />
      {READ_ALOUD_RATES.map((value) => (
        <ChoiceRow
          key={value}
          label={`Speed ${value}x`}
          selected={rate === value}
          onPress={() => setSetting('readAloudRate', value)}
        />
      ))}
      <Caption>
        The voice and speed this phone reads agents' replies with, from Read aloud on a reply or Auto-read in a chat's ⋯
        menu.
      </Caption>
    </>
  );
}
