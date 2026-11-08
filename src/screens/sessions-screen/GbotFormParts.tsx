/**
 * The pieces the New GBot form (NewGbotSheet.tsx) and GBot Settings (GbotSettingsSheet.tsx) share: the card they sit
 * in, a labelled text field, the icon grid, the eight colours and a row of choice chips. The card is the New
 * Orchestrator sheet's (NewCoordinatorSheet.tsx), only taller.
 */

import { useMemo, type ReactElement, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useFoldCardPlacement } from '../../components/common/foldAvoidance';
import KeyboardAvoidingContainer from '../../components/common/keyboard/KeyboardAvoidingContainer';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import { GBOT_ICON_CHOICES, GbotIcon } from '../../components/sessions/gbotIcons';
import { GBOT_COLORS, gbotColorHex } from '../../contract/gbots';
import { GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

export function useGbotFormStyles(): { appearance: Appearance; styles: ReturnType<typeof createStyles> } {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  return { appearance, styles };
}

/** The sheet's card: a dimmed backdrop (a tap outside cancels), the scrolling content, then `footer`. */
export function GbotSheetCard({
  onCancel,
  children,
  footer,
}: {
  onCancel: () => void;
  children: ReactNode;
  footer: ReactNode;
}): ReactElement {
  const { styles } = useGbotFormStyles();
  const placement = useFoldCardPlacement({ avoidsKeyboard: true, belowSafeAreaTop: true });
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingContainer safeAreaTop style={styles.keyboardFill}>
        <Pressable style={[styles.backdrop, placement.style]} onPress={onCancel}>
          <Pressable style={styles.card} onLayout={placement.onCardLayout} onPress={(event) => event.stopPropagation()}>
            <KeyboardAwareScrollView contentContainerStyle={styles.cardContent}>
              {children}
              {footer}
            </KeyboardAwareScrollView>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingContainer>
    </Modal>
  );
}

