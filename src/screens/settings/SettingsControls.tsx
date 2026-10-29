/**
 * Building blocks shared by the Settings home and every Settings page. Colors
 * come from the current appearance (Settings > Theme), never the static palette.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import SteppedSlider from '../../components/common/SteppedSlider';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import type { HorizontalInsets } from '../../components/common/verticalBar/layout';
import { useHeaderPlacement, useScrollToBarEdges } from '../../components/common/verticalBar/VerticalBarArea';
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

/**
 * One-column Settings pages keep a readable column of at most 640 pt, centred, wherever the app's header
 * stands in the Duo's chrome (status band or side bar), so a wide single column (the unfolded Duo in
 * portrait) is not stretched across the window; regular iPhones stay as they were, and a window
 * narrower than the column is not affected. Where the window holds the list and a page the page
 * stands beside the Settings list instead (owner decision F2, 2026-10-26: `SettingsColumnsFrame`), in a
 * column narrower than this one. The 640 pt of the S1 mockup is this fallback, not the Settings layout.
 */
const READABLE_COLUMN = { width: '100%', maxWidth: 640, alignSelf: 'center' } as const;

/**
 * The side bar's insets a Settings page's scroll view reaches over (FL-LAY-05): both of them, or in two
 * columns only the one beside the page column (`SettingsColumnsFrame` provides it; the list column
 * takes the other).
 */
export const SettingsPageEdgesContext = createContext<HorizontalInsets | null>(null);

/**
 * A Settings page's scroll view (the pages' and the editors'): it spans the window under the side bar
 * and its content keeps its own padding clear of it (FL-LAY-05); unchanged without a side bar.
 * `keyboardAware` for a page with text fields.
 */
export function SettingsPageScrollView({
  keyboardAware = false,
  style,
  contentContainerStyle,
  children,
  ...props
}: ScrollViewProps & { keyboardAware?: boolean }) {
  const edges = useScrollToBarEdges(contentContainerStyle, useContext(SettingsPageEdgesContext));
  const Scroll = keyboardAware ? KeyboardAwareScrollView : ScrollView;
  return (
    <Scroll {...props} style={[style, edges.scroll]} contentContainerStyle={[contentContainerStyle, edges.content]}>
      {children}
    </Scroll>
  );
}

/** A scrolling Settings screen whose page and header follow the appearance. */
export function SettingsScreenLayout({ intro, children }: { intro?: string; children: ReactNode }) {
  useAppearanceHeader();
  const styles = useSettingsStyles();
  // The iPhone Duo's chrome (status band, side bar) gives the pages wide windows (unfolded, landscape):
  // they keep a readable column there, as on any wide screen. Narrower windows are unaffected.
  const readable = useHeaderPlacement().kind !== 'top';
  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <SettingsPageScrollView
        keyboardAware
        contentContainerStyle={[styles.list, readable ? READABLE_COLUMN : null]}
        keyboardShouldPersistTaps="handled"
      >
        {intro !== undefined ? <Text style={styles.intro}>{intro}</Text> : null}
        {children}
      </SettingsPageScrollView>
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
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} style={styles.row} onPress={onPress}>
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
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label.toLowerCase()}`}
          style={[styles.stepperButton, (disabled || !canDecrease) && styles.stepperButtonDisabled]}
          disabled={disabled || !canDecrease}
          onPress={() => onStep(-1)}
        >
          <Text style={styles.stepperGlyph}>−</Text>
        </Pressable>
        <Text style={styles.stepperValue}>{value}</Text>
        <Pressable
          accessibilityRole="button"
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
  selected = false,
  onPress,
}: {
  title: string;
  description?: string;
  descriptionAccent?: boolean;
  /** The page open beside the list (Settings in two columns). */
  selected?: boolean;
  onPress: () => void;
}) {
  const styles = useSettingsStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={description}
      accessibilityState={{ selected }}
      style={({ pressed }) => [styles.row, (pressed || selected) && styles.rowPressed]}
      onPress={onPress}
    >
      <View style={styles.linkText}>
        <Text style={description !== undefined ? styles.linkTitle : styles.cardLabel}>{title}</Text>
        {description !== undefined ? (
          <Text style={[styles.linkDescription, descriptionAccent && styles.linkDescriptionAccent]}>{description}</Text>
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
