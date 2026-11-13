/**
 * Settings › Autopilot: the same choices, summary and log as the desktop's Settings › Autopilot,
 * for one computer (Autopilot is each computer's own: its gxserver keeps the choices and acts on its
 * sessions). Read and saved through that computer's `/api/autopilot`
 * (server/src/server/autopilot_http.rs); a change shows at once, and a refusal puts it back.
 *
 * CDXC:Autopilot 2026-11-07 DECISION: User (Q1600): the phone gets Autopilot too, "Yes: the pill, the settings and the log".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { chatMachineLink } from '../../chat/rust/machine-link';
import { isMachineEnabled, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { SettingsSection } from './SectionBoundary';
import {
  Caption,
  ChoiceRow,
  LinkRow,
  SectionHeader,
  SegmentedRow,
  SettingsScreenLayout,
  StepperRow,
  ToggleRow,
  useSettingsStyles,
} from './SettingsControls';

const CALL_TIMEOUT_MS = 15_000;
const LOG_PAGE = 50;

type Config = {
  enabled: boolean;
  enabledAt: string | null;
  scope: 'all' | 'projects' | 'sessions';
  tier: 'heal' | 'decide' | 'everything';
  limits: Record<string, boolean>;
  answerQuestions: boolean;
  answerAfterMinutes: number;
  answerApprovals: boolean;
  supervisor: 'opusMedium' | 'solHigh';
  sweepSeconds: number;
};

type LogEntry = {
  at: string;
  projectId: string;
  sessionId: string;
  title: string;
  project: string;
  saw: string;
  did: string;
  rule: string;
  outcome: 'done' | 'failed' | 'parked';
};

type View_ = {
  config: Config;
  projects: { projectId: string; name: string; path?: string; in: boolean }[];
  sessions: { projectId: string; sessionId: string; title: string; project: string; on: boolean }[];
  summary: { actions: number; keptMoving: number; parkedCount: number; failed: number };
  log: LogEntry[];
  watching: { covered: number };
};

/** The hard limits, as the desktop page lists them. */
const HARD_LIMITS: readonly { key: string; label: string; detail: string }[] = [
  {
    key: 'pushBranch',
    label: 'Push a branch',
    detail: 'Push work to a branch other than main. Nothing reaches your users.',
  },
  {
    key: 'finishRelease',
    label: 'Finish a release you asked for',
    detail: 'Retry its failed jobs, push and publish it. It never starts one.',
  },
  { key: 'pushMain', label: 'Push main', detail: "Other sessions' local commits could go with it." },
  { key: 'merge', label: 'Merge pull requests', detail: 'Merge a pull request on GitHub.' },
  {
    key: 'deleteOutsideProject',
    label: 'Delete outside the project',
    detail: 'Delete files outside the project and its work folders.',
  },
  { key: 'postPublicly', label: 'Post publicly', detail: 'Post on Discord or X, comment on GitHub, or send email.' },
];

async function call(
  machine: MachineRecord,
  params: Record<string, unknown>,
): Promise<{ view: View_ | null; error: string | null }> {
  try {
    const answer = await chatMachineLink(machine).rpc('autopilot', params, CALL_TIMEOUT_MS);
    if (answer.error !== null) {
      const unknown = /unknown|not a gxserver|no gxserver endpoint/i.test(answer.error.message);
      return {
        view: null,
        error: unknown ? 'Update Ghostex on this computer to use Autopilot from your phone.' : answer.error.message,
      };
    }
    return { view: answer.result as View_, error: null };
  } catch (error) {
    return { view: null, error: error instanceof Error ? error.message : "Couldn't reach Ghostex on your computer." };
  }
}

