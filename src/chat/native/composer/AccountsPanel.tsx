/**
 * The Accounts & limits panel (More actions > Switch Account), drawn from the document's
 * `accountPanel` the way desktop's `option_menu/accounts.rs` draws it: the current login with its
 * usage meters, the accounts the session can switch to, and the keep-going policy.
 *
 * CDXC:AgentProviders 2026-10-28 DECISION: User: "this menu is too huge please make it smaller".
 * Each account is a name line over one row of compact 5h / 7d / Fable columns. A phone has no hover,
 * so the current account's columns keep their reset countdown in small text under the bar; the
 * switch rows drop it to stay short.
 *
 * CDXC:AgentProviders 2026-10-31 DECISION: User marked up the panel: the current account says it is
 * active and shows its error on that row, with the action the Switch account rows use, and the
 * Context row and the "Switching resumes" sentence go.
 */

import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { SwitchRow } from '../../../components/common/SwitchRow';
import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import { UsageCopy } from '../../../copy';
import { currentProblem, usageColumns, usageLines, type UsageColumn } from './accountUsage';
import { Glyph } from './icons';
import { arr, isTrue, num, obj, str, type JsonRecord } from './json';
import { themedStyles, useTranscriptTheme, type TranscriptTheme } from '../transcript/theme';

type Run = (command: JsonRecord, keepOpen: boolean) => void;

function policyCommand(policy: unknown): JsonRecord {
  return { type: 'accounts', request: { operation: 'sessionPolicy', policy: policy ?? null } };
}

function withField(policy: JsonRecord | null, key: string, value: unknown): JsonRecord {
  return { ...(policy ?? {}), [key]: value };
}

export function AccountsPanel({ panel, onCommand }: { panel: JsonRecord; onCommand: Run }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [customize, setCustomize] = useState(false);
  if (str(panel, 'kind') === 'noAccounts') {
    return (
      <View style={styles.panel}>
        <Text style={styles.strong}>Current CLI login</Text>
        <Text style={styles.paragraph}>
          Add your account to see usage and reset times in Ghostex, even if you only use one account.
        </Text>
        <FilledButton label="Add account" onPress={() => onCommand({ type: 'openAccountsSettings' }, false)} />
      </View>
    );
  }
  const busy = isTrue(panel, 'busy');
  const error = str(panel, 'error');
  const message = str(panel, 'message');
  const session = obj(panel.session);
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Accounts & limits</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh accounts and usage"
          disabled={busy}
          hitSlop={8}
          onPress={() => onCommand({ type: 'accounts', request: { operation: 'session', refresh: true } }, true)}
          style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null, busy ? styles.dim : null]}
        >
          <Glyph name="refresh" size={17} color={P.foreground} />
        </Pressable>
      </View>
      {error.length > 0 ? (
        <View style={styles.alert} accessibilityRole="alert">
          <Text style={styles.paragraph}>{error}</Text>
        </View>
      ) : null}
      {message.length > 0 ? <Text style={styles.paragraph}>{message}</Text> : null}
      {message.length === 0 && session !== null ? (
        <SessionBlocks
          session={session}
          busy={busy}
          customize={customize}
          onCustomize={() => setCustomize(true)}
          onDefaults={() => {
            setCustomize(false);
            onCommand(policyCommand(null), true);
          }}
          onCommand={onCommand}
          otherUsage={null}
        />
      ) : null}
    </View>
  );
}

/**
 * The panel lists only the session agent's own accounts (gx-chat-core's CDXC:AgentProviders
 * 2026-11-06): usage-only accounts (Cursor, Gemini, Copilot) stay in the sidebar meters and
 * Settings > Accounts, never in a chat's account switcher.
 */
