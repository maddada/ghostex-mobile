/**
 * New GBot on the phone (the GBots heading's long press, or Main Hub's): a name, a title, an icon and a colour, then
 * `ghostex gbots create`. Added from the phone, gxserver asks for the user's approval first (server/src/server/
 * security_gates.rs `gbots_add_action`) and the command waits for it, so the sheet says so while it waits. Instructions,
 * the agent and the rest are set afterwards in GBot Settings (GbotSettingsSheet.tsx).
 *
 * Start from offers the presets the computer has (built in and kept; server/src/gbots/team_file/presets.rs): picking one
 * fills the name, title, icon and colour, and its instructions, description and starter notes come with the add.
 * CDXC:GBots 2026-11-09 SEE-ALSO: the DECISION in apps/desktop/src/app/window/new_gbot_modal.rs.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { GbotIcon } from '../../components/sessions/gbotIcons';
import type { GbotPreset } from '../../contract/gbotTeam';
import { GBOT_COLORS, GBOT_DEFAULT_ICON, gbotColorHex, type GbotFields } from '../../contract/gbots';
import {
  GbotChoiceChips,
  GbotColorPicker,
  GbotIconPicker,
  GbotSheetButtons,
  GbotSheetCard,
  GbotTextField,
  useGbotFormStyles,
} from './GbotFormParts';

export type NewGbotSheetProps = {
  /** Reads the presets of the computer it is added on; a rejection leaves the form without Start from. */
  loadPresets: () => Promise<GbotPreset[]>;
  /** Runs the create; resolves when the computer answered, a rejection keeps the sheet open with its sentence. */
  onCreate: (fields: GbotFields & { name: string; preset?: string }) => Promise<void>;
  onCancel: () => void;
};

export default function NewGbotSheet({ loadPresets, onCreate, onCancel }: NewGbotSheetProps): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [icon, setIcon] = useState(GBOT_DEFAULT_ICON);
  const [color, setColor] = useState(GBOT_COLORS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<GbotPreset[]>([]);
  const [preset, setPreset] = useState('');

  // The presets come from the computer; without them the form is as before.
  useEffect(() => {
    let live = true;
    loadPresets()
      .then((loaded) => {
        if (live) setPresets(loaded);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [loadPresets]);

  const pickPreset = (presetId: string): void => {
    const picked = presets.find((entry) => entry.presetId === presetId);
    setPreset(picked === undefined ? '' : presetId);
    setName(picked?.name ?? '');
    setTitle(picked?.title ?? '');
    setIcon(picked !== undefined && picked.icon.length > 0 ? picked.icon : GBOT_DEFAULT_ICON);
    setColor(picked !== undefined && picked.color.length > 0 ? picked.color : GBOT_COLORS[0].id);
  };

  const canCreate = name.trim().length > 0 && !busy;
  const create = (): void => {
    if (!canCreate) return;
    setBusy(true);
    setError(null);
    const fields: GbotFields & { name: string; preset?: string } = { name: name.trim(), icon, color };
    if (title.trim().length > 0) fields.title = title.trim();
    if (preset.length > 0) fields.preset = preset;
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
      {presets.length > 0 ? (
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Start from</Text>
          <GbotChoiceChips
            label="Start from"
            options={[
              { value: '', label: 'Blank' },
              ...presets.map((entry) => ({ value: entry.presetId, label: entry.name })),
            ]}
            value={preset}
            onChange={pickPreset}
          />
        </View>
      ) : null}
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
