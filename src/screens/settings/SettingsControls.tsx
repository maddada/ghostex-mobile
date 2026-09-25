/**
 * Building blocks shared by the Settings home and every Settings page. Colors
 * come from the current appearance (Settings > Theme), never the static palette.
 */

import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import SteppedSlider from '../../components/common/SteppedSlider';
import { useSettingsStore, type GhostexSettings } from '../../settings/store';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { useAppearanceHeader } from './useAppearanceHeader';

export type BooleanSettingKey = {
  [Key in keyof GhostexSettings]: GhostexSettings[Key] extends boolean ? Key : never;
}[keyof GhostexSettings];

const stylesByAppearance = new WeakMap<Appearance, ReturnType<typeof createSettingsStyles>>();

function createSettingsStyles(appearance: Appearance) {
  const card = {
    borderRadius: GhostexRadii.row,
    backgroundColor: appearance.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
  } as const;
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    list: {
      padding: 12,
      paddingBottom: 28,
      gap: 8,
    },
    intro: {
      color: appearance.muted,
      fontSize: 12,
      marginBottom: 4,
    },
    sectionHeader: {
      color: appearance.muted,
      fontSize: 12,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 14,
      marginBottom: 2,
      paddingHorizontal: 4,
    },
    caption: {
      color: appearance.muted,
      fontSize: 11,
      paddingHorizontal: 4,
    },
    card: {
      ...card,
      gap: 10,
      padding: 12,
    },
    row: {
      ...card,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 10,
    },
    rowPressed: {
      backgroundColor: appearance.cardActive,
    },
    rowDisabled: {
      opacity: 0.5,
    },
    rowLabel: {
      color: appearance.foreground,
      fontSize: 14,
      flex: 1,
    },
    /** A label sized to its text: stacked above a control, or a plain link row's title. */
    cardLabel: {
      color: appearance.foreground,
      fontSize: 14,
    },
    linkText: {
      flex: 1,
      gap: 2,
      paddingVertical: 6,
    },
    linkTitle: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '600',
    },
    linkDescription: {
      color: appearance.muted,
      fontSize: 12,
    },
    linkDescriptionAccent: {
      color: GhostexPalette.ACCENT,
    },
    chevron: {
      color: appearance.muted,
      fontSize: 22,
      lineHeight: 24,
    },
    value: {
      color: appearance.muted,
      fontSize: 14,
      fontVariant: ['tabular-nums'],
    },
    input: {
      minHeight: 40,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.row,
      backgroundColor: appearance.input,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      color: appearance.foreground,
      fontSize: 14,
    },
    radioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: appearance.control,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOuterSelected: {
      borderColor: GhostexPalette.ACCENT,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: GhostexPalette.ACCENT,
    },
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    stepperButton: {
      width: 32,
      height: 32,
      borderRadius: GhostexRadii.pill,
      backgroundColor: appearance.background,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepperButtonDisabled: {
      opacity: 0.4,
    },
    stepperGlyph: {
      color: appearance.foreground,
      fontSize: 18,
      lineHeight: 20,
    },
    stepperValue: {
      color: appearance.muted,
      fontSize: 14,
      minWidth: 44,
      textAlign: 'center',
    },
  });
}

/** Styles for the current appearance, shared by every control on screen. */
export function useSettingsStyles(): ReturnType<typeof createSettingsStyles> {
  const appearance = useAppearance();
  let styles = stylesByAppearance.get(appearance);
  if (styles === undefined) {
    styles = createSettingsStyles(appearance);
    stylesByAppearance.set(appearance, styles);
  }
  return styles;
}

/** A scrolling Settings screen whose page and header follow the appearance. */
export function SettingsScreenLayout({ intro, children }: { intro?: string; children: ReactNode }) {
  useAppearanceHeader();
  const styles = useSettingsStyles();
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps='handled'>
        {intro !== undefined ? <Text style={styles.intro}>{intro}</Text> : null}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function SectionHeader({ title }: { title: string }) {
  const styles = useSettingsStyles();
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

export function Caption({ children }: { children: ReactNode }) {
  const styles = useSettingsStyles();
  return <Text style={styles.caption}>{children}</Text>;
}

export function ToggleRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: appearance.control, true: GhostexPalette.ACCENT }}
        thumbColor={value ? appearance.foreground : appearance.controlThumb}
        ios_backgroundColor={appearance.control}
      />
    </View>
  );
}

/** A switch bound to one boolean setting. */
export function SettingToggle({ settingKey, label }: { settingKey: BooleanSettingKey; label: string }) {
  const value = useSettingsStore((state) => state.settings[settingKey]);
  const setSetting = useSettingsStore((state) => state.setSetting);
  return <ToggleRow label={label} value={value} onValueChange={(next) => setSetting(settingKey, next)} />;
}

export function ChoiceRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = useSettingsStyles();
  return (
    <Pressable accessibilityRole='radio' accessibilityState={{ selected }} style={styles.row} onPress={onPress}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
        {selected && <View style={styles.radioInner} />}
      </View>
    </Pressable>
  );
}

export function StepperRow({
  label,
  value,
  canDecrease,
  canIncrease,
  onStep,
  disabled = false,
}: {
  label: string;
  value: string;
  canDecrease: boolean;
  canIncrease: boolean;
  onStep: (delta: 1 | -1) => void;
  disabled?: boolean;
}) {
  const styles = useSettingsStyles();
  return (
    <View style={[styles.row, disabled && styles.rowDisabled]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          style={[styles.stepperButton, (disabled || !canDecrease) && styles.stepperButtonDisabled]}
          disabled={disabled || !canDecrease}
          onPress={() => onStep(-1)}
        >
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel={`Increase ${label.toLowerCase()}`}
          style={[styles.stepperButton, (disabled || !canIncrease) && styles.stepperButtonDisabled]}
          disabled={disabled || !canIncrease}
          onPress={() => onStep(1)}
        >
          <Text style={styles.stepperGlyph}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A row that opens another screen; `description` is the one-line summary under the title. */
export function LinkRow({
  title,
  description,
  descriptionAccent = false,
  onPress,
}: {
  title: string;
  description?: string;
  descriptionAccent?: boolean;
  onPress: () => void;
}) {
  const styles = useSettingsStyles();
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityHint={description}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.linkText}>
        <Text style={description !== undefined ? styles.linkTitle : styles.cardLabel}>{title}</Text>
        {description !== undefined ? (
          <Text style={[styles.linkDescription, descriptionAccent && styles.linkDescriptionAccent]}>
            {description}
          </Text>
        ) : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

/** A read-only label and value, such as the installed version. */
export function ValueRow({ label, value }: { label: string; value: string }) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

/** SteppedSlider in the current appearance. */
export function SettingsSlider(props: Omit<Parameters<typeof SteppedSlider>[0], 'appearance'>) {
  const appearance = useAppearance();
  return <SteppedSlider {...props} appearance={appearance} />;
}
