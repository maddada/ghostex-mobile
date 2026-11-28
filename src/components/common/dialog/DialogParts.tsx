/**
 * What goes inside a `DialogSheet`: the title, the message, full-width buttons stacked with the action on top and
 * Cancel under it, and choice rows for three or more choices. Shared by `showAlert()`, `ConfirmDialog`, `PromptDialog`
 * and `ActionSheet`, so every dialog in the app reads the same.
 *
 * CDXC:PhoneDialogs 2026-11-28 DECISION:
 * User, picking from the dialogs page: buttons always stacked, full width (never side by side), a destructive one
 * as a red label on a soft red tint (`destructiveButtonFills`, as the desktop), the main action one step brighter
 * than the neutral fill and never the accent colour.
 */

import { useMemo, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useAppearance, type Appearance } from '../../../theme/useAppearance';
import { colorOver, colorWithOpacity, GhostexPalette, GhostexRadii, SidebarPalette } from '../../../theme/palette';
import { readableSecondaryText } from '../../../theme/sidebarAppearance';
import { dialogSolidFill } from './DialogSheet';

export function useDialogStyles() {
  const appearance = useAppearance();
  return useMemo(() => createDialogStyles(appearance), [appearance]);
}

export function DialogTitle({ children }: { children: string }) {
  const styles = useDialogStyles();
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

/**
 * The message under the title. It scrolls between the title and the buttons when it is too long for the sheet.
 * `selectable`: monospace text that can be selected and copied (a command to run by hand).
 */
export function DialogMessage({ children, selectable = false }: { children: ReactNode; selectable?: boolean }) {
  const styles = useDialogStyles();
  return (
    <ScrollView style={styles.messageScroll} bounces={false}>
      <Text selectable={selectable} style={[styles.message, selectable && styles.messageMono]}>
        {children}
      </Text>
    </ScrollView>
  );
}

export type DialogButtonKind = 'primary' | 'neutral' | 'destructive';

export function DialogButton({
  label,
  kind,
  onPress,
  disabled = false,
}: {
  label: string;
  kind: DialogButtonKind;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useDialogStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' ? styles.buttonPrimary : kind === 'destructive' ? styles.buttonDestructive : null,
        pressed &&
          (kind === 'primary'
            ? styles.buttonPrimaryPressed
            : kind === 'destructive'
              ? styles.buttonDestructivePressed
              : styles.buttonPressed),
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.buttonLabel, kind === 'destructive' && styles.buttonLabelDestructive]}>{label}</Text>
    </Pressable>
  );
}

/** The stacked buttons at the bottom of a dialog: pass them action first, Cancel last. */
export function DialogButtons({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useDialogStyles();
  return <View style={[styles.buttons, style]}>{children}</View>;
}

/** One choice of three or more: a row with an optional muted detail, a destructive tint, or a radio mark. */
export function DialogRow({
  label,
  detail,
  destructive = false,
  disabled = false,
  selected,
  onPress,
}: {
  label: string;
  detail?: string;
  destructive?: boolean;
  disabled?: boolean;
  /** Set on every row of a list that picks one: the row is a radio button, on when true. */
  selected?: boolean;
  onPress: () => void;
}) {
  const styles = useDialogStyles();
  return (
    <Pressable
      accessibilityRole={selected === undefined ? 'button' : 'radio'}
      accessibilityState={selected === undefined ? { disabled } : { selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.buttonPressed, disabled && styles.disabled]}
    >
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && styles.buttonLabelDestructive]}>{label}</Text>
        {detail !== undefined && detail.length > 0 ? <Text style={styles.rowDetail}>{detail}</Text> : null}
      </View>
      {selected !== undefined ? (
        <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      ) : null}
    </Pressable>
  );
}

/** The rows of a choice dialog; they scroll when there are more than fit. */
export function DialogRows({ children }: { children: ReactNode }) {
  const styles = useDialogStyles();
  return (
    <ScrollView style={styles.rowsScroll} contentContainerStyle={styles.rows} bounces={false}>
      {children}
    </ScrollView>
  );
}

/**
 * The destructive label: the theme's red, made readable only on the soft red tint it sits on in a dialog. The app-wide
 * `danger` is readable on every fill (bright pressed ones too), which washes it almost white in the dark themes.
 */
function dialogDangerLabel(appearance: Appearance): string {
  const panel = dialogSolidFill(appearance);
  // On a dark sheet the default red falls just short and mixing it toward the text turns it pink: the desktop's
  // brighter danger-row red (`MENU_DANGER`) reads as red and passes as it is.
  const hue = appearance.dangerHue ?? GhostexPalette.DANGER;
  const designed = !appearance.light && hue === GhostexPalette.DANGER ? SidebarPalette.MENU_DANGER : hue;
  return readableSecondaryText(designed, appearance.foreground, [
    colorOver(appearance.dangerFill, panel),
    colorOver(appearance.dangerFillPressed, panel),
    colorOver(appearance.neutralFill, panel),
  ]);
}

const createDialogStyles = (appearance: Appearance) =>
  StyleSheet.create({
    title: { color: appearance.foreground, fontSize: 17, lineHeight: 22, fontWeight: '600' },
    messageScroll: { flexGrow: 0, flexShrink: 1, marginTop: 6 },
    message: { color: colorWithOpacity(appearance.foreground, 74), fontSize: 14, lineHeight: 20 },
    messageMono: {
      color: appearance.foreground,
      fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
      fontSize: 13,
      backgroundColor: appearance.input,
      borderRadius: GhostexRadii.input,
      padding: 10,
      overflow: 'hidden',
    },
    buttons: { gap: 8, marginTop: 20 },
    button: {
      minHeight: 46,
      borderRadius: GhostexRadii.control,
      paddingHorizontal: 14,
      paddingVertical: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.neutralFill,
    },
    buttonPressed: { backgroundColor: appearance.neutralFillPressed },
    buttonPrimary: { backgroundColor: appearance.primaryFill },
    buttonPrimaryPressed: { backgroundColor: appearance.primaryFillPressed },
    buttonDestructive: { backgroundColor: appearance.dangerFill },
    buttonDestructivePressed: { backgroundColor: appearance.dangerFillPressed },
    buttonLabel: { color: appearance.foreground, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    buttonLabelDestructive: { color: dialogDangerLabel(appearance) },
    disabled: { opacity: 0.4 },
    rowsScroll: { flexGrow: 0, flexShrink: 1, marginTop: 14 },
    rows: { gap: 6 },
    row: {
      minHeight: 48,
      borderRadius: GhostexRadii.control,
      paddingHorizontal: 14,
      paddingVertical: 9,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: appearance.neutralFill,
    },
    rowText: { flex: 1, minWidth: 0 },
    rowLabel: { color: appearance.foreground, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: appearance.muted, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: appearance.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { borderColor: appearance.accent },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: appearance.accent },
  });
