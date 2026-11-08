/**
 * Building blocks shared by the Settings home and every Settings page. Colors
 * come from the current appearance (Settings > Interface), never the static palette.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type ScrollViewProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SwitchRow } from '../../components/common/SwitchRow';
import SteppedSlider from '../../components/common/SteppedSlider';
import { FoldListFrame } from '../../components/common/foldGap';
import KeyboardAwareScrollView from '../../components/common/keyboard/KeyboardAwareScrollView';
import type { HorizontalInsets } from '../../components/common/verticalBar/layout';
import { useLaptopFold } from '../../components/common/verticalBar/laptopFold';
import { useHeaderPlacement, useScrollToBarEdges } from '../../components/common/verticalBar/VerticalBarArea';
import { useSettingsStore, type GhostexSettings } from '../../settings/store';
import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { normalizeHexColor } from '../../theme/sidebarAppearance';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { useAppearanceHeader } from './useAppearanceHeader';

export type BooleanSettingKey = {
  [Key in keyof GhostexSettings]-?: GhostexSettings[Key] extends boolean ? Key : never;
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
      color: appearance.accent,
    },
    chevron: {
      color: appearance.mutedGlyph,
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
    segments: {
      flexDirection: 'row',
      height: 36,
      borderRadius: GhostexRadii.row,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    segmentDivider: {
      borderLeftWidth: GhostexStrokeWidth,
      borderLeftColor: appearance.border,
    },
    segmentOn: {
      backgroundColor: appearance.cardActive,
    },
    segmentText: {
      color: appearance.muted,
      fontSize: 14,
    },
    segmentTextOn: {
      color: appearance.foreground,
      fontWeight: '600',
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    hexInput: {
      width: 104,
      fontFamily: 'monospace',
    },
    hexSwatch: {
      width: 24,
      height: 24,
      borderRadius: 5,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
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
      borderColor: appearance.accent,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: appearance.accent,
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
 * stands beside the Settings list instead (`SettingsColumnsFrame`), in a
 * column narrower than this one. The 640 pt is this fallback, not the Settings layout.
 */
export const READABLE_COLUMN = { width: '100%', maxWidth: 640, alignSelf: 'center' } as const;

/**
 * The side bar's insets a Settings page's scroll view reaches over: both of them, or in two
 * columns only the one beside the page column (`SettingsColumnsFrame` provides it; the list column
 * takes the other).
 */
export const SettingsPageEdgesContext = createContext<HorizontalInsets | null>(null);

/**
 * A Settings page's scroll view (the pages' and the editors'): it spans the window under the side bar
 * and its content keeps its own padding clear of it; unchanged without a side bar.
 * `keyboardAware` for a page with text fields. Half folded like a laptop it ends above the fold (fold gap).
 */
export function SettingsPageScrollView({
  keyboardAware = false,
  style,
  contentContainerStyle,
  children,
  ...props
}: ScrollViewProps & { keyboardAware?: boolean }) {
  const edges = useScrollToBarEdges(contentContainerStyle, useContext(SettingsPageEdgesContext));
  const fold = useLaptopFold();
  const Scroll = keyboardAware ? KeyboardAwareScrollView : ScrollView;
  return (
    <FoldListFrame fold={fold}>
      <Scroll {...props} style={[style, edges.scroll]} contentContainerStyle={[contentContainerStyle, edges.content]}>
        {children}
      </Scroll>
    </FoldListFrame>
  );
}

/** A scrolling Settings screen whose page and header follow the appearance. */
/**
 * The open Settings page's one-line intro (`SETTINGS_PAGES[page].description`), drawn under its title
 * by `SettingsScreenLayout` unless the page passes its own.
 *
 * CDXC:Settings 2026-11-08 DECISION: User (Q1712 "Page title and line"): every Settings page shows its title with a one-line intro under it, on the desktop and on the phone's pages; the phone's lines are the ones its Settings list already shows (`pages.ts`).
 */