function SessionBlocks({
  session,
  busy,
  customize,
  onCustomize,
  onDefaults,
  onCommand,
  otherUsage,
}: {
  session: JsonRecord;
  busy: boolean;
  customize: boolean;
  onCustomize: () => void;
  onDefaults: () => void;
  onCommand: Run;
  /** The usage-only accounts, drawn under the session's own accounts. */
  otherUsage: ReactNode;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const recovery = obj(session.recovery);
  const usage = usageColumns(session.usage);
  const policyState = obj(session.policy);
  const policy = obj(policyState?.value);
  const custom = isTrue(policyState, 'custom');
  const showPolicy = customize || custom;
  const enabled = isTrue(policy, 'enabled');
  const dim = busy || !enabled;
  const atLimitSwitch = str(policy, 'atLimit') === 'switch';
  const problem = currentProblem(session);
  const email = str(session, 'email');
  return (
    <>
      {recovery !== null ? (
        <View style={styles.alert} accessibilityRole="summary">
          <Text style={styles.strong}>{str(recovery, 'reason')}</Text>
          {str(recovery, 'next').length > 0 ? <Text style={styles.paragraph}>{str(recovery, 'next')}</Text> : null}
          <FilledButton
            label="Stop automatic recovery"
            disabled={busy}
            onPress={() => onCommand({ type: 'accounts', request: { operation: 'stopRecovery' } }, true)}
          />
        </View>
      ) : null}
      <NameLine
        account={obj(session.current)}
        name={str(session, 'name')}
        email={email}
        active={str(session, 'activeLabel')}
      >
        {problem?.action !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={problem.action}
            hitSlop={8}
            onPress={() => onCommand({ type: 'openAccountsSettings', accountId: str(session, 'accountId') }, false)}
          >
            <Text style={styles.accountAction}>{problem.action}</Text>
          </Pressable>
        ) : null}
      </NameLine>
      {problem !== null ? <Text style={styles.paragraph}>{problem.message}</Text> : null}
      {usage.length > 0 ? (
        <UsageRow columns={usage} resets appearance={P} />
      ) : problem === null ? (
        <Text style={styles.paragraph}>Usage is unavailable for this login.</Text>
      ) : null}
      <Text style={styles.sectionHeading}>{str(session, 'switchHeading')}</Text>
      {arr(session.others).map((row, index) => {
        const ready = isTrue(row, 'ready');
        const rowError = str(row, 'usageError');
        const record = obj(row) ?? {};
        return (
          <Pressable
            key={`${index}:${str(row, 'id')}`}
            accessibilityRole="button"
            accessibilityLabel={`${str(row, 'name')} ${str(row, 'action')}`}
            disabled={busy}
            onPress={() =>
              onCommand(
                ready
                  ? { type: 'accounts', request: { operation: 'select', accountId: record.id ?? null } }
                  : { type: 'openAccountsSettings', accountId: record.id ?? null },
                false,
              )
            }
            style={({ pressed }) => [styles.account, pressed ? styles.pressed : null, busy ? styles.dim : null]}
          >
            <NameLine account={record} name={str(row, 'name')} email={str(row, 'email')}>
              <Text style={styles.accountAction}>{str(row, 'action')}</Text>
            </NameLine>
            {rowError.length > 0 ? (
              <Text style={styles.paragraph}>{rowError}</Text>
            ) : (
              <UsageRow columns={usageColumns(record.usage)} resets={false} appearance={P} />
            )}
          </Pressable>
        );
      })}
      {otherUsage}
      <View style={styles.divider} />
      <View style={styles.header}>
        <Text style={styles.strong}>Keep going at a limit</Text>
        {!showPolicy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Customize this session"
            onPress={onCustomize}
            style={({ pressed }) => [styles.customize, pressed ? styles.pressed : null]}
          >
            <Glyph name="adjustments-horizontal" size={15} color={P.muted} />
            <Text style={styles.paragraph}>Customize</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.paragraph}>{str(policyState, 'summary')}</Text>
      {showPolicy ? (
        <>
          <ToggleRow
            label="Continue automatically"
            value={enabled}
            disabled={busy}
            onChange={() => onCommand(policyCommand(withField(policy, 'enabled', !enabled)), true)}
          />
          <Text style={[styles.paragraph, dim ? styles.dim : null]}>When the session's account runs out</Text>
          <View style={[styles.segmented, dim ? styles.dim : null]}>
            {(
              [
                ['wait', 'Wait for reset', !atLimitSwitch],
                ['switch', 'Use another account', atLimitSwitch],
              ] as const
            ).map(([value, label, pressed]) => (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ selected: pressed, disabled: dim }}
                disabled={dim || pressed}
                onPress={() => onCommand(policyCommand(withField(policy, 'atLimit', value)), true)}
                style={[styles.segment, pressed ? styles.segmentPressed : null]}
              >
                <Text style={[styles.segmentText, pressed ? styles.segmentTextPressed : null]}>{label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={[styles.paragraph, dim ? styles.dim : null]}>{str(policyState, 'atLimitDescription')}</Text>
          {atLimitSwitch ? (
            <View style={[styles.priorities, dim ? styles.dim : null]}>
              <Text style={styles.paragraph}>Account preference</Text>
              {arr(policyState?.priorities).map((option, index) => {
                const selected = obj(option)?.value === policy?.priority;
                return (
                  <Pressable
                    key={index}
                    accessibilityRole="radio"
                    accessibilityState={{ selected, disabled: dim }}
                    disabled={dim}
                    onPress={() =>
                      onCommand(policyCommand(withField(policy, 'priority', obj(option)?.value ?? null)), true)
                    }
                    style={({ pressed }) => [styles.priority, pressed ? styles.pressed : null]}
                  >
                    <Text style={styles.accountName}>{str(option, 'label')}</Text>
                    {selected ? <Glyph name="check" size={16} color={P.foreground} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <ToggleRow
            label="Recover from temporary errors"
            value={isTrue(policy, 'retryErrors')}
            disabled={dim}
            onChange={() =>
              onCommand(policyCommand(withField(policy, 'retryErrors', !isTrue(policy, 'retryErrors'))), true)
            }
          />
          <Text style={[styles.paragraph, dim ? styles.dim : null]}>{str(policyState, 'retryDescription')}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onDefaults}
            style={({ pressed }) => [
              styles.customize,
              styles.filled,
              pressed ? styles.filledPressed : null,
              busy ? styles.dim : null,
            ]}
          >
            <Glyph name="arrow-back-up" size={15} color={P.foreground} />
            <Text style={styles.filledLabel}>Use session defaults</Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

/** The account's name line: logo, bold name, the muted email, then any trailing control. */
function NameLine({
  account,
  name,
  email,
  active = '',
  children,
}: {
  account: JsonRecord | null;
  name: string;
  email: string;
  /** The tag beside the current account's name. */
  active?: string;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const provider = str(account, 'provider') || 'claude';
  // Cursor's agent logo is keyed by its CLI.
  const Icon = account !== null ? AGENT_ICONS[provider === 'cursor' ? 'cursor-cli' : provider] : undefined;
  return (
    <View style={styles.nameLine}>
      {Icon !== undefined ? <Icon size={16} color={P.foreground} /> : null}
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {active.length > 0 ? (
        <View style={styles.activeTag}>
          <Text style={styles.activeTagText}>{active}</Text>
        </View>
      ) : null}
      {email.length > 0 ? (
        <Text style={[styles.email, styles.grow]} numberOfLines={1}>
          {email}
        </Text>
      ) : (
        <View style={styles.grow} />
      )}
      {children}
    </View>
  );
}

/** The account's limits: label and percent over a thin bar, three columns a line. */
export function UsageRow({
  columns,
  resets,
  appearance,
}: {
  columns: readonly UsageColumn[];
  resets: boolean;
  appearance: Pick<TranscriptTheme, 'foreground' | 'muted' | 'meterTrack' | 'meterFill'>;
}) {
  const styles = usageRowStyles;
  const lines = usageLines(columns);
  if (lines.length === 0) return null;
  return (
    <View style={styles.usage}>
      {lines.map((line, lineIndex) => (
        <View key={lineIndex} style={styles.usageLine}>
          {line.map((column, index) =>
            column === null ? (
              <View key={index} style={styles.column} />
            ) : (
              <View
                key={index}
                style={styles.column}
                accessible
                accessibilityLabel={UsageCopy.meter(column.name, column.value, column.resetIn)}
              >
                <View style={styles.columnHead}>
                  <Text style={[styles.columnLabel, { color: appearance.muted }]} numberOfLines={1}>
                    {column.name}
                  </Text>
                  <Text style={[styles.columnValue, { color: appearance.foreground }]}>{column.value}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: appearance.meterTrack }]}>
                  <View style={[styles.fill, { width: `${column.percent}%`, backgroundColor: appearance.meterFill }]} />
                </View>
                {resets && column.resetIn.length > 0 ? (
                  <Text style={[styles.columnReset, { color: appearance.muted }]} numberOfLines={1}>
                    {UsageCopy.resetIn(column.resetIn)}
                  </Text>
                ) : null}
              </View>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

function ToggleRow({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const styles = useStyles();
  return (
    <SwitchRow
      value={value}
      disabled={disabled}
      onValueChange={onChange}
      label={label}
      style={[styles.header, disabled ? styles.dim : null]}
    >
      <Text style={styles.accountName}>{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onChange} />
    </SwitchRow>
  );
}

/** The panel's labelled button: the chat's neutral fill (CDXC:AppModal 2026-10-14 on the desktop's `neutral_button_fills`). */
function FilledButton({
  label,
  disabled = false,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filledWide,
        styles.filled,
        pressed ? styles.filledPressed : null,
        disabled ? styles.dim : null,
      ]}
    >
      <Text style={styles.filledLabel}>{label}</Text>
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  panel: { gap: 8, paddingTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerTitle: { color: P.foreground, fontSize: 16, fontWeight: '600' },
  iconButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.controlPressed },
  dim: { opacity: 0.45 },
  alert: { gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder },
  strong: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  paragraph: { color: P.muted, fontSize: 13, lineHeight: 18 },
  grow: { flex: 1, minWidth: 0 },
  sectionHeading: { color: P.muted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  account: { gap: 5, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 },
  name: { color: P.foreground, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  email: { color: P.muted, fontSize: 12 },
  activeTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: P.menuBorder,
    borderRadius: 4,
    paddingHorizontal: 5,
  },
  activeTagText: { color: P.muted, fontSize: 10, lineHeight: 14, fontWeight: '500' },
  accountName: { color: P.foreground, fontSize: 14 },
  accountAction: { color: P.primary, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: P.menuBorder },
  customize: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    height: 34,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  segmented: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.menuBorder,
    backgroundColor: P.composerBackground,
  },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentPressed: { backgroundColor: P.border },
  segmentText: { color: P.muted, fontSize: 13 },
  segmentTextPressed: { color: P.foreground },
  priorities: { gap: 2 },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  filledWide: { height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  filled: { backgroundColor: P.neutralFill },
  filledPressed: { backgroundColor: P.neutralFillPressed },
  filledLabel: { color: P.foreground, fontSize: 14 },
}));

const usageRowStyles = StyleSheet.create({
  usage: { gap: 6 },
  usageLine: { flexDirection: 'row', gap: 14 },
  column: { flex: 1, minWidth: 0, gap: 4 },
  columnHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  columnLabel: { fontSize: 12, lineHeight: 15, fontWeight: '500', flexShrink: 1 },
  columnValue: { fontSize: 12, lineHeight: 15, fontWeight: '600' },
  columnReset: { fontSize: 10, lineHeight: 12 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 2 },
});
