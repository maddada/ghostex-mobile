/**
 * Settings › Collab (Ghostex Collab), for one computer. Collab is an extension since 11.0.1
 * (#495): until it is installed on that computer the page offers only Install (the computer
 * downloads the Collab component once the owner approves); once installed, your name, what a new
 * share starts with, the chats shared now with Stop sharing, the guest messages log, and
 * Uninstall. Read and saved through that computer's `/api/collab` (forwarded to the Collab
 * component, server/collab/src/owner.rs) and `/api/extensionComponents`; a change shows at once.
 * The desktop's pages are `settings_modal/tabs/collab.rs` and the Collab card of Extensions.
 *
 * CDXC:Collab 2026-11-07 DECISION: User (Q1610, Q1616): "a page in settings called "Collab"", and the phone is "full (share, approve messages, Stop sharing, see viewers)".
 *
 * CDXC:Collab 2026-11-08 DECISION: User (#495): a link lasts an hour by default and a day at most,
 * a code is always asked, and Send is never a default: it is turned on per chat, in its Share
 * sheet, with approval.
 *
 * CDXC:Collab 2026-11-08 DECISION: User (#495, Q1730): installing Collab needs the owner's signed
 * approval (`collabCall` waits for it); there is no on/off switch any more, and uninstalling never
 * asks. The phone's Settings list several computers, so this page stays listed and says when
 * Collab isn't installed on the one picked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { collabCall } from '../../chat/native/cards/collabCall';
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
  useSettingsStyles,
} from './SettingsControls';

type Config = {
  expiry: 'hour' | 'fourHours' | 'day' | 'untilStopped';
  mode: 'approve' | 'view';
  ownerName: string;
  ownerDisplayName: string;
};

type Share_ = {
  shareId: string;
  title: string;
  expiresAtMs: number | null;
  viewers: { id: string; name: string }[];
};

type Component = {
  installed: boolean;
  version?: string | null;
  canInstall?: boolean;
  phase?: 'idle' | 'downloading' | 'installing' | 'removing' | 'failed';
  doneBytes?: number | null;
  totalBytes?: number | null;
  error?: string | null;
};

/** Installed: `config`, `shares`, …; not installed (or stopped): `installed: false` and `component`. */
type View_ = {
  installed?: boolean;
  component?: Component;
  config?: Config;
  shares?: Share_[];
  guestPage?: { message?: string | null };
  version?: string;
};

type LogEntry = {
  atMs: number;
  title: string;
  event: 'joined' | 'left' | 'removed' | 'message';
  guest: string;
  text?: string;
  images?: number;
  outcome?: string;
};

async function call(
  machine: MachineRecord,
  params: Record<string, unknown>,
  onWaiting?: (summary: string | null) => void,
  endpoint: 'collab' | 'extensionComponents' = 'collab',
): Promise<{ result: Record<string, unknown> | null; error: string | null }> {
  return collabCall(machine, params, onWaiting, undefined, endpoint);
}

function installStatus(component: Component | undefined): string {
  if (component === undefined) return "Collab isn't installed on this computer.";
  switch (component.phase) {
    case 'downloading': {
      const done = component.doneBytes ?? 0;
      const total = component.totalBytes ?? 0;
      return total > 0
        ? `Downloading Collab… ${Math.floor((done / total) * 100)}% of ${Math.round(total / 1_000_000)} MB`
        : 'Downloading Collab…';
    }
    case 'installing':
      return 'Installing Collab…';
    case 'removing':
      return 'Uninstalling Collab…';
    case 'failed':
      return `Couldn't install Collab. ${component.error ?? ''}`;
    default:
      if (component.installed) return 'Collab is installed and starting…';
      if (component.canInstall === false) return "This computer's Ghostex has no Collab component to install.";
      return "Collab isn't installed on this computer. Installing it downloads the Collab component and asks for your approval.";
  }
}

