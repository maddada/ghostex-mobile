/**
 * "Before you start" (`.precheck-steps` in mobile-04-tailscale.html): step 1
 * self-checks Tailscale on this phone through `GhostexNative.isTailscaleConnected`
 * and ticks itself; step 2 cannot be checked from the phone, so it shows the
 * three OS buttons that open the SSH access help sheet.
 */

import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { CheckGlyph } from '../../components/onboarding/SetupIcons';
import { StepNumber } from '../../components/onboarding/SetupPrimitives';
import { SshOsButtons, type SshOs } from '../../components/onboarding/SshAccessHelpSheet';
import { TailscaleFormCopy } from '../../copy';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export type TailscalePhoneState =
  | { kind: 'checking' }
  | { kind: 'connected' }
  | { kind: 'disconnected' }
  /** `isTailscaleConnected` rejected: the state is unknown, not "off". */
  | { kind: 'error'; reason: string };

/** Polls Tailscale's state on this phone while mounted (it changes when the user toggles the VPN). */
export function useTailscalePhoneState(intervalMs = 3000): TailscalePhoneState {
  const [state, setState] = useState<TailscalePhoneState>({ kind: 'checking' });
  useEffect(() => {
    let cancelled = false;
    const check = (): void => {
      void GhostexNative.isTailscaleConnected().then(
        (connected) => {
          if (!cancelled) setState({ kind: connected ? 'connected' : 'disconnected' });
        },
        (error: unknown) => {
          if (!cancelled) {
            setState({ kind: 'error', reason: error instanceof Error ? error.message : String(error) });
          }
        },
      );
    };
    check();
    const timer = setInterval(check, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);
  return state;
}

export function PrecheckStep({
  number,
  done,
  title,
  detail,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={styles.step}>
      {done ? (
        <View style={styles.doneMark}>
          <CheckGlyph size={12} color={SetupPalette.OK} strokeWidth={2.6} />
        </View>
      ) : (
        <StepNumber number={number} />
      )}
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
        {children}
      </View>
    </View>
  );
}

export default function PrecheckList({
  onSelectOs,
  currentOs,
}: {
  onSelectOs: (os: SshOs) => void;
  currentOs: SshOs | null;
}) {
  const tailscale = useTailscalePhoneState();
  const copy = TailscaleFormCopy.precheck;
  const tailscaleDetail =
    tailscale.kind === 'checking'
      ? copy.tailscaleOnPhoneChecking
      : tailscale.kind === 'connected'
        ? copy.tailscaleOnPhoneOn
        : tailscale.kind === 'error'
          ? copy.tailscaleOnPhoneError(tailscale.reason)
          : copy.tailscaleOnPhoneOff;
  return (
    <View style={styles.list}>
      <PrecheckStep
        number={1}
        done={tailscale.kind === 'connected'}
        title={copy.tailscaleOnPhone}
        detail={tailscaleDetail}
      />
      <PrecheckStep number={2} done={false} title={copy.sshAccess} detail={copy.sshAccessDetail}>
        <View style={styles.osButtons}>
          <SshOsButtons onSelect={onSelectOs} current={currentOs} />
        </View>
      </PrecheckStep>
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 12,
  },
  step: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  doneMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(99,209,122,0.14)',
    borderWidth: GhostexStrokeWidth,
    borderColor: 'rgba(99,209,122,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    gap: 3,
    paddingTop: 1,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  detail: {
    color: SetupPalette.MUTED,
    fontSize: 12.5,
    lineHeight: 18,
  },
  osButtons: {
    marginTop: 8,
  },
});
