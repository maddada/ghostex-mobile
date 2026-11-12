/**
 * The usage of a computer's Claude and Codex accounts, in a usage pane and full screen: the chat
 * Accounts panel's head ("Accounts & limits" and Refresh) and, per saved account, its logo, name and email over its
 * meters, three to a line as the panel draws them (`usageLines`): the window's name and percent over a thin bar and
 * "↻" with the time to its reset. A login without usage says "Usage is unavailable for this login." instead of bars
 * (no bar at 0 %); what the computer says about reading it stands above (the panel's `usageError`).
 *
 * The usage is read when the view opens, again every 30 seconds while it stays open (the chat's accounts poll; the
 * computer answers from its last reading while that is under two minutes old) and on Refresh, which asks for a fresh
 * reading. One read at a time: while an answer is out (a computer may take up to a minute), the next poll waits for it
 * rather than replacing it, so a slow answer and a failure show when they come. A read that fails keeps what was shown
 * and says why above it. Open means mounted: in a pane while the terminal screen shows the panes (also under a screen
 * opened over it), full screen while the Usage screen is open.
 *
 * In a pane its rows keep off a book fold (`controlInset`) and it reaches no side bar; full screen it reaches under
 * the side bar and, half folded like a laptop, ends above the fold with the lower half empty (`FoldListFrame`,
 * `foldGap.tsx`), as the Settings pages and the app's other scroll view pages do.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useAppearance, type Appearance } from '../theme/useAppearance';

import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AGENT_ICONS } from '../assets/agentIcons.generated';
import { COMMAND_ICONS } from '../assets/tablerIcons.generated';
import { UsageRow } from '../chat/native/composer/AccountsPanel';

import { UNREACHABLE_MESSAGE } from '../chat/rust/machine-link';
import { FoldListFrame } from '../components/common/foldGap';
import { useLaptopFold } from '../components/common/verticalBar/laptopFold';
import { NO_BAR_INSETS } from '../components/common/verticalBar/layout';
import { useScrollToBarEdges } from '../components/common/verticalBar/VerticalBarArea';
import { agentIconTint } from '../contract/mobileSummary';
import { UsageCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import type { PaneBarInset } from '../panes/geometry';
import { machineTargetFor } from '../screens/terminal-screen/session-lookups';
import { GhostexRadii } from '../theme/palette';

import { readAccountUsage } from './client';
import type { UsageAccount } from './usageMeters';

/** How often the usage is read again while the view is open: the chat Accounts panel's poll. */
const READ_EVERY_MS = 30_000;
const PADDING = 12;

export type UsagePlacement = { kind: 'pane'; controlInset: PaneBarInset } | { kind: 'screen' };

type Reading = {
  /** Null until the first answer. */
  readonly accounts: readonly UsageAccount[] | null;
  /** The last read's failure, in the computer's or the route's words. */
  readonly error: string | null;
  readonly busy: boolean;
};

