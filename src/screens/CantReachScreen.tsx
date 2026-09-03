/**
 * "Can't reach <computer>" (docs/2026-09-03/mobile-setup/mobile-09-cant-reach.html):
 * the sanitized reason and when the computer was last reached, then one
 * checklist per transport ordered by likelihood. Steps the phone can verify are
 * ticked live, steps with an in-app fix get a button, rarer SSH errors are an
 * accordion of their own for Tailscale (one row per reason: cause, fix and the
 * fix's button), and the primary action is always Retry.
 */

import { useEffect, useRef, useState } from 'react';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { formatAppLog, useAppLogStore } from '../app/appLog';
import { Accordion, type AccordionItem } from '../components/common/Collapsible';
import { SetupButton, StatusDot, setupText } from '../components/onboarding/SetupPrimitives';
import SshAccessHelpSheet, {
  SshOsButtons,
  type SshOs,
} from '../components/onboarding/SshAccessHelpSheet';
import { CantReachCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, machineTransportLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { SetupPalette } from '../theme/palette';
import { checklistFor, type ChecklistAction, type ChecklistStep } from './cant-reach/checklists';
import { formatRecency } from './machine-form/dates';
import { PrecheckStep, useTailscalePhoneState } from './machine-form/PrecheckList';
import { formStyles } from './machine-form/styles';

type Props = NativeStackScreenProps<RootStackParamList, 'CantReach'>;

export default function CantReachScreen({ navigation, route }: Props) {
  const { machineId } = route.params;
  const machine = useMachinesStore(
    (state) => state.machines.find((entry) => entry.id === machineId) ?? null,
  );
  const inventory = useInventoryStore((state) => state.inventoriesByMachineId[machineId]);
  const refreshMachineFresh = useInventoryStore((state) => state.refreshMachineFresh);
  const logEntries = useAppLogStore((state) => state.entries);
  const tailscalePhone = useTailscalePhoneState();
  const [retrying, setRetrying] = useState(false);
  const [helpOs, setHelpOs] = useState<SshOs | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hostKeyReset, setHostKeyReset] = useState<'idle' | 'resetting' | 'done'>('idle');

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  if (machine === null) {
    return <SafeAreaView style={formStyles.page} edges={['bottom']} />;
  }

  const name = machine.name.length > 0 ? machine.name : machine.username;
  const lastError = inventory?.lastError ?? null;
  const reasonCode = inventory?.lastErrorCode ?? 'unknown';
  const easyConnect = machine.transport === 'tailcat';
  const steps = checklistFor(machine.transport);
  const lastReached =
    machine.lastConnectedAt === null
      ? CantReachCopy.neverReached
      : CantReachCopy.lastReached(formatRecency(machine.lastConnectedAt));

  const retry = async (): Promise<void> => {
    if (retrying) return;
    setRetrying(true);
    try {
      await refreshMachineFresh(machine);
    } finally {
      setRetrying(false);
    }
    const after = useInventoryStore.getState().inventoriesByMachineId[machine.id];
    if (after !== undefined && after.lastError === null && after.summary !== null) {
      navigation.goBack();
    }
  };

  const runAction = (action: ChecklistAction): void => {
    if (action === 'scanNewCode') navigation.navigate('ScanCode', { rePairMachineId: machine.id });
    else navigation.navigate('MachineForm', { machineId: machine.id });
  };

  const copyDiagnostics = (): void => {
    const header = [
      `Ghostex diagnostics · ${machineDisplayLabel(machine)}`,
      `Transport: ${machineTransportLabel(machine)}`,
      `Reason: ${lastError ?? '(none recorded)'} [${reasonCode}]`,
      `Last reached: ${machine.lastConnectedAt ?? 'never'}`,
      `Tailscale on phone: ${tailscalePhone.kind}${tailscalePhone.kind === 'error' ? ` (${tailscalePhone.reason})` : ''}`,
      '',
    ].join('\n');
    void Clipboard.setStringAsync(header + formatAppLog(logEntries)).then(() => {
      setCopied(true);
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    });
  };

  // The same identity the machine form's Advanced → Host key → Reset clears.
  const resetHostKey = (): void => {
    if (hostKeyReset === 'resetting') return;
    setHostKeyReset('resetting');
    void GhostexNative.resetHostKey(machine.host, machine.port).then(
      () => setHostKeyReset('done'),
      () => setHostKeyReset('idle'),
    );
  };

  const otherReasons = CantReachCopy.tailscale.otherReasons;
  // The row for the error that actually happened is titled in the error colour.
  const currentReason = (code: string): string | undefined =>
    reasonCode === code ? SetupPalette.ERROR : undefined;
  const otherReasonItems: readonly AccordionItem[] = [
    {
      id: 'sshRefused',
      title: otherReasons.sshRefused.title,
      titleColor: currentReason('sshRefused'),
      body: (
        <>
          <Text style={styles.reasonText}>
            {otherReasons.sshRefused.cause} {otherReasons.sshRefused.fix}
          </Text>
          <SshOsButtons current={helpOs} onSelect={setHelpOs} />
        </>
      ),
    },
    {
      id: 'authFailed',
      title: otherReasons.wrongPassword.title,
      titleColor: currentReason('authFailed'),
      body: (
        <>
          <Text style={styles.reasonText}>
            {otherReasons.wrongPassword.cause} {otherReasons.wrongPassword.fix}
          </Text>
          <View style={styles.reasonAction}>
            <SetupButton
              small
              label={otherReasons.wrongPassword.button}
              onPress={() => navigation.navigate('MachineForm', { machineId: machine.id, focus: 'password' })}
            />
          </View>
        </>
      ),
    },
    {
      id: 'hostKeyChanged',
      title: otherReasons.hostKeyChanged.title,
      titleColor: currentReason('hostKeyChanged'),
      body: (
        <>
          <Text style={styles.reasonText}>
            {otherReasons.hostKeyChanged.cause} {otherReasons.hostKeyChanged.fix}
          </Text>
          {hostKeyReset === 'done' ? (
            <Text style={[setupText.small, styles.reasonDone]}>{otherReasons.hostKeyChanged.done}</Text>
          ) : (
            <View style={styles.reasonAction}>
              <SetupButton
                small
                label={otherReasons.hostKeyChanged.button}
                busy={hostKeyReset === 'resetting'}
                onPress={resetHostKey}
              />
            </View>
          )}
        </>
      ),
    },
  ];
  const currentReasonItem = otherReasonItems.find((item) => item.id === reasonCode);

  const stepState = (step: ChecklistStep): { done: boolean; detail: string } => {
    if (step.verify === 'tailscaleOnPhone') {
      const copy = CantReachCopy.tailscale.tailscaleOnPhone;
      return {
        done: tailscalePhone.kind === 'connected',
        detail:
          tailscalePhone.kind === 'checking'
            ? copy.detailChecking
            : tailscalePhone.kind === 'connected'
              ? copy.detailOn
              : tailscalePhone.kind === 'error'
                ? copy.detailError(tailscalePhone.reason)
                : copy.detailOff,
      };
    }
    return { done: false, detail: step.detail };
  };

  return (
    <SafeAreaView style={formStyles.page} edges={['bottom']}>
      <ScrollView contentContainerStyle={formStyles.scroll}>
        <View style={styles.hero}>
          <View style={styles.eyebrow}>
            <StatusDot color={SetupPalette.ERROR} />
            <Text style={setupText.eyebrow}>{CantReachCopy.eyebrow}</Text>
          </View>
          <Text style={setupText.titleLg}>{CantReachCopy.title(name)}</Text>
        </View>

        <View style={formStyles.errorCallout}>
          <Text style={formStyles.errorCalloutText}>
            {lastError !== null ? `${lastError} ` : ''}
            <Text style={setupText.dim}>{lastReached}</Text>
          </Text>
        </View>

        <Text style={formStyles.sectionLabel}>{CantReachCopy.checklistLabel}</Text>
        <View style={styles.steps}>
          {steps.map((step, index) => {
            const { done, detail } = stepState(step);
            return (
              <PrecheckStep key={step.id} number={index + 1} done={done} title={step.title} detail={detail}>
                {step.action !== undefined ? (
                  <View style={styles.stepAction}>
                    <SetupButton small label={step.action.label} onPress={() => runAction(step.action!.kind)} />
                  </View>
                ) : null}
              </PrecheckStep>
            );
          })}
        </View>

        {easyConnect ? null : (
          <View style={styles.otherReasons}>
            <Text style={styles.otherTitle}>{otherReasons.title}</Text>
            <Accordion items={otherReasonItems} initiallyOpenId={currentReasonItem?.id ?? null} />
          </View>
        )}

        <Text style={[setupText.small, setupText.dim]}>
          {CantReachCopy.stillStuck}
          <Pressable accessibilityRole="button" onPress={copyDiagnostics}>
            <Text style={[setupText.small, setupText.accent]}>
              {copied ? CantReachCopy.diagnosticsCopied : CantReachCopy.copyDiagnostics}
            </Text>
          </Pressable>
        </Text>
      </ScrollView>

      <View style={formStyles.footer}>
        <SetupButton variant="primary" large busy={retrying} label={CantReachCopy.retry} onPress={() => void retry()} />
      </View>

      <SshAccessHelpSheet os={helpOs} onClose={() => setHelpOs(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: 8,
  },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  steps: {
    gap: 14,
  },
  stepAction: {
    marginTop: 8,
    flexDirection: 'row',
  },
  otherReasons: {
    gap: 10,
  },
  otherTitle: {
    color: SetupPalette.MUTED,
    fontSize: 12.5,
    fontWeight: '600',
  },
  reasonText: {
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 19,
  },
  reasonAction: {
    flexDirection: 'row',
  },
  reasonDone: {
    color: SetupPalette.OK,
  },
});
