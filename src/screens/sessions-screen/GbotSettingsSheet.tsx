/**
 * GBot Settings on the phone, from a bot's long press: Profile (name, title, description, icon, colour, agent, model,
 * approval level, and the department read-only), Instructions (the GBot's standing instructions, with the computer's
 * notice when SOUL.md was changed by hand) and Memory (a later milestone). It edits a local copy read with
 * `ghostex gbots show` and saves the changed fields in one `ghostex gbots edit`, so Cancel leaves everything as it
 * was; a refusal (raising the approval level from a terminal, a taken name) shows the computer's own sentence.
 *
 * CDXC:GBots 2026-11-09 WHY: the agent choices are the ones gxserver accepts for a GBot, which is Chief of Staff's
 * picker list (server/src/gbots/session.rs `bot_agent_rows`), read with `ghostex chief status --json` as Chief's own
 * picker does; the phone's generated chat agents would offer agents gxserver refuses. There is no GBots list
 * endpoint for them yet.
 * SEE-ALSO: the DECISION in contract/gbots.ts, server/src/gbots/endpoint.rs (who may change what).
 */

import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { GbotIcon } from '../../components/sessions/gbotIcons';
import {
  changedGbotFields,
  GBOT_APPROVALS,
  gbotColorHex,
  type GbotApproval,
  type GbotDetails,
  type GbotFields,
} from '../../contract/gbots';
import { SegmentedRow } from '../settings/SettingsControls';
import {
  GbotChoiceChips,
  GbotColorPicker,
  GbotIconPicker,
  GbotSheetButtons,
  GbotSheetCard,
  GbotTextField,
  useGbotFormStyles,
} from './GbotFormParts';

type Tab = 'profile' | 'instructions' | 'memory';
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'memory', label: 'Memory' },
];

export type GbotSettingsSheetProps = {
  /** The name to show while the GBot loads. */
  name: string;
  load: () => Promise<GbotDetails>;
  /** The agents a GBot can run on (`agentId`, label); empty or failed falls back to a text field. */
  loadAgents: () => Promise<{ agentId: string; name: string }[]>;
  /** Saves the changed fields; resolves when the computer answered, a rejection keeps the sheet open with its sentence. */
  onSave: (fields: GbotFields) => Promise<void>;
  onCancel: () => void;
};

export default function GbotSettingsSheet(props: GbotSettingsSheetProps): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const [tab, setTab] = useState<Tab>('profile');
  const [saved, setSaved] = useState<GbotDetails | null>(null);
  const [draft, setDraft] = useState<Required<GbotFields> | null>(null);
  const [agents, setAgents] = useState<{ agentId: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    props.load().then(
      (details) => {
        if (cancelled) return;
        setSaved(details);
        setDraft({
          name: details.name,
          title: details.title,
          description: details.description,
          soul: details.soul,
          icon: details.icon,
          color: details.color,
          agentId: details.agentId,
          model: details.model,
          approval: details.approval,
        });
      },
      (loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      },
    );
    props.loadAgents().then(
      (list) => {
        if (!cancelled) setAgents(list);
      },
      () => {
        // The agent stays a text field.
      },
    );
    return () => {
      cancelled = true;
    };
    // Read once per opening of the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof GbotFields>(key: K, value: Required<GbotFields>[K]): void =>
    setDraft((current) => (current === null ? current : { ...current, [key]: value }));

  const save = (): void => {
    if (saved === null || draft === null || busy) return;
    const changed = changedGbotFields(saved, draft);
    if (Object.keys(changed).length === 0) {
      props.onCancel();
      return;
    }
    if (changed.name !== undefined && changed.name.trim().length === 0) {
      setError('A GBot needs a name.');
      return;
    }
    setBusy(true);
    setError(null);
    props.onSave(changed).catch((saveError: unknown) => {
      setBusy(false);
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    });
  };

  const name = draft !== null && draft.name.trim().length > 0 ? draft.name.trim() : props.name;
  const agentOptions =
    draft === null
      ? []
      : [
          ...agents.map((agent) => ({ value: agent.agentId, label: agent.name })),
          ...(draft.agentId.length > 0 && !agents.some((agent) => agent.agentId === draft.agentId)
            ? [{ value: draft.agentId, label: draft.agentId }]
            : []),
        ];

  return (
    <GbotSheetCard
      onCancel={props.onCancel}
      footer={
        <GbotSheetButtons
          primaryLabel="Save"
          canPress={draft !== null && !busy}
          busy={busy}
          onCancel={props.onCancel}
          onPress={save}
          spinner={<ActivityIndicator color={appearance.accentForeground} />}
        />
      }
    >
      <View style={styles.head}>
        {draft !== null ? <GbotIcon icon={draft.icon} color={gbotColorHex(draft.color)} size={22} /> : null}
        <Text style={styles.title} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={styles.tabs}>
        <SegmentedRow label="GBot Settings" options={TABS} value={tab} onChange={setTab} />
      </View>
      {draft === null && error === null ? <ActivityIndicator style={styles.loading} color={appearance.muted} /> : null}
      {draft !== null && saved !== null && tab === 'profile' ? (
        <>
          <GbotTextField label="Name" value={draft.name} onChange={(value) => set('name', value)} />
          <GbotTextField
            label="Title"
            value={draft.title}
            onChange={(value) => set('title', value)}
            placeholder="What it does, in a few words"
          />
          <GbotTextField
            label="Description"
            value={draft.description}
            onChange={(value) => set('description', value)}
            multiline
          />
          <GbotIconPicker value={draft.icon} color={draft.color} onChange={(value) => set('icon', value)} />
          <GbotColorPicker value={draft.color} onChange={(value) => set('color', value)} />
          {agentOptions.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Agent</Text>
              <GbotChoiceChips
                label="Agent"
                options={agentOptions}
                value={draft.agentId}
                onChange={(value) => set('agentId', value)}
              />
            </View>
          ) : (
            <GbotTextField label="Agent" value={draft.agentId} onChange={(value) => set('agentId', value)} />
          )}
          <GbotTextField
            label="Model"
            value={draft.model}
            onChange={(value) => set('model', value)}
            placeholder="The agent's own default"
          />
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Approval level</Text>
            <SegmentedRow<GbotApproval>
              label="Approval level"
              options={GBOT_APPROVALS}
              value={draft.approval}
              onChange={(value) => set('approval', value)}
            />
            <Text style={styles.hint}>
              Ask: it asks before acting. Edits: it may change files. Auto and Full do more without asking.
            </Text>
          </View>
          {saved.departmentId.length > 0 ? (
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Department</Text>
              <Text style={styles.value}>{saved.departmentId}</Text>
            </View>
          ) : null}
        </>
      ) : null}
      {draft !== null && saved !== null && tab === 'instructions' ? (
        <>
          {saved.soulDriftMessage.length > 0 ? (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle}>Instructions changed outside Ghostex</Text>
              <Text style={styles.noticeBody}>{saved.soulDriftMessage}</Text>
            </View>
          ) : null}
          <GbotTextField
            label="Instructions"
            value={draft.soul}
            onChange={(value) => set('soul', value)}
            multiline
            tall
            placeholder="Who it is, what it does and how it works"
            hint="Chats opened from now on start with these. Open chats pick them up when they next read their brief."
          />
        </>
      ) : null}
      {tab === 'memory' ? (
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Memory comes later</Text>
          <Text style={styles.noticeBody}>Memory arrives in a later update.</Text>
        </View>
      ) : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </GbotSheetCard>
  );
}