export const SettingsPageIntro = createContext<string | undefined>(undefined);

export function SettingsScreenLayout({ intro, children }: { intro?: string; children: ReactNode }) {
  useAppearanceHeader();
  const styles = useSettingsStyles();
  const pageIntro = useContext(SettingsPageIntro);
  const shownIntro = intro ?? pageIntro;
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
        {shownIntro !== undefined ? <Text style={styles.intro}>{shownIntro}</Text> : null}
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
  detail,
  value,
  onValueChange,
}: {
  label: string;
  /** A muted second line under the label. */
  detail?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <SwitchRow
      value={value}
      onValueChange={onValueChange}
      label={label}
      style={styles.row}
      pressedStyle={styles.rowPressed}
    >
      {detail === undefined ? (
        <Text style={styles.rowLabel}>{label}</Text>
      ) : (
        <View style={styles.rowText}>
          <Text style={styles.cardLabel}>{label}</Text>
          <Text style={styles.linkDescription}>{detail}</Text>
        </View>
      )}
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: appearance.control, true: appearance.accent }}
        thumbColor={value ? (appearance.light ? '#ffffff' : appearance.foreground) : appearance.controlThumb}
        ios_backgroundColor={appearance.control}
      />
    </SwitchRow>
  );
}

/** Pick exactly one of a few options, drawn as one bordered row of segments (as the chat's worktree tray). */
export function SegmentedRow<Value extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: Value; label: string }[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  const styles = useSettingsStyles();
  return (
    <View style={styles.segments} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option, index) => {
        const on = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            accessibilityLabel={option.label}
            onPress={() => {
              if (!on) onChange(option.value);
            }}
            style={[styles.segment, index > 0 ? styles.segmentDivider : null, on ? styles.segmentOn : null]}
          >
            <Text
              style={[styles.segmentText, on ? styles.segmentTextOn : null]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
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
  selected,
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
      // Only a list beside its page (two columns) has a selected row; a plain list reports no selection.
      accessibilityState={selected === undefined ? undefined : { selected }}
      style={({ pressed }) => [styles.row, (pressed || selected === true) && styles.rowPressed]}
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

/**
 * A `#rrggbb` colour typed as hex, with a swatch of the saved colour: a complete colour (with or without `#`) saves
 * at once; leaving a partial entry shows the saved value again. The custom theme tints and the custom terminal
 * background use it.
 */
export function HexColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  /** The saved colour, or `''` when none is set. */
  value: string;
  onChange: (hex: string) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const [draft, setDraft] = useState(value.toUpperCase());

  useEffect(() => {
    setDraft(value.toUpperCase());
  }, [value]);

  const colour = (text: string): string => normalizeHexColor(text, '');
  const commit = (): void => {
    const next = colour(draft);
    if (next === '') setDraft(value.toUpperCase());
    else if (next !== value) onChange(next);
  };

  return (
    <View style={styles.row}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.hexSwatch, value === '' ? null : { backgroundColor: value }]}
      />
      <Text style={styles.rowLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={`${label}, hex colour`}
        autoCapitalize="characters"
        autoCorrect={false}
        keyboardAppearance={appearance.light ? 'light' : 'dark'}
        maxLength={7}
        placeholder="#RRGGBB"
        placeholderTextColor={appearance.muted}
        returnKeyType="done"
        spellCheck={false}
        style={[styles.input, styles.hexInput]}
        value={draft}
        onBlur={commit}
        onChangeText={(next) => {
          setDraft(next);
          const hex = colour(next);
          if (hex !== '' && hex !== value) onChange(hex);
        }}
        onSubmitEditing={commit}
      />
    </View>
  );
}

/** SteppedSlider in the current appearance. */
export function SettingsSlider(props: Omit<Parameters<typeof SteppedSlider>[0], 'appearance'>) {
  const appearance = useAppearance();
  return <SteppedSlider {...props} appearance={appearance} />;
}