export function GbotTextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  tall = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** The instructions' editor: taller than a description. */
  tall?: boolean;
  hint?: string;
}): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        keyboardAppearance={appearance.light ? 'light' : 'dark'}
        accessibilityLabel={label}
        style={[styles.input, multiline ? styles.multiline : null, tall ? styles.tall : null]}
        value={value}
        onChangeText={onChange}
        multiline={multiline}
        placeholder={placeholder}
        placeholderTextColor={appearance.muted}
        autoCapitalize={multiline ? 'sentences' : 'words'}
      />
      {hint !== undefined ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** The icons to pick from, the GBot's own first when it is not one of them. */
export function GbotIconPicker({
  value,
  color,
  onChange,
}: {
  value: string;
  color: string;
  onChange: (icon: string) => void;
}): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  const icons =
    GBOT_ICON_CHOICES.includes(value) || value.length === 0 ? GBOT_ICON_CHOICES : [value, ...GBOT_ICON_CHOICES];
  const tint = gbotColorHex(color);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Icon</Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Icon">
        {icons.map((icon) => {
          const on = icon === value;
          return (
            <Pressable
              key={icon}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={icon.replace(/-/g, ' ')}
              onPress={() => onChange(icon)}
              style={[styles.iconCell, on ? [styles.cellOn, { borderColor: tint }] : null]}
            >
              <GbotIcon icon={icon} color={on ? tint : appearance.muted} size={20} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function GbotColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (color: string) => void;
}): ReactElement {
  const { appearance, styles } = useGbotFormStyles();
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>Colour</Text>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Colour">
        {GBOT_COLORS.map((color) => {
          const on = color.id === value;
          return (
            <Pressable
              key={color.id}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={color.id}
              onPress={() => onChange(color.id)}
              style={[styles.swatchCell, on ? { borderColor: appearance.foreground } : null]}
            >
              <View style={[styles.swatch, { backgroundColor: color.hex }]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Pick one of a few, as chips that wrap (the agents a GBot can run on). */
export function GbotChoiceChips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  const { styles } = useGbotFormStyles();
  return (
    <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.value)}
            style={[styles.chip, on ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, on ? styles.chipTextOn : null]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    keyboardFill: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.6)',
    },
    backdrop: {
      flex: 1,
      justifyContent: 'center',
      padding: 16,
    },
    card: {
      backgroundColor: appearance.background,
      borderRadius: 12,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      maxHeight: '100%',
      overflow: 'hidden',
    },
    cardContent: {
      padding: 16,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    title: {
      flex: 1,
      color: appearance.foreground,
      fontSize: 17,
      fontWeight: 'bold',
    },
    body: {
      color: appearance.muted,
      fontSize: 12,
      marginTop: 8,
      lineHeight: 17,
    },
    tabs: {
      marginTop: 14,
    },
    field: {
      marginTop: 14,
    },
    fieldLabel: {
      color: appearance.muted,
      fontSize: 12,
      marginBottom: 4,
    },
    hint: {
      color: appearance.muted,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
    /** A hint that says something can't be done from here (the approval level above Ask). */
    warning: {
      color: appearance.foreground,
      fontSize: 12,
      lineHeight: 17,
      marginTop: 4,
    },
    input: {
      borderRadius: 8,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.input,
      color: appearance.foreground,
      paddingHorizontal: 12,
      paddingVertical: 8,
      fontSize: 15,
    },
    multiline: {
      minHeight: 72,
      maxHeight: 160,
      textAlignVertical: 'top',
    },
    tall: {
      minHeight: 220,
      maxHeight: 420,
    },
    value: {
      color: appearance.foreground,
      fontSize: 15,
    },
    notice: {
      marginTop: 14,
      padding: 12,
      borderRadius: 8,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    noticeTitle: {
      color: appearance.foreground,
      fontSize: 14,
      fontWeight: '600',
    },
    noticeBody: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    iconCell: {
      width: 40,
      height: 40,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
    },
    cellOn: {
      borderWidth: 2,
      backgroundColor: appearance.cardActive,
    },
    swatchCell: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: 'transparent',
    },
    swatch: {
      width: 26,
      height: 26,
      borderRadius: 13,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    chip: {
      borderRadius: 16,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
      paddingHorizontal: 12,
      paddingVertical: 7,
    },
    chipOn: {
      backgroundColor: appearance.cardActive,
      borderColor: appearance.foreground,
    },
    chipText: {
      color: appearance.muted,
      fontSize: 14,
    },
    chipTextOn: {
      color: appearance.foreground,
      fontWeight: '600',
    },
    error: {
      color: appearance.danger,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 14,
    },
    waiting: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 14,
    },
    loading: {
      marginTop: 16,
    },
    buttonRow: {
      flexDirection: 'row',
      marginTop: 16,
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      borderRadius: 8,
      backgroundColor: appearance.accent,
      alignItems: 'center',
      paddingVertical: 10,
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    primaryLabel: {
      color: appearance.accentForeground,
      fontSize: 14,
      fontWeight: '600',
    },
    cancelButton: {
      flex: 1,
      borderRadius: 8,
      backgroundColor: appearance.neutralFill,
      alignItems: 'center',
      paddingVertical: 10,
    },
    cancelButtonPressed: {
      backgroundColor: appearance.neutralFillPressed,
    },
    cancelLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
  });

/** Cancel and the sheet's own button (Save, Add GBot), with a spinner while it runs. */
export function GbotSheetButtons({
  primaryLabel,
  canPress,
  busy,
  onCancel,
  onPress,
  spinner,
}: {
  primaryLabel: string;
  canPress: boolean;
  busy: boolean;
  onCancel: () => void;
  onPress: () => void;
  spinner: ReactNode;
}): ReactElement {
  const { styles } = useGbotFormStyles();
  return (
    <View style={styles.buttonRow}>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.cancelButton, pressed && styles.cancelButtonPressed]}
        onPress={onCancel}
      >
        <Text style={styles.cancelLabel}>Cancel</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={!canPress}
        style={[styles.primaryButton, !canPress ? styles.buttonDisabled : null]}
        onPress={onPress}
      >
        {busy ? spinner : <Text style={styles.primaryLabel}>{primaryLabel}</Text>}
      </Pressable>
    </View>
  );
}
