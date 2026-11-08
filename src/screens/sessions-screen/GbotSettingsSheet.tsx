/**
 * GBot Settings on the phone, from a bot's long press: Profile (name, title, description, icon, colour, agent, model,
 * approval level, and its department, which opens the Department tab), Instructions (the GBot's standing instructions, with the computer's
 * notice when SOUL.md was changed by hand), Department (GbotDepartmentView.tsx), Memory (GbotMemoryView.tsx: read-only, with Undo) and Routines
 * (GbotRoutinesView.tsx). It edits a local copy read with
 * `ghostex gbots show` and saves the changed fields in one `ghostex gbots edit`, so Cancel leaves everything as it
 * was; a refusal (a taken name, say) shows the computer's own sentence.
 *
 * CDXC:GBots 2026-11-09 WHY: the phone's commands reach the computer over SSH, which gxserver treats as your own
 * terminal, and only your computer's app may let a GBot do more than ask first (server/src/gbots/endpoint.rs
 * `check_approval`). So the phone says that in plain words as soon as a level above Ask is picked, and never sends
 * it: from here a level can only go back to Ask. A gxserver answer that still refuses it is said the same way.
 *
 * CDXC:GBots 2026-11-09 WHY: the agent choices are the ones gxserver accepts for a GBot, which is Chief of Staff's
 * picker list (server/src/gbots/session.rs `bot_agent_rows`), read with `ghostex chief status --json` as Chief's own
 * picker does; the phone's generated chat agents would offer agents gxserver refuses. There is no GBots list
 * endpoint for them yet.
 * SEE-ALSO: the DECISION in contract/gbots.ts, server/src/gbots/endpoint.rs (who may change what).
 */

import { useEffect, useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { GbotIcon } from '../../components/sessions/gbotIcons';
import {
  changedGbotFields,
  GBOT_APPROVALS,
  GBOT_CODEX_APPROVAL_NOTE,
  gbotColorHex,
  type GbotApproval,
  type GbotDetails,
  type GbotFields,
} from '../../contract/gbots';
import type { GbotMemory } from '../../contract/gbotMemory';
import { SegmentedRow } from '../settings/SettingsControls';
import GbotDepartmentView, { type GbotDepartmentAction, type GbotDepartmentState } from './GbotDepartmentView';
import GbotMemoryView from './GbotMemoryView';
import GbotRoutinesView, { type GbotRoutineVerb } from './GbotRoutinesView';
import type { GbotRoutine } from '../../contract/gbotRoutines';
import {
  GbotChoiceChips,
  GbotColorPicker,
  GbotIconPicker,
  GbotSheetButtons,
  GbotSheetCard,
  GbotTextField,
  useGbotFormStyles,
} from './GbotFormParts';

export type GbotSettingsTab = 'profile' | 'instructions' | 'department' | 'memory' | 'routines';
type Tab = GbotSettingsTab;

/** Why the phone can't raise a GBot's approval level, and where to do it. */
function approvalFromComputer(name: string): string {
  return `Only your computer can let a GBot do more than ask first: change it in ${name}'s GBot Settings there. From here you can set it back to Ask.`;
}

/** gxserver's refusal of a raised approval level (server/src/gbots/endpoint.rs `check_approval`). */
function isApprovalRefusal(message: string): boolean {
  return message.includes('do more than ask first');
}
const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'profile', label: 'Profile' },
  { value: 'instructions', label: 'Instructions' },
  { value: 'department', label: 'Department' },
  { value: 'memory', label: 'Memory' },
  { value: 'routines', label: 'Routines' },
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
  /** The Memory tab: read the GBot's memory, and undo its newest change. */
  loadMemory: () => Promise<GbotMemory>;
  undoMemory: (change: string) => Promise<GbotMemory>;
  /** The Routines tab (GbotRoutinesView.tsx): list the GBot's routines, and pause, resume, run or remove one. */
  loadRoutines: () => Promise<GbotRoutine[]>;
  actRoutine: (verb: GbotRoutineVerb, id: string) => Promise<GbotRoutine[]>;
  /** The Department tab (GbotDepartmentView.tsx): read the departments, and run a change. */
  loadDepartments: () => Promise<GbotDepartmentState>;
  actDepartment: (action: GbotDepartmentAction) => Promise<GbotDepartmentState>;
  /** The tab it opens on (a "Routine set" card's Edit opens Routines). */
  initialTab?: GbotSettingsTab;
};

export default function GbotSettingsSheet(props: GbotSettingsSheetProps): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'profile');
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
    if (changed.approval !== undefined && changed.approval !== 'ask') {
      setError(approvalFromComputer(name));
      return;
    }
    setBusy(true);
    setError(null);
    props.onSave(changed).catch((saveError: unknown) => {
      setBusy(false);
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(isApprovalRefusal(message) ? approvalFromComputer(name) : message);
    });
  };

  const name = draft !== null && draft.name.trim().length > 0 ? draft.name.trim() : props.name;
  const raisingApproval =
    draft !== null && saved !== null && draft.approval !== saved.approval && draft.approval !== 'ask';
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
            <Text style={raisingApproval ? styles.warning : styles.hint}>
              {raisingApproval
                ? approvalFromComputer(name)
                : 'Ask: it asks before acting. Edits: it may change files. Auto and Full do more without asking.'}
            </Text>
            <Text style={styles.hint}>{GBOT_CODEX_APPROVAL_NOTE}</Text>
          </View>
          <Pressable accessibilityRole="button" style={styles.field} onPress={() => setTab('department')}>
            <Text style={styles.fieldLabel}>Department</Text>
            <Text style={styles.value}>
              {saved.departmentName.length === 0
                ? 'None'
                : saved.isLead
                  ? `${saved.departmentName} (its lead)`
                  : saved.departmentName}
            </Text>
          </Pressable>
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
      {tab === 'department' ? (
        <GbotDepartmentView name={name} load={props.loadDepartments} act={props.actDepartment} />
      ) : null}
      {tab === 'memory' ? <GbotMemoryView load={props.loadMemory} undo={props.undoMemory} /> : null}
      {tab === 'routines' ? (
        <GbotRoutinesView name={saved?.name ?? props.name} load={props.loadRoutines} act={props.actRoutine} />
      ) : null}
      {error !== null ? <Text style={styles.error}>{error}</Text> : null}
    </GbotSheetCard>
  );
}
