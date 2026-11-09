/**
 * GBot Settings' Voice (Profile): the voice the GBot answers in when you call it (voice/gbotCall.ts), one of the
 * Voice agent's voices for the provider calls use now, or the Voice agent's own. A pick is saved on the computer at
 * once (`ghostex gbots voice`), like the Department and Computer tabs, not with Save.
 */

import { useState, type ReactElement } from 'react';
import { Text, View } from 'react-native';

import { gbotVoiceLabel, type GbotVoiceState } from '../../contract/gbotVoice';
import { GbotChoiceChips, useGbotFormStyles } from './GbotFormParts';

export type GbotVoiceFieldProps = {
  initial: GbotVoiceState;
  /** Saves `voice` ("" for the Voice agent's own); resolves with the computer's answer, a rejection with its sentence. */
  save: (voice: string) => Promise<GbotVoiceState>;
};

export default function GbotVoiceField({ initial, save }: GbotVoiceFieldProps): ReactElement {
  const { styles } = useGbotFormStyles();
  const [state, setState] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { choices } = state;
  const voices = choices.voiceOptions[choices.provider] ?? [];
  const picked = state.voice ?? '';
  const options = [
    { value: '', label: `The Voice agent's voice (${gbotVoiceLabel(choices.defaultVoice)})` },
    ...voices.map((voice) => ({ value: voice, label: gbotVoiceLabel(voice) })),
  ];
  const offered = picked.length === 0 || voices.includes(picked);

  const pick = (voice: string): void => {
    if (busy || voice === picked) return;
    setBusy(true);
    setError(null);
    save(voice).then(
      (next) => {
        setState(next);
        setBusy(false);
      },
      (saveError: unknown) => {
        setBusy(false);
        setError(saveError instanceof Error ? saveError.message : String(saveError));
      },
    );
  };

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Voice</Text>
      <GbotChoiceChips label="Voice" options={options} value={picked} onChange={pick} />
      <Text style={styles.hint}>The voice it answers in when you call it.</Text>
      {!offered ? (
        <Text style={styles.hint}>
          {`${gbotVoiceLabel(picked)} isn't a ${choices.providerLabel} voice, so calls use ${gbotVoiceLabel(choices.defaultVoice)}.`}
        </Text>
      ) : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}
