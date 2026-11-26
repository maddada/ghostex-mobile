import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';

/** VoiceOver's custom actions a row can carry besides its switch. */
export type SwitchRowAccessibility = Pick<PressableProps, 'accessibilityActions' | 'onAccessibilityAction'>;

/**
 * A row that holds a switch and toggles it when any part of the row is tapped, not only the switch.
 *
 * CDXC:SwitchRows 2026-11-06 DECISION:
 * User: "allow clicking in the center of any toggle bar or on it's title to toggle it (not just the toggle button itself)". Every phone row that pairs a title with a `Switch` is wrapped in this one component (the Settings `ToggleRow`, the computer form's rows, the Accounts panel, Delayed Send, Session handoff): the row is the tap target and reads as a switch to a screen reader. The `Switch` inside keeps its own `onValueChange`, so a tap on the switch itself toggles once (a nested native switch takes its own touch), and tapping the row runs the same change with the opposite value.
 */
export function SwitchRow({
  value,
  onValueChange,
  disabled = false,
  label,
  style,
  pressedStyle,
  children,
  accessibilityActions,
  onAccessibilityAction,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  /** The row's visible title, read by a screen reader as the switch's name. */
  label?: string;
  style?: StyleProp<ViewStyle>;
  /** Drawn while the row is pressed; a light dim when omitted. */
  pressedStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
} & SwitchRowAccessibility) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [style, pressed ? (pressedStyle ?? { opacity: 0.7 }) : null]}
    >
      {children}
    </Pressable>
  );
}
