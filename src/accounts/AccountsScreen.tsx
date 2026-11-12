/**
 * Accounts: one computer's saved Claude and Codex accounts, picked at the top, with their usage and their sign-ins.
 * Reconnect and Add account start a sign-in on that computer (src/accounts/client.ts); this screen shows its page
 * link (opened in the phone's browser once it appears), the code box Claude asks for, Codex's one-time code, and how
 * it ends. A computer that can't be reached says so plainly and offers nothing that would need it.
 *
 * Opened from the chat's Accounts & limits panel (Reconnect, Add account) on the session's own computer, with the
 * account to reconnect, and from a usage pane (Manage accounts) on its computer.
 */

import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AGENT_ICONS } from '../assets/agentIcons.generated';
import { UsageRow } from '../chat/native/composer/AccountsPanel';
import ActionSheet from '../components/common/ActionSheet';
import { agentIconTint } from '../contract/mobileSummary';
import { AccountsCopy } from '../copy';
import { isMachineEnabled, machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { machineTargetFor } from '../screens/terminal-screen/session-lookups';
import { GhostexRadii } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';

import {
  ACCOUNT_PROVIDERS,
  acknowledgeSignIn,
  asksForCode,
  cancelSignIn,
  readManagedAccounts,
  readSignIns,
  sendSignInCode,
  signInRunning,
  startSignIn,
  type AccountProvider,
  type ManagedAccount,
  type SignInJob,
} from './client';

/** How often a running sign-in is asked for its progress, as desktop Settings › Accounts does. */
const POLL_MS = 2_000;
/** The list is read again this often while the screen is open (the chat Accounts panel's poll). */
const READ_EVERY_MS = 30_000;

/** What the screen knows about the picked computer's accounts. */
export type AccountsReading =
  | { kind: 'loading' }
  | { kind: 'unreachable' }
  | { kind: 'failed'; message: string }
  | { kind: 'accounts'; accounts: readonly ManagedAccount[] };

type Props = NativeStackScreenProps<RootStackParamList, 'Accounts'>;

export default function AccountsScreen({ navigation, route }: Props) {
  const appearance = useAppearance();
  const all = useMachinesStore((state) => state.machines);
  const machines = useMemo(() => all.filter(isMachineEnabled), [all]);
  const [machineId, setMachineId] = useState(route.params.machineId);
  const reconnectId = useRef<string | null>(route.params.reconnectAccountId ?? null);
  const record = machines.find((machine) => machine.id === machineId) ?? null;
  const computer = record === null ? machineId : machineDisplayLabel(record);
  const [reading, setReading] = useState<AccountsReading>({ kind: 'loading' });
  const [job, setJob] = useState<SignInJob | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const ticket = useRef(0);
  const opened = useRef<string | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: AccountsCopy.title });
  }, [navigation]);

  const read = useCallback(
    (refresh: boolean) => {
      const machine = machineTargetFor(machineId);
      ticket.current += 1;
      const mine = ticket.current;
      if (machine === null) {
        setReading({ kind: 'unreachable' });
        return;
      }
      void readManagedAccounts(machine, refresh).then((answer) => {
        if (mine !== ticket.current) return;
        if (answer.ok) setReading({ kind: 'accounts', accounts: answer.value });
        else setReading(answer.unreachable ? { kind: 'unreachable' } : { kind: 'failed', message: answer.message });
      });
    },
    [machineId],
  );

  // A new computer: its accounts from the start, its own sign-in (one still running there is picked up).
  useEffect(() => {
    setReading({ kind: 'loading' });
    setJob(null);
    setJobError(null);
    read(false);
    const machine = machineTargetFor(machineId);
    if (machine !== null) {
      void readSignIns(machine).then((answer) => {
        if (!answer.ok) return;
        const running = answer.value.filter((entry) => signInRunning(entry) && !entry.acknowledged).at(-1);
        if (running !== undefined) setJob(running);
      });
    }
    const timer = setInterval(() => read(false), READ_EVERY_MS);
    return () => {
      clearInterval(timer);
      ticket.current += 1;
    };
  }, [machineId, read]);

  const start = useCallback(
    (provider: AccountProvider, accountId: string | null) => {
      const machine = machineTargetFor(machineId);
      if (machine === null) return;
      setJobError(null);
      void startSignIn(machine, provider, accountId).then((answer) => {
        if (!answer.ok) {
          if (answer.unreachable) setReading({ kind: 'unreachable' });
          else setJobError(answer.message);
          return;
        }
        setJob(answer.value.at(-1) ?? null);
      });
    },
    [machineId],
  );

  // Reconnect from the chat: once the accounts are read, that account's sign-in starts (only when it needs one).
  useEffect(() => {
    if (reconnectId.current === null || reading.kind !== 'accounts' || job !== null) return;
    const account = reading.accounts.find((entry) => entry.id === reconnectId.current);
    reconnectId.current = null;
    if (account?.needsSignIn) start(account.provider, account.id);
  }, [reading, job, start]);

  // A running sign-in: its progress every two seconds; its page opens in the phone's browser once it appears.
  const jobId = job?.id ?? null;
  const running = job !== null && signInRunning(job);
  useEffect(() => {
    if (jobId === null || !running) return undefined;
    const machine = machineTargetFor(machineId);
    if (machine === null) return undefined;
    const timer = setInterval(() => {
      void readSignIns(machine).then((answer) => {
        if (!answer.ok) return;
        const next = answer.value.find((entry) => entry.id === jobId);
        if (next === undefined) return;
        setJob(next);
        if (next.status === 'complete') read(true);
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [jobId, running, machineId, read]);
  useEffect(() => {
    if (job === null || job.url.length === 0 || opened.current === job.id || !signInRunning(job)) return;
    opened.current = job.id;
    void Linking.openURL(job.url).catch(() => undefined);
  }, [job]);

  const onSendCode = useCallback(
    (code: string) => {
      const machine = machineTargetFor(machineId);
      if (machine === null || job === null) return;
      void sendSignInCode(machine, job.id, code).then((answer) => {
        if (!answer.ok) setJobError(answer.message);
      });
    },
    [machineId, job],
  );
  const onCancel = useCallback(() => {
    const machine = machineTargetFor(machineId);
    if (machine === null || job === null) return;
    void cancelSignIn(machine, job.id);
    setJob(null);
  }, [machineId, job]);
  const onDone = useCallback(() => {
    const machine = machineTargetFor(machineId);
    if (machine !== null && job !== null) void acknowledgeSignIn(machine, job.id);
    setJob(null);
    read(false);
  }, [machineId, job, read]);

  // The switch's sheet says, for each computer, whether it answers and how many accounts it keeps.
  useEffect(() => {
    if (!picking) return undefined;
    let live = true;
    for (const machine of machines) {
      const target = machineTargetFor(machine.id);
      if (target === null) continue;
      void readManagedAccounts(target, false).then((answer) => {
        if (!live) return;
        setProbes((known) => ({
          ...known,
          [machine.id]: answer.ok ? AccountsCopy.reachable(answer.value.length) : AccountsCopy.cantReachShort,
        }));
      });
    }
    return () => {
      live = false;
    };
  }, [picking, machines]);
  // Computers that answer first, then the ones still asked, then the ones that couldn't be reached.
  const rank = (id: string) => (probes[id] === undefined ? 1 : probes[id] === AccountsCopy.cantReachShort ? 2 : 0);
  const sorted = [...machines].sort((a, b) => rank(a.id) - rank(b.id));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: appearance.background }} edges={['bottom']}>
      <AccountsBody
        computer={computer}
        canPick={machines.length > 1}
        onPick={() => setPicking(true)}
        reading={reading}
        job={job}
        jobError={jobError}
        onRetry={() => {
          setReading({ kind: 'loading' });
          read(true);
        }}
        onReconnect={(account) => start(account.provider, account.id)}
        onAdd={(provider) => start(provider, null)}
        onOpenPage={(url) => void Linking.openURL(url).catch(() => undefined)}
        onSendCode={onSendCode}
        onCancel={onCancel}
        onDone={onDone}
      />
      <ActionSheet
        visible={picking}
        title={AccountsCopy.pickComputer}
        subtitle={AccountsCopy.pickSubtitle}
        items={sorted.map((machine) => ({
          key: machine.id,
          label: `${machine.id === machineId ? '✓ ' : ''}${machineDisplayLabel(machine)}`,
          detail: probes[machine.id] ?? AccountsCopy.asking,
          onPress: () => {
            setPicking(false);
            reconnectId.current = null;
            setMachineId(machine.id);
          },
        }))}
        onClose={() => setPicking(false)}
      />
    </SafeAreaView>
  );
}

/** The screen's body as it draws one state: the computer switch, then the accounts or why they can't be shown. */
export function AccountsBody({
  computer,
  canPick,
  onPick,
  reading,
  job,
  jobError,
  onRetry,
  onReconnect,
  onAdd,
  onOpenPage,
  onSendCode,
  onCancel,
  onDone,
}: {
  computer: string;
  canPick: boolean;
  onPick: () => void;
  reading: AccountsReading;
  job: SignInJob | null;
  jobError: string | null;
  onRetry: () => void;
  onReconnect: (account: ManagedAccount) => void;
  onAdd: (provider: AccountProvider) => void;
  onOpenPage: (url: string) => void;
  onSendCode: (code: string) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const signingIn = job !== null && signInRunning(job);
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={AccountsCopy.computerLabel(computer)}
        accessibilityHint={canPick ? AccountsCopy.pickComputerHint : undefined}
        disabled={!canPick}
        onPress={onPick}
        style={({ pressed }) => [styles.computer, pressed && styles.pressed]}
      >
        <View style={styles.computerText}>
          <Text style={styles.computerTitle} numberOfLines={1}>
            {AccountsCopy.computerLabel(computer)}
          </Text>
          <Text style={styles.paragraph}>{AccountsCopy.computerDescription}</Text>
        </View>
        {canPick ? <Text style={styles.chevron}>⌄</Text> : null}
      </Pressable>

      {reading.kind === 'unreachable' ? (
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.body}>{AccountsCopy.unreachable(computer)}</Text>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={onRetry} style={styles.quietButton}>
            <Text style={styles.quietLabel}>{AccountsCopy.tryAgain}</Text>
          </Pressable>
        </View>
      ) : null}
      {reading.kind === 'failed' ? (
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.body}>{reading.message}</Text>
          <Pressable accessibilityRole="button" hitSlop={6} onPress={onRetry} style={styles.quietButton}>
            <Text style={styles.quietLabel}>{AccountsCopy.tryAgain}</Text>
          </Pressable>
        </View>
      ) : null}
      {reading.kind === 'loading' ? (
        <View style={styles.pending}>
          <ActivityIndicator size="small" color={appearance.muted} />
          <Text style={styles.paragraph}>{AccountsCopy.loading(computer)}</Text>
        </View>
      ) : null}

      {job !== null && reading.kind !== 'unreachable' ? (
        <SignInCard
          job={job}
          computer={computer}
          error={jobError}
          onOpenPage={onOpenPage}
          onSendCode={onSendCode}
          onCancel={onCancel}
          onDone={onDone}
        />
      ) : null}
      {job === null && jobError !== null ? <Text style={styles.paragraph}>{jobError}</Text> : null}

      {reading.kind === 'accounts' ? (
        <>
          {reading.accounts.length === 0 ? <Text style={styles.paragraph}>{AccountsCopy.noAccounts(computer)}</Text> : null}
          {reading.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              busy={signingIn}
              onReconnect={() => onReconnect(account)}
            />
          ))}
          <View style={styles.addRow}>
            {ACCOUNT_PROVIDERS.map((provider) => (
              <Pressable
                key={provider}
                accessibilityRole="button"
                disabled={signingIn}
                onPress={() => onAdd(provider)}
                style={({ pressed }) => [styles.neutralButton, pressed && styles.neutralPressed, signingIn && styles.dim]}
              >
                <Text style={styles.neutralLabel}>{AccountsCopy.addAccount(AccountsCopy.provider[provider])}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

function AccountRow({ account, busy, onReconnect }: { account: ManagedAccount; busy: boolean; onReconnect: () => void }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const meterAppearance = useMemo(
    () => ({
      foreground: appearance.foreground,
      muted: appearance.muted,
      meterTrack: appearance.control,
      meterFill: appearance.accent,
    }),
    [appearance],
  );
  const Icon = AGENT_ICONS[account.provider];
  return (
    <View style={[styles.account, account.disabled && styles.dim]}>
      <View style={styles.nameLine}>
        {Icon !== undefined ? <Icon size={16} color={agentIconTint(account.provider)} /> : null}
        <Text style={styles.name} numberOfLines={1}>
          {account.name}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {account.email}
        </Text>
        {account.needsSignIn ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${account.name} ${AccountsCopy.reconnect}`}
            disabled={busy}
            hitSlop={8}
            onPress={onReconnect}
            style={busy ? styles.dim : null}
          >
            <Text style={styles.action}>{AccountsCopy.reconnect}</Text>
          </Pressable>
        ) : null}
      </View>
      {account.disabled ? <Text style={styles.paragraph}>{AccountsCopy.turnedOff}</Text> : null}
      {!account.disabled && account.usageError.length > 0 ? (
        <Text style={styles.paragraph}>{account.usageError}</Text>
      ) : null}
      {!account.disabled && account.usageError.length === 0 && account.needsSignIn ? (
        <Text style={styles.paragraph}>{AccountsCopy.needsSignIn}</Text>
      ) : null}
      {!account.disabled && !account.needsSignIn && account.meters.length > 0 ? (
        <UsageRow columns={account.meters} resets appearance={meterAppearance} />
      ) : null}
    </View>
  );
}

function SignInCard({
  job,
  computer,
  error,
  onOpenPage,
  onSendCode,
  onCancel,
  onDone,
}: {
  job: SignInJob;
  computer: string;
  error: string | null;
  onOpenPage: (url: string) => void;
  onSendCode: (code: string) => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState(false);
  const running = signInRunning(job);
  const codex = job.userCode.length > 0;
  const askCode = running && !codex && asksForCode(job.output);
  return (
    <View style={styles.card}>
      <Text style={styles.strong}>{AccountsCopy.signingInOn(computer)}</Text>
      {job.status === 'signingIn' ? (
        <>
          <Text style={styles.paragraph}>{codex ? AccountsCopy.finishCodex : AccountsCopy.finishInBrowser}</Text>
          {job.url.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenPage(job.url)}
              style={({ pressed }) => [styles.neutralButton, pressed && styles.neutralPressed]}
            >
              <Text style={styles.neutralLabel}>{AccountsCopy.openPage}</Text>
            </Pressable>
          ) : (
            <Text style={styles.paragraph}>{AccountsCopy.waitingForPage}</Text>
          )}
          {codex ? (
            <View style={styles.codeBlock}>
              <Text style={styles.paragraph}>{AccountsCopy.codeLabel}</Text>
              <View style={styles.codeLine}>
                <Text style={styles.userCode} selectable accessibilityLabel={job.userCode.split('').join(' ')}>
                  {job.userCode}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => {
                    void Clipboard.setStringAsync(job.userCode).then(() => setCopied(true));
                  }}
                  style={({ pressed }) => [styles.neutralButton, pressed && styles.neutralPressed]}
                >
                  <Text style={styles.neutralLabel}>{copied ? AccountsCopy.copied : AccountsCopy.copy}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {askCode ? (
            <View style={styles.codeLine}>
              <TextInput
                value={code}
                onChangeText={setCode}
                placeholder={AccountsCopy.pasteCode}
                placeholderTextColor={appearance.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                disabled={code.trim().length === 0}
                onPress={() => {
                  onSendCode(code.trim());
                  setCode('');
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  pressed && styles.primaryPressed,
                  code.trim().length === 0 && styles.dim,
                ]}
              >
                <Text style={styles.primaryLabel}>{AccountsCopy.send}</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
      {job.status === 'saving' ? <Text style={styles.paragraph}>{AccountsCopy.saving}</Text> : null}
      {job.status === 'complete' ? <Text style={styles.body}>{AccountsCopy.connected}</Text> : null}
      {job.status === 'failed' ? (
        <Text style={styles.body}>{job.error.length > 0 ? job.error : AccountsCopy.failed}</Text>
      ) : null}
      {error !== null ? <Text style={styles.paragraph}>{error}</Text> : null}
      <View style={styles.actions}>
        {running ? (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={onCancel} style={styles.quietButton}>
            <Text style={styles.quietLabel}>{AccountsCopy.cancel}</Text>
          </Pressable>
        ) : (
          <Pressable accessibilityRole="button" hitSlop={6} onPress={onDone} style={styles.quietButton}>
            <Text style={styles.quietLabel}>{job.status === 'complete' ? AccountsCopy.done : AccountsCopy.close}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    scroll: { flex: 1, backgroundColor: appearance.background },
    content: { padding: 12, gap: 12, paddingBottom: 28 },
    computer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: GhostexRadii.section,
      backgroundColor: appearance.card,
    },
    computerText: { flex: 1, gap: 2 },
    computerTitle: { color: appearance.foreground, fontSize: 15, fontWeight: '600' },
    chevron: { color: appearance.muted, fontSize: 18 },
    pressed: { backgroundColor: appearance.cardActive },
    dim: { opacity: 0.45 },
    pending: { alignItems: 'center', gap: 8, paddingVertical: 16 },
    card: { gap: 10, padding: 12, borderRadius: GhostexRadii.section, backgroundColor: appearance.card },
    strong: { color: appearance.foreground, fontSize: 14, fontWeight: '600' },
    body: { color: appearance.foreground, fontSize: 13, lineHeight: 18 },
    paragraph: { color: appearance.muted, fontSize: 13, lineHeight: 18 },
    account: { gap: 10, padding: 12, borderRadius: GhostexRadii.section, backgroundColor: appearance.card },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
    name: { color: appearance.foreground, fontSize: 14, fontWeight: '600', flexShrink: 1 },
    email: { flex: 1, minWidth: 0, color: appearance.muted, fontSize: 12 },
    action: { color: appearance.foreground, fontSize: 13, fontWeight: '600' },
    addRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    neutralButton: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: GhostexRadii.control,
      backgroundColor: appearance.neutralFill,
    },
    neutralPressed: { backgroundColor: appearance.neutralFillPressed },
    neutralLabel: { color: appearance.foreground, fontSize: 13, fontWeight: '600' },
    primaryButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: GhostexRadii.control,
      backgroundColor: appearance.accent,
    },
    primaryPressed: { opacity: 0.8 },
    primaryLabel: { color: appearance.accentForeground, fontSize: 13, fontWeight: '600' },
    quietButton: { alignSelf: 'flex-start', paddingVertical: 4 },
    quietLabel: { color: appearance.muted, fontSize: 13, fontWeight: '600' },
    codeBlock: { gap: 6 },
    codeLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    userCode: {
      flex: 1,
      color: appearance.foreground,
      fontSize: 24,
      fontWeight: '700',
      letterSpacing: 2,
      fontVariant: ['tabular-nums'],
    },
    input: {
      flex: 1,
      minHeight: 36,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.input,
      backgroundColor: appearance.input,
      color: appearance.foreground,
      fontSize: 14,
    },
    actions: { flexDirection: 'row', gap: 12 },
  });
