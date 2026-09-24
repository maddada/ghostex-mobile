/**
 * The Accounts & limits panel (More actions > Switch Account), drawn from the document's
 * `accountPanel` the way desktop's `option_menu/accounts.rs` draws it: the current login with its
 * usage meters, the accounts the session can switch to, and the keep-going policy.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { AGENT_ICONS } from '../../../assets/agentIcons.generated';
import { Glyph } from './icons';
import { arr, isTrue, num, obj, str, type JsonRecord } from './json';
import { ComposerPalette as P } from './palette';

type Run = (command: JsonRecord, keepOpen: boolean) => void;

function policyCommand(policy: unknown): JsonRecord {
  return { type: 'accounts', request: { operation: 'sessionPolicy', policy: policy ?? null } };
}

function withField(policy: JsonRecord | null, key: string, value: unknown): JsonRecord {
  return { ...(policy ?? {}), [key]: value };
}

export function AccountsPanel({ panel, onCommand }: { panel: JsonRecord; onCommand: Run }) {
  const [customize, setCustomize] = useState(false);
  if (str(panel, 'kind') === 'noAccounts') {
    return (
      <View style={styles.panel}>
        <Text style={styles.strong}>Current CLI login</Text>
        <Text style={styles.paragraph}>
          Add your account to see usage and reset times in Ghostex, even if you only use one account.
        </Text>
        <OutlineButton label="Add account" onPress={() => onCommand({ type: 'openAccountsSettings' }, false)} />
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
        <SessionBlocks session={session} busy={busy} customize={customize} onCustomize={() => setCustomize(true)} onDefaults={() => {
          setCustomize(false);
          onCommand(policyCommand(null), true);
        }} onCommand={onCommand} />
      ) : null}
    </View>
  );
}

function SessionBlocks({
  session,
  busy,
  customize,
  onCustomize,
  onDefaults,
  onCommand,
}: {
  session: JsonRecord;
  busy: boolean;
  customize: boolean;
  onCustomize: () => void;
  onDefaults: () => void;
  onCommand: Run;
}) {
  const recovery = obj(session.recovery);
  const usage = arr(session.usage);
  const context = obj(session.context);
  const policyState = obj(session.policy);
  const policy = obj(policyState?.value);
  const custom = isTrue(policyState, 'custom');
  const showPolicy = customize || custom;
  const enabled = isTrue(policy, 'enabled');
  const dim = busy || !enabled;
  const atLimitSwitch = str(policy, 'atLimit') === 'switch';
  const usageError = str(session, 'usageError');
  const email = str(session, 'email');
  return (
    <>
      {recovery !== null ? (
        <View style={styles.alert} accessibilityRole="summary">
          <Text style={styles.strong}>{str(recovery, 'reason')}</Text>
          {str(recovery, 'next').length > 0 ? <Text style={styles.paragraph}>{str(recovery, 'next')}</Text> : null}
          <OutlineButton
            label="Stop automatic recovery"
            disabled={busy}
            onPress={() => onCommand({ type: 'accounts', request: { operation: 'stopRecovery' } }, true)}
          />
        </View>
      ) : null}
      <View style={styles.current}>
        {obj(session.current) !== null ? <Identity value={obj(session.current)!} /> : null}
        <View style={styles.grow}>
          <Text style={styles.strong} numberOfLines={1}>
            {str(session, 'name')}
          </Text>
          {email.length > 0 ? (
            <Text style={styles.paragraph} numberOfLines={1}>
              {email}
            </Text>
          ) : null}
        </View>
      </View>
      {usageError.length > 0 ? <Text style={styles.paragraph}>{usageError}</Text> : null}
      {usage.length === 0 ? <Text style={styles.paragraph}>Usage is unavailable for this login.</Text> : null}
      {usage.map((window, index) => (
        <Meter key={index} label={str(window, 'label')} percent={num(window, 'percent') ?? 0} left={str(window, 'reset')} />
      ))}
      {context !== null ? (
        <Meter
          label="Conversation context"
          percent={num(context, 'percent') ?? 0}
          left={str(context, 'value')}
          right={str(context, 'tokens')}
        />
      ) : null}
      <Text style={styles.sectionHeading}>{str(session, 'switchHeading')}</Text>
      {arr(session.others).map((row, index) => {
        const ready = isTrue(row, 'ready');
        const detail = str(row, 'detail');
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
                  : { type: 'openAccountsSettings' },
                false
              )
            }
            style={({ pressed }) => [styles.account, pressed ? styles.pressed : null, busy ? styles.dim : null]}
          >
            <Identity value={record} />
            <View style={styles.grow}>
              <Text style={styles.accountName} numberOfLines={1}>
                {str(row, 'name')}
              </Text>
              {detail.length > 0 ? (
                <Text style={styles.paragraph} numberOfLines={1}>
                  {detail}
                </Text>
              ) : null}
            </View>
            <Text style={styles.accountAction}>{str(row, 'action')}</Text>
          </Pressable>
        );
      })}
      <Text style={styles.paragraph}>Switching resumes the same conversation. Stop an active turn before switching.</Text>
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
                    onPress={() => onCommand(policyCommand(withField(policy, 'priority', obj(option)?.value ?? null)), true)}
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
            onChange={() => onCommand(policyCommand(withField(policy, 'retryErrors', !isTrue(policy, 'retryErrors'))), true)}
          />
          <Text style={[styles.paragraph, dim ? styles.dim : null]}>{str(policyState, 'retryDescription')}</Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={onDefaults}
            style={({ pressed }) => [styles.customize, pressed ? styles.pressed : null]}
          >
            <Glyph name="arrow-back-up" size={15} color={P.muted} />
            <Text style={styles.paragraph}>Use session defaults</Text>
          </Pressable>
        </>
      ) : null}
    </>
  );
}

function Identity({ value }: { value: JsonRecord }) {
  const provider = str(value, 'provider') || 'claude';
  const Icon = AGENT_ICONS[provider];
  const figures = arr(value.figures).filter((figure): figure is string => typeof figure === 'string');
  return (
    <View style={styles.identity}>
      {Icon !== undefined ? <Icon size={21} color={P.foreground} /> : null}
      <View>
        {figures.map((figure, index) => (
          <Text key={index} style={[styles.figure, index > 0 ? styles.figureDim : null]}>
            {figure}
          </Text>
        ))}
      </View>
    </View>
  );
}

function Meter({ label, percent, left, right }: { label: string; percent: number; left: string; right?: string }) {
  return (
    <View style={styles.meter}>
      <Text style={styles.meterLabel}>{label}</Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%` }]} />
      </View>
      <View style={styles.header}>
        <Text style={styles.paragraph}>{left}</Text>
        {right !== undefined ? <Text style={styles.paragraph}>{right}</Text> : null}
      </View>
    </View>
  );
}

function ToggleRow({ label, value, disabled, onChange }: { label: string; value: boolean; disabled: boolean; onChange: () => void }) {
  return (
    <View style={[styles.header, disabled ? styles.dim : null]}>
      <Text style={styles.accountName}>{label}</Text>
      <Switch value={value} disabled={disabled} onValueChange={onChange} />
    </View>
  );
}

function OutlineButton({ label, disabled = false, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.outline, pressed ? styles.pressed : null, disabled ? styles.dim : null]}
    >
      <Text style={styles.accountName}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 12, paddingTop: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  headerTitle: { color: P.foreground, fontSize: 16, fontWeight: '600' },
  iconButton: { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.pressed },
  dim: { opacity: 0.45 },
  alert: { gap: 8, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder },
  strong: { color: P.foreground, fontSize: 14, fontWeight: '600' },
  paragraph: { color: P.muted, fontSize: 13, lineHeight: 18 },
  current: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  grow: { flex: 1, minWidth: 0 },
  sectionHeading: { color: P.muted, fontSize: 12, fontWeight: '600', marginTop: 4 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  accountName: { color: P.foreground, fontSize: 14 },
  accountAction: { color: P.primary, fontSize: 13 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: P.menuBorder },
  customize: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 34, borderRadius: 8, alignSelf: 'flex-start' },
  segmented: { flexDirection: 'row', padding: 3, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder, backgroundColor: P.composerBackground },
  segment: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  segmentPressed: { backgroundColor: P.border },
  segmentText: { color: P.muted, fontSize: 13 },
  segmentTextPressed: { color: P.foreground },
  priorities: { gap: 2 },
  priority: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 8 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 7, minWidth: 40 },
  figure: { color: P.foreground, fontFamily: 'Menlo', fontSize: 10, lineHeight: 13 },
  figureDim: { opacity: 0.6 },
  meter: { gap: 6 },
  meterLabel: { color: P.foreground, fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: P.meterTrack },
  fill: { height: '100%', borderRadius: 3, backgroundColor: P.meterFill },
  outline: { height: 40, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder, alignItems: 'center', justifyContent: 'center' },
});