function ago(atMs: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - atMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / 1440)} days ago`;
}

function ends(at: number | null): string {
  const minutes = Math.max(0, Math.round(((at ?? 0) - Date.now()) / 60_000));
  if (minutes < 60) return `ends in ${minutes} min`;
  return `ends in ${Math.round(minutes / 60)} h`;
}

const OUTCOMES: Record<string, string> = {
  sent: 'Went straight to the agent',
  held: 'Waited for you',
  approved: 'You sent it',
  edited: 'You edited it',
  declined: 'You declined it',
  refused: 'Not accepted',
};

export default function CollabPage() {
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
  const [log, setLog] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);

  const send = useCallback(
    async (params: Record<string, unknown>) => {
      if (machine === null) return;
      const answer = await call(machine, params, params.op === 'read' ? undefined : setWaiting);
      if (answer.result !== null) {
        setView(answer.result as unknown as View_);
        setError(null);
      } else {
        setError(answer.error);
      }
    },
    [machine],
  );
  const readLog = useCallback(async () => {
    if (machine === null) return;
    const answer = await call(machine, { op: 'audit', limit: 30 });
    if (answer.result !== null) setLog((answer.result.entries as LogEntry[] | undefined) ?? []);
  }, [machine]);

  useEffect(() => {
    setView(null);
    void send({ op: 'read' });
    void readLog();
    const timer = setInterval(() => {
      void send({ op: 'read' });
      void readLog();
    }, 10_000);
    return () => clearInterval(timer);
  }, [send, readLog]);

  if (machine === null)
    return (
      <SettingsScreenLayout>
        <Caption>Connect a computer first: Ghostex Collab shares chats from your computer.</Caption>
      </SettingsScreenLayout>
    );

  const set = (patch: Partial<Config>) => {
    if (view?.config) setView({ ...view, config: { ...view.config, ...patch } });
    void send({ op: 'set', patch });
  };
  const component = async (op: 'install' | 'uninstall') => {
    const answer = await call(machine, { op, name: 'collab' }, setWaiting, 'extensionComponents');
    if (answer.result === null) setError(answer.error);
    else setError(null);
    void send({ op: 'read' });
  };

  return (
    <SettingsScreenLayout intro="Share a chat through a link that opens it in any browser. Share is the pill above a chat's chat box.">
      {machines.length > 1 ? (
        <SettingsSection name="settings:collab:computer">
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
      {waiting !== null ? <Caption>{`Approve on your computer or this phone: ${waiting}.`}</Caption> : null}
      {error !== null ? <Caption>{error}</Caption> : null}
      {view?.guestPage?.message ? <Caption>{view.guestPage.message}</Caption> : null}
      {view === null ? (
        error === null ? (
          <Caption>Reading Ghostex Collab…</Caption>
        ) : (
          <LinkRow title="Try again" onPress={() => void send({ op: 'read' })} />
        )
      ) : view.installed === false || view.config === undefined ? (
        <SettingsSection name="settings:collab:install">
          <SectionHeader title="Collab (extension)" />
          <Caption>{installStatus(view.component)}</Caption>
          {view.component?.installed !== true && view.component?.canInstall !== false && waiting === null ? (
            <LinkRow title="Install Collab" onPress={() => void component('install')} />
          ) : null}
        </SettingsSection>
      ) : (
        <CollabBody
          view={view}
          config={view.config}
          log={log}
          set={set}
          send={send}
          uninstall={() => void component('uninstall')}
        />
      )}
    </SettingsScreenLayout>
  );
}

function CollabBody({
  view,
  config,
  log,
  set,
  send,
  uninstall,
}: {
  view: View_;
  config: Config;
  log: LogEntry[];
  set: (patch: Partial<Config>) => void;
  send: (params: Record<string, unknown>) => Promise<void>;
  uninstall: () => void;
}) {
  const shares = view.shares ?? [];
  return (
    <>
      <SettingsSection name="settings:collab:switch">
        <SectionHeader title="Ghostex Collab" />
        <LinkRow
          title="Uninstall Collab"
          description={`Installed${view.version ? ` (${view.version})` : ''}. Each share needs your approval. Uninstalling ends every share at once and removes Collab from this computer.`}
          onPress={uninstall}
        />
        <NameRow
          value={config.ownerName}
          placeholder={config.ownerDisplayName}
          onSave={(ownerName) => set({ ownerName })}
        />
      </SettingsSection>
      <SettingsSection name="settings:collab:newShares">
        <SectionHeader title="New shares start with" />
        <SegmentedRow
          label="Guest messages"
          options={[
            { value: 'approve', label: 'Ask me' },
            { value: 'view', label: 'View only' },
          ]}
          value={config.mode}
          onChange={(mode) => set({ mode })}
        />
        <SegmentedRow
          label="Link ends after"
          options={[
            { value: 'hour', label: '1 hour' },
            { value: 'fourHours', label: '4 hours' },
            { value: 'day', label: '24 hours' },
            { value: 'untilStopped', label: 'Until I stop it' },
          ]}
          value={config.expiry}
          onChange={(expiry) => set({ expiry })}
        />
        <Caption>
          Until I stop it keeps a link live until you stop sharing or delete the chat. Guests always type the
          eight-digit code that comes with the link, and you get a notification when one joins. Send straight to the
          agent is turned on per chat, in its Share sheet.
        </Caption>
      </SettingsSection>
      {
        <SettingsSection name="settings:collab:shared">
          <SectionHeader title="Shared now" />
          {shares.length === 0 ? <Caption>No chat is shared right now.</Caption> : null}
          {shares.map((share) => (
            <LinkRow
              key={share.shareId}
              title={share.title}
              description={`${share.viewers.length} watching · link ${ends(share.expiresAtMs)} · Tap to stop sharing`}
              onPress={() => void send({ op: 'stop', shareId: share.shareId })}
            />
          ))}
          {shares.length > 1 ? <LinkRow title="Stop all" onPress={() => void send({ op: 'stopAll' })} /> : null}
        </SettingsSection>
      }
      <SettingsSection name="settings:collab:log">
        <SectionHeader title="Guest messages log" />
        {log.length === 0 ? (
          <Caption>Nothing yet. Every guest message and what you did with it shows here.</Caption>
        ) : null}
        {log.map((entry, index) => (
          <LogRow key={`${entry.atMs}-${index}`} entry={entry} />
        ))}
      </SettingsSection>
    </>
  );
}

function NameRow({
  value,
  placeholder,
  onSave,
}: {
  value: string;
  placeholder: string;
  onSave: (name: string) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setText(value), [value]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 6 }}>
        <Text style={styles.rowLabel}>Your name</Text>
        <TextInput
          accessibilityLabel="Your name"
          value={text}
          placeholder={placeholder}
          placeholderTextColor={appearance.muted}
          maxLength={40}
          autoCorrect={false}
          style={{ color: appearance.foreground, fontSize: 15, paddingVertical: 4 }}
          onChangeText={(next) => {
            setText(next);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => onSave(next), 700);
          }}
        />
        <Caption>What guests see for you. Empty uses this computer's user name.</Caption>
      </View>
    </View>
  );
}

function LogRow({ entry }: { entry: LogEntry }) {
  const styles = useSettingsStyles();
  const what =
    entry.event === 'message'
      ? (OUTCOMES[entry.outcome ?? ''] ?? 'Not accepted')
      : entry.event === 'joined'
        ? 'Joined'
        : entry.event === 'left'
          ? 'Left'
          : 'Removed and blocked';
  const title =
    entry.event === 'message'
      ? `${entry.guest}: ${entry.text && entry.text.length > 0 ? entry.text : `${entry.images ?? 0} picture(s)`}`
      : `${entry.guest} ${entry.event === 'removed' ? 'was removed' : entry.event}`;
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel} numberOfLines={2}>
          {title}
        </Text>
        <Caption>{`${what} · ${entry.title} · ${ago(entry.atMs)}`}</Caption>
      </View>
    </View>
  );
}
