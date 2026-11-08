/**
 * Settings › Voice › Language: the language Dictate listens for on the computer picked in
 * Settings › Voice ("auto" lets the recognizer tell). With a local model, the languages it doesn't
 * know say so.
 */

import { useNavigation } from '@react-navigation/native';

import { changeDictate, useDictateStore } from '../../voice/dictateSettings';
import { SettingsSection } from './SectionBoundary';
import { Caption, ChoiceRow, SectionHeader, SettingsScreenLayout } from './SettingsControls';
import { computerName, useVoiceComputer } from './voiceComputer';

export default function DictateLanguagePage() {
  const navigation = useNavigation();
  const { machine } = useVoiceComputer();
  const overview = useDictateStore((state) => (machine !== null && state.loadedFor === machine.id ? state.overview : null));
  const problem = useDictateStore((state) => state.problem);

  if (machine === null || overview === null) {
    return (
      <SettingsScreenLayout>
        <Caption>Open Settings › Voice first; it reads the languages from your computer.</Caption>
      </SettingsScreenLayout>
    );
  }
  const { settings } = overview;
  const choose = (language: string) => {
    if (language === settings.language) return;
    void changeDictate(machine, { language }).then(() => {
      if (useDictateStore.getState().problem === null && navigation.canGoBack()) navigation.goBack();
    });
  };

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:dictateLanguage:list">
        <SectionHeader title={`Dictate on ${computerName(machine)}`} />
        {problem !== null ? <Caption>{problem}</Caption> : null}
        {overview.languages.map((language) => (
          <ChoiceRow
            key={language.code}
            label={language.label}
            selected={settings.language === language.code}
            onPress={() => choose(language.code)}
          />
        ))}
      </SettingsSection>
    </SettingsScreenLayout>
  );
}