export default function UsageView({ machineId, placement }: { machineId: string; placement: UsagePlacement }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const record = useMachinesStore((state) => state.machines.find((machine) => machine.id === machineId) ?? null);
  const computer = record === null ? machineId : machineDisplayLabel(record);
  const known = record !== null;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [reading, setReading] = useState<Reading>({ accounts: null, error: null, busy: known });
  // Only a read of this view's current computer may change what is shown; none after the view is gone.
  const latest = useRef(0);
  // An answer is out: a poll meanwhile starts no other read.
  const answerOut = useRef(false);

  const read = useCallback(
    (refresh: boolean) => {
      const machine = machineTargetFor(machineId);
      if (machine === null || answerOut.current) return;
      latest.current += 1;
      const ticket = latest.current;
      answerOut.current = true;
      setReading((current) => ({ ...current, busy: true }));
      readAccountUsage(machine, refresh).then(
        (accounts) => {
          if (ticket !== latest.current) return;
          answerOut.current = false;
          setReading({ accounts, error: null, busy: false });
        },
        (error: unknown) => {
          if (ticket !== latest.current) return;
          answerOut.current = false;
          const message = error instanceof Error ? error.message : String(error);
          setReading((current) => ({ accounts: current.accounts, error: message, busy: false }));
        },
      );
    },
    [machineId],
  );

  useEffect(() => {
    read(false);
    const timer = setInterval(() => read(false), READ_EVERY_MS);
    return () => {
      clearInterval(timer);
      // The computer changed or the view is gone: the answer out is not this view's any more.
      latest.current += 1;
      answerOut.current = false;
    };
  }, [read]);

  const inPane = placement.kind === 'pane';
  const laptopFold = useLaptopFold();
  const edges = useScrollToBarEdges(styles.content, inPane ? NO_BAR_INSETS : null);
  const inset = inPane ? placement.controlInset : NO_BAR_INSETS;
  const error = known ? reading.error : UNREACHABLE_MESSAGE;
  const { accounts, busy } = reading;

  return (
    <FoldListFrame fold={inPane ? null : laptopFold}>
      <ScrollView
        style={[styles.scroll, edges.scroll]}
        contentContainerStyle={[
          styles.content,
          edges.content,
          inPane && { paddingLeft: PADDING + inset.left, paddingRight: PADDING + inset.right },
        ]}
      >
        <View style={styles.head}>
          <Text style={styles.headTitle} accessibilityRole="header">
            {UsageCopy.head}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={UsageCopy.refresh}
            accessibilityState={{ busy, disabled: busy || !known }}
            disabled={busy || !known}
            hitSlop={4}
            onPress={() => read(true)}
            style={({ pressed }) => [styles.refresh, pressed && styles.pressed, (busy || !known) && styles.dim]}
          >
            <COMMAND_ICONS.refresh size={17} color={appearance.foreground} />
          </Pressable>
        </View>
        {error !== null ? (
          <View accessibilityRole="alert" style={styles.alert}>
            <Text style={styles.paragraph}>{error}</Text>
          </View>
        ) : null}
        {accounts === null && error === null ? (
          <View style={styles.pending}>
            <ActivityIndicator size="small" color={appearance.muted} accessibilityLabel={UsageCopy.loading} />
          </View>
        ) : null}
        {accounts !== null && accounts.length === 0 ? (
          <Text style={styles.paragraph}>{UsageCopy.noAccounts(computer)}</Text>
        ) : null}
        {accounts?.map((account) => (
          <AccountSection key={`${account.provider}:${account.id}`} account={account} />
        ))}
        {known ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('Accounts', { machineId })}
            style={({ pressed }) => [styles.manage, pressed && styles.pressed]}
          >
            <Text style={styles.manageLabel}>{UsageCopy.manageAccounts}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </FoldListFrame>
  );
}

function AccountSection({ account }: { account: UsageAccount }) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const meterAppearance = useMemo(() => ({
    foreground: appearance.foreground, muted: appearance.muted, meterTrack: appearance.control, meterFill: appearance.accent,
  }), [appearance]);
  const Icon = AGENT_ICONS[account.provider];
  return (
    <View style={styles.account}>
      <View style={styles.nameLine}>
        {Icon !== undefined ? <Icon size={16} color={agentIconTint(account.provider)} /> : null}
        <Text style={styles.name} numberOfLines={1}>
          {account.name}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {account.email}
        </Text>
      </View>
      {account.usageError.length > 0 ? <Text style={styles.paragraph}>{account.usageError}</Text> : null}
      {account.unavailable ? (
        <Text style={styles.paragraph}>{UsageCopy.unavailable}</Text>
      ) : (
        <UsageRow columns={account.meters} resets appearance={meterAppearance} />
      )}
    </View>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: appearance.background },
  content: { padding: PADDING, gap: 12, paddingBottom: 28 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingLeft: 4 },
  headTitle: { color: appearance.foreground, fontSize: 16, fontWeight: '600' },
  refresh: { width: 44, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: appearance.cardActive },
  dim: { opacity: 0.45 },
  alert: {
    padding: 12,
    borderRadius: GhostexRadii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appearance.border,
  },
  pending: { alignItems: 'center', paddingVertical: 16 },
  paragraph: { color: appearance.muted, fontSize: 13, lineHeight: 18 },
  account: { gap: 10, padding: 12, borderRadius: GhostexRadii.section, backgroundColor: appearance.card },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  name: { color: appearance.foreground, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  email: { flex: 1, minWidth: 0, color: appearance.muted, fontSize: 12 },
  manage: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: GhostexRadii.control, backgroundColor: appearance.neutralFill },
  manageLabel: { color: appearance.foreground, fontSize: 13, fontWeight: '600' },
});
