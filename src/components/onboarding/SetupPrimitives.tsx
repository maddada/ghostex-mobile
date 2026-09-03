/**
 * Shared building blocks of the setup flow, styled with SetupPalette so every
 * screen renders the same button, row group, callout and text styles as the
 * mockup (docs/2026-09-03/mobile-setup/shared.css): white primary button,
 * bordered secondary, ghost tertiary; #1d1d1d row groups with hairline
 * dividers; 12px sections, 8px controls.
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export const SETUP_MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });

export type SetupButtonVariant = 'primary' | 'secondary' | 'ghost';

export type SetupButtonProps = {
  label: string;
  onPress: () => void;
  variant?: SetupButtonVariant;
  /** 48px tall with a 16px label (the screen-footer primary in the mockup). */
  large?: boolean;
  /** 32px tall with a 13px label (the card-footer buttons in the mockup). */
  small?: boolean;
  disabled?: boolean;
  busy?: boolean;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function SetupButton({
  label,
  onPress,
  variant = 'secondary',
  large = false,
  small = false,
  disabled = false,
  busy = false,
  icon,
  style,
  accessibilityLabel,
}: SetupButtonProps) {
  const labelColor =
    variant === 'primary'
      ? SetupPalette.PRIMARY_BUTTON_FOREGROUND
      : variant === 'ghost'
        ? SetupPalette.MUTED
        : SetupPalette.FOREGROUND;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      style={({ pressed }) => [
        buttonStyles.base,
        variant === 'primary' ? buttonStyles.primary : null,
        variant === 'secondary' ? buttonStyles.secondary : null,
        variant === 'ghost' ? buttonStyles.ghost : null,
        large ? buttonStyles.large : null,
        small ? buttonStyles.small : null,
        pressed ? buttonStyles.pressed : null,
        disabled ? buttonStyles.disabled : null,
        style,
      ]}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator size="small" color={labelColor} />
      ) : (
        <>
          <Text
            style={[
              buttonStyles.label,
              { color: labelColor },
              large ? buttonStyles.labelLarge : null,
              small ? buttonStyles.labelSmall : null,
            ]}
          >
            {label}
          </Text>
          {icon}
        </>
      )}
    </Pressable>
  );
}

const buttonStyles = StyleSheet.create({
  base: {
    height: 40,
    paddingHorizontal: 14,
    borderRadius: GhostexRadii.control,
    borderWidth: GhostexStrokeWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primary: {
    backgroundColor: SetupPalette.PRIMARY_BUTTON,
    borderColor: SetupPalette.PRIMARY_BUTTON,
  },
  secondary: {
    backgroundColor: SetupPalette.CARD,
    borderColor: SetupPalette.BORDER_STRONG,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  large: {
    height: 48,
  },
  small: {
    height: 32,
    paddingHorizontal: 12,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.45,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
  },
  labelLarge: {
    fontSize: 16,
  },
  labelSmall: {
    fontSize: 13,
  },
});

/** A card-shaped group of key/value rows (`.rows` in the mockup). */
export function SetupRows({
  children,
  panel = false,
  style,
}: {
  children: ReactNode;
  /** `.rows-panel`: #161616 instead of the card fill. */
  panel?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[rowStyles.group, panel ? rowStyles.groupPanel : null, style]}>{children}</View>
  );
}

export function SetupRow({
  label,
  value,
  mono = false,
  first = false,
  leading,
  compact = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  first?: boolean;
  /** A dot or glyph shown before the value. */
  leading?: ReactNode;
  compact?: boolean;
}) {
  return (
    <View style={[rowStyles.row, first ? rowStyles.rowFirst : null, compact ? rowStyles.rowCompact : null]}>
      <Text style={[rowStyles.label, compact ? rowStyles.textCompact : null]}>{label}</Text>
      <View style={rowStyles.valueWrap}>
        {leading}
        <Text
          style={[
            rowStyles.value,
            mono ? rowStyles.valueMono : null,
            compact ? rowStyles.textCompact : null,
          ]}
          numberOfLines={1}
        >
          {value}
        </Text>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  group: {
    backgroundColor: SetupPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    borderRadius: GhostexRadii.section,
    overflow: 'hidden',
  },
  groupPanel: {
    backgroundColor: SetupPalette.PANEL,
  },
  row: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowCompact: {
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  label: {
    color: SetupPalette.MUTED,
    fontSize: 14,
  },
  valueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  value: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    flexShrink: 1,
  },
  valueMono: {
    fontFamily: SETUP_MONOSPACE,
    fontWeight: '500',
    fontSize: 13,
  },
  textCompact: {
    fontSize: 12.5,
  },
});

/** Status dot in a row value (`.dot.ok` etc.). */
export function StatusDot({ color }: { color: string }) {
  return <View style={[dotStyles.dot, { backgroundColor: color }]} />;
}

const dotStyles = StyleSheet.create({
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

/** Bordered note with a leading glyph (`.callout`). */
export function SetupCallout({ icon, children }: { icon: ReactNode; children: string }) {
  return (
    <View style={calloutStyles.callout}>
      <View style={calloutStyles.icon}>{icon}</View>
      <Text style={calloutStyles.text}>{children}</Text>
    </View>
  );
}

const calloutStyles = StyleSheet.create({
  callout: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PANEL,
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    color: SetupPalette.MUTED,
    fontSize: 13,
    lineHeight: 19,
  },
});

/** Text styles shared by the setup screens. */
export const setupText = StyleSheet.create({
  eyebrow: {
    color: SetupPalette.MUTED,
    fontSize: 13,
  },
  titleLg: {
    color: SetupPalette.FOREGROUND,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.4,
    lineHeight: 31,
  },
  title: {
    color: SetupPalette.FOREGROUND,
    fontSize: 18,
    fontWeight: '600',
  },
  lede: {
    color: SetupPalette.MUTED,
    fontSize: 14,
    lineHeight: 21,
  },
  small: {
    color: SetupPalette.MUTED,
    fontSize: 12.5,
    lineHeight: 18,
  },
  dim: {
    color: SetupPalette.DIM,
  },
  accent: {
    color: SetupPalette.ACCENT,
  },
  strong: {
    color: SetupPalette.FOREGROUND,
    fontWeight: '600',
  },
  center: {
    textAlign: 'center',
  },
} satisfies Record<string, TextStyle>);

/** Numbered circle used by option-card steps and the "Where is the code?" list. */
export function StepNumber({ number, size = 22 }: { number: number; size?: number }) {
  return (
    <View style={[stepStyles.circle, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[stepStyles.number, { fontSize: size <= 18 ? 10.5 : 11.5 }]}>{number}</Text>
    </View>
  );
}

const stepStyles = StyleSheet.create({
  circle: {
    backgroundColor: SetupPalette.MUTED_BG,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    color: SetupPalette.MUTED,
    fontWeight: '700',
  },
});