/** "14:02" today, "Mon 14:02" this week, else the date. */
function when(at: string | null | undefined): string {
  if (!at) return 'now';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return 'now';
  const now = new Date();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (date.toDateString() === now.toDateString()) return time;
  if (now.getTime() - date.getTime() < 6 * 24 * 3600_000)
    return `${date.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

export default function AutopilotPage() {
  const all = useMachinesStore((state) => state.machines);
  const selectedId = useMachinesStore((state) => state.selectedMachineId);
  const machines = useMemo(() => all.filter(isMachineEnabled), [all]);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const machine =
    machines.find((entry) => entry.id === pickedId) ??
    machines.find((entry) => entry.id === selectedId) ??
    machines[0] ??
    null;
  const [view, setView] = useState<View_ | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logLimit, setLogLimit] = useState(LOG_PAGE);

  const send = useCallback(
    async (params: Record<string, unknown>) => {
      if (machine === null) return;
      const answer = await call(machine, { ...params, limit: logLimit });
      if (answer.view !== null) {
        setView(answer.view);
        setError(null);
      } else {
        setError(answer.error);
        // A refused change: read what the computer has.
        if (params.op !== 'read')
          void call(machine, { op: 'read', limit: logLimit }).then((read) => read.view && setView(read.view));
      }
    },
    [machine, logLimit],
  );

  useEffect(() => {
    setView(null);
    void send({ op: 'read' });
    const timer = setInterval(() => void send({ op: 'read' }), 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machine?.id, logLimit]);

  if (machine === null)
    return (
      <SettingsScreenLayout>
        <Caption>Connect a computer first: Autopilot runs on your computer.</Caption>
      </SettingsScreenLayout>
    );

  /** Changes some choices: on screen at once, then saved. */
  const set = (patch: Partial<Config>) => {
    if (view !== null)
      setView({
        ...view,
        config: { ...view.config, ...patch, limits: { ...view.config.limits, ...(patch.limits ?? {}) } },
      });
    void send({ op: 'set', patch });
  };

  return (
    <SettingsScreenLayout intro="Keeps your sessions going while you are away, on the computer below, until you turn it off.">
      {machines.length > 1 ? (
        <SettingsSection name="settings:autopilot:computer">
          <SectionHeader title="Computer" />
          {machines.map((entry) => (
            <ChoiceRow
              key={entry.id}
              label={machineDisplayLabel(entry)}
              selected={entry.id === machine.id}
              onPress={() => setPickedId(entry.id)}
            />
          ))}
        </SettingsSection>
      ) : null}
      {error !== null ? <Caption>{error}</Caption> : null}
      {view === null ? (
        error === null ? (
          <Caption>Reading Autopilot…</Caption>
        ) : (
          <LinkRow title="Try again" onPress={() => void send({ op: 'read' })} />
        )
      ) : (
        <AutopilotBody
          view={view}
          set={set}
          send={send}
          onMore={() => setLogLimit((limit) => limit + LOG_PAGE)}
          logLimit={logLimit}
        />
      )}
    </SettingsScreenLayout>
  );
}

function AutopilotBody({
  view,
  set,
  send,
  onMore,
  logLimit,
}: {
  view: View_;
  set: (patch: Partial<Config>) => void;
  send: (params: Record<string, unknown>) => Promise<void>;
  onMore: () => void;
  logLimit: number;
}) {
  const { config } = view;
  const minutes = Math.round(config.sweepSeconds / 60);
  const nameCount = (name: string) =>
    view.projects.filter((project) => project.name.toLowerCase() === name.toLowerCase()).length;
  return (
    <>
      <SettingsSection name="settings:autopilot:switch">
        <SectionHeader title="Autopilot" />
        <ToggleRow
          label="Autopilot"
          detail={
            config.enabled
              ? `On since ${when(config.enabledAt)}, keeping ${view.watching.covered === 1 ? '1 session' : `${view.watching.covered} sessions`} going.`
              : 'Carries on stopped sessions, interrupts hung commands, reloads frozen ones, switches account at a limit.'
          }
          value={config.enabled}
          onValueChange={(enabled) => set({ enabled })}
        />
        <SegmentedRow
          label="Which sessions"
          options={[
            { value: 'all', label: 'Every session' },
            { value: 'projects', label: 'Projects I pick' },
            { value: 'sessions', label: 'Sessions I pick' },
          ]}
          value={config.scope}
          onChange={(scope) => set({ scope })}
        />
        {config.scope === 'projects'
          ? view.projects.map((project) => (
              <ToggleRow
                key={project.projectId}
                label={project.name}
                detail={nameCount(project.name) > 1 ? project.path : undefined}
                value={project.in}
                onValueChange={(on) => void send({ op: 'setProject', projectId: project.projectId, on })}
              />
            ))
          : null}
        {config.scope === 'sessions'
          ? view.sessions.map((session) => (
              <ToggleRow
                key={`${session.projectId}:${session.sessionId}`}
                label={session.title}
                detail={session.project}
                value={session.on}
                onValueChange={(on) =>
                  void send({ op: 'setSession', projectId: session.projectId, sessionId: session.sessionId, on })
                }
              />
            ))
          : null}
        {config.scope === 'sessions' && view.sessions.length === 0 ? (
          <Caption>Put a session in with the Autopilot pill in its chat.</Caption>
        ) : null}
      </SettingsSection>
      {config.enabled || view.log.length > 0 ? <Summary view={view} /> : null}
      <SettingsSection name="settings:autopilot:allowed">
        <SectionHeader title="What it may do" />
        <SegmentedRow
          label="On its own"
          options={[
            { value: 'heal', label: 'Heal' },
            { value: 'decide', label: 'Heal and decide' },
            { value: 'everything', label: 'Everything' },
          ]}
          value={config.tier}
          onChange={(tier) => set({ tier })}
        />
        <ToggleRow
          label="Answer questions for me"
          detail="When you don't answer in time, it picks each question's recommended choice."
          value={config.answerQuestions}
          onValueChange={(answerQuestions) => set({ answerQuestions })}
        />
        {config.answerQuestions ? (
          <SegmentedRow
            label="Wait for me first"
            options={[
              { value: '5', label: '5 min' },
              { value: '10', label: '10 min' },
              { value: '15', label: '15 min' },
            ]}
            value={String(config.answerAfterMinutes) as '5' | '10' | '15'}
            onChange={(wait) => set({ answerAfterMinutes: Number(wait) })}
          />
        ) : null}
        <ToggleRow
          label="Answer approval cards"
          detail="Permission prompts, Connectors cards and folder trust. While this is off, only you answer them."
          value={config.answerApprovals}
          onValueChange={(answerApprovals) => set({ answerApprovals })}
        />
      </SettingsSection>
      <SettingsSection name="settings:autopilot:limits">
        <SectionHeader title="Hard limits it may cross" />
        {HARD_LIMITS.map((limit) => (
          <ToggleRow
            key={limit.key}
            label={limit.label}
            detail={limit.detail}
            value={config.limits[limit.key] === true}
            onValueChange={(on) => set({ limits: { [limit.key]: on } })}
          />
        ))}
        <Caption>
          Signing in, 2FA, identity checks and payments are never done: Autopilot leaves them for you with a note.
        </Caption>
      </SettingsSection>
      <SettingsSection name="settings:autopilot:supervisor">
        <SectionHeader title="Supervisor" />
        <ChoiceRow
          label="Claude Opus 5.5 · Medium"
          selected={config.supervisor === 'opusMedium'}
          onPress={() => set({ supervisor: 'opusMedium' })}
        />
        <ChoiceRow
          label="Codex GPT 6.1 Sol · High"
          selected={config.supervisor === 'solHigh'}
          onPress={() => set({ supervisor: 'solHigh' })}
        />
        <StepperRow
          label={`Look at every session every ${minutes} min`}
          value={`${minutes}`}
          canDecrease={minutes > 1}
          canIncrease={minutes < 10}
          onStep={(delta) => set({ sweepSeconds: (minutes + delta) * 60 })}
        />
      </SettingsSection>
      <Log view={view} onMore={onMore} logLimit={logLimit} />
    </>
  );
}

function Summary({ view }: { view: View_ }) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const tiles: [number, string][] = [
    [view.summary.actions, 'Actions'],
    [view.summary.keptMoving, 'Kept moving'],
    [view.summary.parkedCount, 'Left for you'],
    [view.summary.failed, 'Failed'],
  ];
  return (
    <SettingsSection name="settings:autopilot:summary">
      <SectionHeader title="Summary" />
      <View style={[styles.row, { flexDirection: 'row', justifyContent: 'space-between' }]}>
        {tiles.map(([value, label]) => (
          <View key={label} style={{ alignItems: 'center', flex: 1 }}>
            <Text style={[styles.linkTitle, { fontSize: 20 }]}>{value}</Text>
            <Text style={[styles.linkDescription, { color: appearance.muted }]}>{label}</Text>
          </View>
        ))}
      </View>
    </SettingsSection>
  );
}

function Log({ view, onMore, logLimit }: { view: View_; onMore: () => void; logLimit: number }) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <SettingsSection name="settings:autopilot:log">
      <SectionHeader title="Log" />
      <Caption>Kept 30 days.</Caption>
      {view.log.length === 0 ? (
        <Caption>Nothing yet. Each time Autopilot acts on a session, or leaves one for you, it shows here.</Caption>
      ) : null}
      {view.log.map((entry, index) => (
        <View key={`${entry.at}-${index}`} style={styles.row}>
          <View style={styles.linkText}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: entry.outcome === 'done' ? '#22c55e' : '#f59e0b',
                }}
              />
              <Text style={styles.linkTitle}>{entry.title.length > 0 ? entry.title : 'A session'}</Text>
            </View>
            <Text style={[styles.linkDescription, { color: appearance.muted }]}>{entry.saw}</Text>
            <Text style={styles.linkDescription}>{entry.did}</Text>
            <Text style={[styles.linkDescription, { color: appearance.muted }]}>
              {entry.project} · {when(entry.at)}
            </Text>
          </View>
        </View>
      ))}
      {view.log.length >= logLimit ? <LinkRow title="Show more" onPress={onMore} /> : null}
    </SettingsSection>
  );
}
