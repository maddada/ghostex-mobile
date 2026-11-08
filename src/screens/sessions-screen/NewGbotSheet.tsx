/**
 * New GBot on the phone (the GBots heading's long press, or Main Hub's): a name, a title, an icon and a colour, then
 * `ghostex gbots create`. Added from the phone, gxserver asks for the user's approval first (server/src/server/
 * security_gates.rs `gbots_add_action`) and the command waits for it, so the sheet says so while it waits. Instructions,
 * the agent and the rest are set afterwards in GBot Settings (GbotSettingsSheet.tsx).
 */

import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { GbotIcon } from '../../components/sessions/gbotIcons';
import { GBOT_COLORS, GBOT_DEFAULT_ICON, gbotColorHex, type GbotFields } from '../../contract/gbots';
import {
  GbotColorPicker,
  GbotIconPicker,
  GbotSheetButtons,
  GbotSheetCard,
  GbotTextField,
  useGbotFormStyles,
} from './GbotFormParts';

export type NewGbotSheetProps = {
  /** Runs the create; resolves when the computer answered, a rejection keeps the sheet open with its sentence. */
  onCreate: (fields: GbotFields & { name: string }) => Promise<void>;
  onCancel: () => void;
};

export default function NewGbotSheet({ onCreate, onCancel }: NewGbotSheetProps): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState(GBOT_DEFAULT_ICON);
  const [color, setColor] = useState(GBOT_COLORS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = name.trim().length > 0 && !busy;
  const create = (): void => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const fields: GbotFields & { name: string } = { name: name.trim(), icon, color };
    if (title.trim().length > 0) fields.title = title.trim();
    onCreate(fields).catch((createError: unknown) => {
      setBusy(false);
      setError(createError instanceof Error ? createError.message : String(createError));
    });
  };

  return (
    <GbotSheetCard
      onCancel={onCancel}
      footer={
        <GbotSheetButtons
          primaryLabel="Add GBot"
          canPress={canCreate}
          busy={busy}
          onCancel={onCancel}
          onPress={create}
          spinner={<ActivityIndicator color={appearance.accentForeground} />}
        />
      }
    >
      <View style={styles.head}>
        <GbotIcon icon={icon} color={gbotColorHex(color)} size={22} />
        <Text style={styles.title}>New GBot</Text>
      </View>
      <Text style={styles.body}>
        A GBot keeps its name, instructions and memory in every chat. Set its instructions and agent in GBot Settings
        afterwards.
      </Text>
      <GbotTextField label="Name" value={name} onChange={setName} placeholder="e.g. Researcher" />
      <GbotTextField label="Title" value={title} onChange={setTitle} placeholder="e.g. Finds and compares options" />
      <GbotIconPicker value={icon} color={color} onChange={setIcon} />
      <GbotColorPicker value={color} onChange={setColor} />
      {busy ? (
        <Text style={styles.waiting}>
          Adding a GBot from the phone needs your OK. Approve it on your computer or phone; this waits for it.
        </Text>
      ) : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </GbotSheetCard>
  );
}
