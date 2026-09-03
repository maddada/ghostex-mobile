/**
 * "Turn on SSH access" help: the three OS buttons (Apple / Windows / Linux
 * logos, full height so they are easy to tap) and the bottom sheet with that
 * OS's steps plus the "let Ghostex do it" shortcut, mirroring `SSH_INSTRUCTIONS`
 * and `.os-buttons` in docs/2026-09-03/mobile-setup/shared.js. Used by the
 * Tailscale form's second precheck and by the "SSH refused" row of Can't reach.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { SshAccessCopy } from '../../copy';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import BottomSheet from '../common/BottomSheet';
import { SetupButton, StepNumber, setupText } from './SetupPrimitives';

export type SshOs = 'macos' | 'windows' | 'linux';

export const SSH_OS_ORDER: readonly SshOs[] = ['macos', 'windows', 'linux'];

type LogoProps = { size?: number; color: string };

function AppleLogo({ size = 22, color }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M16.365 1.43c0 1.14-.417 2.2-1.245 3.16-.998 1.14-2.204 1.8-3.51 1.69a3.5 3.5 0 0 1-.027-.43c0-1.1.478-2.27 1.33-3.22.425-.48.966-.88 1.62-1.2.653-.31 1.27-.48 1.85-.51.017.17.026.34.026.51zm3.53 16.15c-.52 1.19-1.13 2.28-1.86 3.28-.98 1.36-1.79 2.3-2.41 2.82-.96.86-1.99 1.3-3.09 1.33-.79 0-1.74-.22-2.86-.68-1.12-.45-2.15-.67-3.09-.67-.99 0-2.05.22-3.18.67-1.14.46-2.05.7-2.75.72-1.06.05-2.11-.4-3.16-1.37C-1.15 21.36 1.09 15.58 2.75 12.9c1.2-1.94 2.72-2.94 4.57-2.97.85 0 1.97.28 3.37.82 1.39.55 2.29.83 2.68.83.29 0 1.28-.32 2.96-.96 1.59-.6 2.93-.85 4.03-.75 2.98.24 5.22 1.41 6.7 3.52-2.66 1.61-3.98 3.87-3.95 6.77.02 2.26.85 4.14 2.47 5.63-.36 1.04-.74 2-1.15 2.9z" />
    </Svg>
  );
}

function WindowsLogo({ size = 22, color }: LogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path d="M3 5.5l7.5-1v7H3v-6zm0 13l7.5 1v-7H3v6zm8.5 1.2L21 21v-8.5h-9.5v7.2zm0-15.4v7.2H21V3l-9.5 1.3z" />
    </Svg>
  );
}

function LinuxLogo({ size = 22, color }: LogoProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 3c-2.2 0-3.5 1.8-3.5 4.2 0 1.5-.3 2.4-1.2 3.7C6.2 12.6 5 14.4 5 16.4c0 1 .4 1.6 1 2" />
      <Path d="M12 3c2.2 0 3.5 1.8 3.5 4.2 0 1.5.3 2.4 1.2 3.7 1.1 1.7 2.3 3.5 2.3 5.5 0 1-.4 1.6-1 2" />
      <Path d="M8.5 20.5c-1 0-2.2-.6-2.2-1.6 0-.7.7-1.2 1.5-1.6.8-.4 1.2-1 1.2-1.8" />
      <Path d="M15.5 20.5c1 0 2.2-.6 2.2-1.6 0-.7-.7-1.2-1.5-1.6-.8-.4-1.2-1-1.2-1.8" />
      <Path d="M9 15.5c0 2 1.3 3.2 3 3.2s3-1.2 3-3.2" />
      <Path d="M10.4 8.2h.01M13.6 8.2h.01" />
      <Path d="M10.6 10.4c.8.7 2 .7 2.8 0" />
    </Svg>
  );
}

export function SshOsLogo({ os, size, color }: { os: SshOs } & LogoProps) {
  if (os === 'macos') return <AppleLogo size={size} color={color} />;
  if (os === 'windows') return <WindowsLogo size={size} color={color} />;
  return <LinuxLogo size={size} color={color} />;
}

/** The three OS buttons in a row; each opens the instructions for that system. */
export function SshOsButtons({
  onSelect,
  current,
}: {
  onSelect: (os: SshOs) => void;
  /** Highlighted button (the sheet currently open). */
  current?: SshOs | null;
}) {
  return (
    <View style={styles.buttons}>
      {SSH_OS_ORDER.map((os) => {
        const active = current === os;
        return (
          <Pressable
            key={os}
            accessibilityRole="button"
            accessibilityLabel={SshAccessCopy.byOs[os].title}
            style={({ pressed }) => [
              styles.button,
              active ? styles.buttonActive : null,
              pressed ? styles.buttonPressed : null,
            ]}
            onPress={() => onSelect(os)}
          >
            <SshOsLogo os={os} size={24} color={active ? SetupPalette.ACCENT : SetupPalette.FOREGROUND} />
            <Text style={[styles.buttonLabel, active ? styles.buttonLabelActive : null]}>
              {SshAccessCopy.osLabels[os]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The sheet body, also rendered full-screen by the `SshAccessHelp` route. */
export function SshAccessHelpContent({ os }: { os: SshOs }) {
  const copy = SshAccessCopy.byOs[os];
  return (
    <View style={styles.content}>
      <View style={styles.head}>
        <SshOsLogo os={os} size={22} color={SetupPalette.FOREGROUND} />
        <Text style={setupText.title}>{copy.title}</Text>
      </View>
      <View style={styles.steps}>
        {copy.steps.map((step, index) => (
          <View key={step} style={styles.step}>
            <StepNumber number={index + 1} />
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
      </View>
      <Text style={setupText.small}>{copy.note}</Text>
    </View>
  );
}

export type SshAccessHelpSheetProps = {
  /** The OS whose instructions to show; null keeps the sheet closed. */
  os: SshOs | null;
  onClose: () => void;
};

export default function SshAccessHelpSheet({ os, onClose }: SshAccessHelpSheetProps) {
  return (
    <BottomSheet visible={os !== null} onClose={onClose}>
      {os !== null ? <SshAccessHelpContent os={os} /> : null}
      <SetupButton variant="primary" label={SshAccessCopy.done} onPress={onClose} style={styles.done} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  buttons: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    flex: 1,
    minHeight: 64,
    paddingVertical: 10,
    borderRadius: GhostexRadii.control,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    backgroundColor: SetupPalette.CARD,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  buttonActive: {
    borderColor: SetupPalette.ACCENT_BORDER,
    backgroundColor: SetupPalette.ACCENT_FILL,
  },
  buttonPressed: {
    backgroundColor: SetupPalette.CARD_HOVER,
  },
  buttonLabel: {
    color: SetupPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  buttonLabelActive: {
    color: SetupPalette.ACCENT,
  },
  content: {
    gap: 14,
    paddingTop: 4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  steps: {
    gap: 10,
  },
  step: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  stepText: {
    flex: 1,
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    lineHeight: 20,
  },
  done: {
    marginTop: 16,
  },
});
