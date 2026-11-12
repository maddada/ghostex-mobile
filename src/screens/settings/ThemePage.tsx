/**
 * Settings › Interface: the desktop's theme controls in its order, where they make sense on a phone. Presets, then
 * Colours (Appearance, Dark mode colour, Light mode colour, Colourfulness and the separate sidebar and work area
 * sliders), then Chat theme, Terminal theme and the terminal palettes.
 *
 * CDXC:Theming DECISION: the phone copies the Mac app's theme functions, presets included. The controls write the desktop's keys through
 * the settings store; a preset is one save, and the card whose always-written keys still hold shows as selected
 * (presets.ts). Picking a colour square or preset of one appearance, or typing its custom tint, marks it picked on
 * purpose for as long as the page stays open, which stops the other appearance's colour from following
 * (`select_preset`, `theme_preset_choice` in the desktop's settings_modal/tabs/theme). The squares show their own
 * tint; the desktop's Pick Color dialog is a hex field here, and the desktop-only rows (fonts, transparency, the pane
 * outline, the terminal config file) are left out.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import type { RootStackParamList } from '../../navigation/types';
import { defaultSettings, useSettingsStore, type GhostexSettings } from '../../settings/store';
import { GhosttyImportError, importGhosttyTheme } from '../../theme/importGhostty';
import { colorWithOpacity, GhostexStrokeWidth } from '../../theme/palette';
import {
  THEME_PRESET_FAMILIES,
  THEME_PRESETS,
  themePresetMatches,
  themePresetPatch,
  type ThemePreset,
} from '../../theme/presets';
import {
  areaColourfulnessPatch,
  COLOURFULNESS_LAST_POSITION,
  colourfulnessDisplayStep,
  colourfulnessName,
  colourfulnessPatch,
  colourfulnessPoints,
  colourfulnessStepForPoints,
  colourfulnessStepIndex,
  CONTENT_COLOR_SCHEMES,
  resolveThemeAreas,
  sidebarAppearanceFor,
  themeColourPatch,
  themeColoursPaired,
  themeSquares,
  type ContentColorScheme,
  type DarkThemePreset,
  type LightThemePreset,
  type SidebarThemeSetting,
} from '../../theme/sidebarAppearance';
import { terminalPaletteLabel } from '../../theme/terminalPalettes';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { SettingsSection } from './SectionBoundary';
import {
  Caption,
  ChoiceRow,
  HexColourField,
  LinkRow,
  SectionHeader,
  SettingsScreenLayout,
  SettingsSlider,
  ToggleRow,
  useSettingsStyles,
  ValueRow,
} from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';

/** Which appearance had a colour or preset picked on purpose since the page opened (`pickedOnPurpose`). */
type Picked = { dark: boolean; light: boolean };

/** Appearance's three cards in the desktop's order (`APPEARANCE_CHOICES`). */
const APPEARANCE_CHOICES: ReadonlyArray<{ value: SidebarThemeSetting; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'plain-light', label: 'Light' },
  { value: 'dark-2', label: 'Dark' },
];

/** `SESSION_CHAT_THEME_OPTIONS`, for Chat theme and Terminal theme alike. */
const CONTENT_SCHEME_LABELS: Readonly<Record<ContentColorScheme, string>> = {
  app: 'Follow app',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Each preset as its card draws it: its own patch over the defaults, in its own appearance (`preview_colours`). */
const PRESET_PREVIEWS: ReadonlyMap<string, { sidebar: string; work: string; ink: string }> = new Map(
  THEME_PRESETS.map((preset) => {
    const areas = resolveThemeAreas(
      { ...defaultSettings(), ...preset.patches.lightPickedOnPurpose },
      preset.mode === 'light',
    );
    return [
      preset.id,
      { sidebar: areas.sidebar, work: areas.workArea, ink: sidebarAppearanceFor(areas.workArea).foreground },
    ];
  }),
);

function ModeGlyph({ dark, size, color }: { dark: boolean; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {dark ? (
        <Path
          d="M 15 3.5 A 8.5 8.5 0 1 0 20.5 15 A 7 7 0 0 1 15 3.5 Z"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
        />
      ) : (
        <>
          <Circle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} />
          <Path
            d="M 12 2.5 v 2 M 12 19.5 v 2 M 2.5 12 h 2 M 19.5 12 h 2 M 5.3 5.3 l 1.4 1.4 M 17.3 17.3 l 1.4 1.4 M 5.3 18.7 l 1.4 -1.4 M 17.3 6.7 l 1.4 -1.4"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        </>
      )}
    </Svg>
  );
}

function PresetCard({
  preset,
  selected,
  appearance,
  onPress,
}: {
  preset: ThemePreset;
  selected: boolean;
  appearance: Appearance;
  onPress: () => void;
}) {
  const preview = PRESET_PREVIEWS.get(preset.id)!;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${preset.name}, ${preset.mode} preset`}
      accessibilityState={{ selected }}
      style={styles.presetCard}
      onPress={onPress}
    >
      <View>
        <View style={[styles.presetArt, { borderColor: colorWithOpacity(appearance.foreground, 10) }]}>
          <View style={[styles.presetSidebar, { backgroundColor: preview.sidebar }]} />
          <View
            style={[
              styles.presetWork,
              { backgroundColor: preview.work, borderLeftColor: colorWithOpacity(preview.ink, 8) },
            ]}
          >
            <View style={[styles.presetLine, { width: '80%', backgroundColor: colorWithOpacity(preview.ink, 80) }]} />
            <View style={[styles.presetLine, { width: '55%', backgroundColor: colorWithOpacity(preview.ink, 45) }]} />
            <View style={styles.presetDots}>
              {preset.swatch.map((colour, index) => (
                <View key={index} style={[styles.presetDot, { backgroundColor: colour }]} />
              ))}
            </View>
          </View>
        </View>
        {selected ? (
          <View style={[styles.presetRing, { borderColor: colorWithOpacity(appearance.foreground, 85) }]} />
        ) : null}
      </View>
      <View style={styles.presetName}>
        <ModeGlyph dark={preset.mode === 'dark'} size={11} color={appearance.mutedGlyph} />
        <Text
          numberOfLines={2}
          style={[
            styles.presetLabel,
            selected ? { color: appearance.foreground, fontWeight: '500' } : { color: appearance.muted },
          ]}
        >
          {preset.label}
        </Text>
      </View>
    </Pressable>
  );
}

function PresetsSection({ picked, onPicked }: { picked: Picked; onPicked: (dark: boolean) => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const patchSettings = useSettingsStore((state) => state.patchSettings);
  const appearance = useAppearance();

  return (
    <>
      <SectionHeader title="Presets" />
      <Caption>Sets the colours below together. You can change each of them afterwards.</Caption>
      <ScrollView
        horizontal
        accessibilityLabel="Presets"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.families}
      >
        {THEME_PRESET_FAMILIES.map(({ family, presets }) => (
          <View key={family} style={styles.family}>
            <Text style={[styles.familyName, { color: appearance.muted }]}>{family.toUpperCase()}</Text>
            <View style={styles.familyCards}>
              {presets.map((preset) => (
                <PresetCard
                  key={preset.id}
                  preset={preset}
                  selected={themePresetMatches(settings, preset)}
                  appearance={appearance}
                  onPress={() => {
                    patchSettings(themePresetPatch(preset.id, picked.light)!);
                    onPicked(preset.mode === 'dark');
                  }}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </>
  );
}

/** A small window in one appearance's colours: its sidebar and work area. */
function MiniWindow({ settings, light }: { settings: GhostexSettings; light: boolean }) {
  const areas = resolveThemeAreas(settings, light);
  return (
    <View style={styles.miniWindow}>
      <View style={[styles.miniSidebar, { backgroundColor: areas.sidebar }]} />
      <View style={[styles.miniWork, { backgroundColor: areas.workArea }]} />
    </View>
  );
}

function AppearanceRow() {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();

  return (
    <SettingsSearchAnchor label="Appearance">
      <View style={settingsStyles.card}>
        <Text style={settingsStyles.cardLabel}>Appearance</Text>
        <Caption>System follows your phone’s light or dark mode.</Caption>
        <View style={styles.appearanceCards}>
          {APPEARANCE_CHOICES.map((choice) => {
            const selected = settings.sidebarTheme === choice.value;
            return (
              <Pressable
                key={choice.value}
                accessibilityRole="radio"
                accessibilityLabel={`${choice.label} appearance`}
                accessibilityState={{ selected }}
                style={styles.appearanceCard}
                onPress={() => setSetting('sidebarTheme', choice.value)}
              >
                <View
                  style={[
                    styles.appearanceArt,
                    { borderColor: selected ? colorWithOpacity(appearance.foreground, 85) : appearance.border },
                    selected ? styles.appearanceArtSelected : null,
                  ]}
                >
                  {choice.value !== 'dark-2' ? <MiniWindow settings={settings} light /> : null}
                  {choice.value !== 'plain-light' ? <MiniWindow settings={settings} light={false} /> : null}
                </View>
                <Text style={[styles.appearanceLabel, { color: selected ? appearance.foreground : appearance.muted }]}>
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </SettingsSearchAnchor>
  );
}

/** Dark mode colour or Light mode colour: the sixteen squares and the custom colour, with its hex field. */
function ColourRow({ dark, picked, onPicked }: { dark: boolean; picked: Picked; onPicked: (dark: boolean) => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const patchSettings = useSettingsStore((state) => state.patchSettings);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();
  const mode = dark ? 'dark' : 'light';
  const selected = dark ? settings.darkThemePreset : settings.lightThemePreset;
  const tintKey = dark ? 'customSidebarTitlebarBackgroundTintColor' : 'customSidebarTitlebarLightBackgroundTintColor';
  const squares = themeSquares(!dark);
  const pickedHere = dark ? picked.dark : picked.light;
  const otherPicked = dark ? picked.light : picked.dark;
  // Light mode follows the dark pick until a light colour is picked on purpose; dark mode follows only when light was
  // picked first.
  const follows = themeColoursPaired(settings, dark) && !pickedHere && (!dark || otherPicked);
  const name = selected === 'custom' ? 'Custom' : (squares.find((square) => square.id === selected)?.label ?? selected);
  const choose = (preset: DarkThemePreset | LightThemePreset): void => {
    patchSettings(themeColourPatch(settings, dark, preset, otherPicked));
    onPicked(dark);
  };

  const square = (id: string, label: string, fill: string | null, isSelected: boolean, onPress: () => void) => (
    <Pressable
      key={id}
      accessibilityRole="radio"
      accessibilityLabel={`${label}, ${mode} mode colour`}
      accessibilityState={{ selected: isSelected }}
      hitSlop={4}
      style={[styles.squareFrame, isSelected ? { borderColor: appearance.foreground } : null]}
      onPress={onPress}
    >
      <View
        style={[styles.square, { borderColor: appearance.border }, fill === null ? null : { backgroundColor: fill }]}
      >
        {fill === null ? <Text style={[styles.squarePlus, { color: appearance.mutedGlyph }]}>+</Text> : null}
      </View>
    </Pressable>
  );

  return (
    <SettingsSearchAnchor label={dark ? 'Dark mode colour' : 'Light mode colour'}>
      <View style={settingsStyles.card}>
        <View style={styles.colourHeader}>
          <Text style={settingsStyles.cardLabel}>{dark ? 'Dark mode colour' : 'Light mode colour'}</Text>
          <Text style={[styles.readout, { color: appearance.muted }]}>
            {follows ? `${name} · follows ${dark ? 'light' : 'dark'} mode` : name}
          </Text>
        </View>
        <Caption>
          {dark
            ? 'The colour of the app in dark mode. Picking one gives light mode the same colour until you pick one there. The + square takes any tint.'
            : 'The colour of the app in light mode. It follows the dark mode colour until you pick one here. The + square takes any tint.'}
        </Caption>
        <View style={styles.squares}>
          {squares.map((entry) =>
            square(entry.id, entry.label, entry.tint, selected === entry.id, () => choose(entry.id)),
          )}
          {square('custom', 'Custom', selected === 'custom' ? settings[tintKey] : null, selected === 'custom', () =>
            choose('custom'),
          )}
        </View>
        {selected === 'custom' ? (
          <HexColourField
            label="Custom tint"
            value={settings[tintKey]}
            // Typing a tint is picking this appearance's colour on purpose, as the desktop's picker records it
            // (tabs/theme/mod.rs `picked_light`), so a later preset of the other appearance leaves it alone.
            onChange={(hex) => {
              patchSettings({ [tintKey]: hex });
              onPicked(dark);
            }}
          />
        ) : null}
      </View>
    </SettingsSearchAnchor>
  );
}

/** Colourfulness, and the sidebar and work area set apart (the desktop's More colour options). */
function ColourfulnessRows() {
  const settings = useSettingsStore((state) => state.settings);
  const patchSettings = useSettingsStore((state) => state.patchSettings);
  const [split, setSplit] = useState(
    () =>
      settings.themeSidebarContrast !== settings.themeWorkAreaContrast ||
      colourfulnessStepForPoints(settings.themeSidebarContrast) === null,
  );
  const step = colourfulnessStepIndex(settings);

  return (
    <>
      {step === null ? (
        <ValueRow label="Colourfulness" value="Set per area" />
      ) : (
        <SettingsSlider
          label="Colourfulness"
          minimumValue={0}
          maximumValue={COLOURFULNESS_LAST_POSITION}
          step={1}
          value={step}
          valueLabel={colourfulnessName(colourfulnessPoints(step))}
          rangeLabels={['Subtle', 'Full']}
          onValueChange={(next) => patchSettings(colourfulnessPatch(next))}
        />
      )}
      <Caption>
        How much of the colour shows in the sidebar and work area. Subtle is deeper and nearly neutral, Vivid lighter
        and more colourful, and Full is the colour you picked itself.
      </Caption>
      <ToggleRow
        label="Set the sidebar and work area separately"
        value={split}
        onValueChange={(checked) => {
          setSplit(checked);
          if (!checked) patchSettings(colourfulnessPatch(colourfulnessDisplayStep(settings.themeSidebarContrast)));
        }}
      />
      <Caption>Off: one Colourfulness for both.</Caption>
      {split
        ? (
            [
              ['themeSidebarContrast', 'Sidebar colourfulness'],
              ['themeWorkAreaContrast', 'Work area colourfulness'],
            ] as const
          ).map(([key, label]) => {
            const position = colourfulnessDisplayStep(settings[key]);
            return (
              <SettingsSlider
                key={key}
                label={label}
                minimumValue={0}
                maximumValue={COLOURFULNESS_LAST_POSITION}
                step={1}
                value={position}
                valueLabel={colourfulnessName(colourfulnessPoints(position))}
                rangeLabels={['Subtle', 'Full']}
                onValueChange={(next) => patchSettings(areaColourfulnessPatch(key, next))}
              />
            );
          })
        : null}
    </>
  );
}

function ContentSchemeRows({
  settingKey,
  title,
  caption,
}: {
  settingKey: 'sessionChatTheme' | 'terminalColorScheme';
  title: string;
  caption: string;
}) {
  const value = useSettingsStore((state) => state.settings[settingKey]);
  const setSetting = useSettingsStore((state) => state.setSetting);
  return (
    <>
      <SectionHeader title={title} />
      {CONTENT_COLOR_SCHEMES.map((scheme) => (
        <ChoiceRow
          key={scheme}
          label={CONTENT_SCHEME_LABELS[scheme]}
          selected={value === scheme}
          onPress={() => setSetting(settingKey, scheme)}
        />
      ))}
      <Caption>{caption}</Caption>
    </>
  );
}

function TerminalPaletteRows() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const dark = useSettingsStore((state) => state.settings.terminalGhosttyTheme);
  const light = useSettingsStore((state) => state.settings.terminalGhosttyLightTheme);
  const hydrated = useSettingsStore((state) => state.hydrated);
  const settingsStyles = useSettingsStyles();
  const [importing, setImporting] = useState(false);
  const picking = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const importPalette = async (): Promise<void> => {
    if (picking.current || !hydrated) return;
    picking.current = true;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (asset === undefined || !asset.uri.startsWith('file://')) {
        throw new Error('No local file');
      }
      const file = new File(asset.uri);
      let text: string;
      try {
        if (!active.current) return;
        text = await file.text();
      } finally {
        // The picker supplied a cache copy, never the document provider's original file.
        file.delete();
      }
      if (!active.current) return;
      const state = useSettingsStore.getState();
      const next = importGhosttyTheme(state.settings, text, asset.name);
      state.patchSettings({ importedTerminalPalettes: next.importedTerminalPalettes });
      Alert.alert('Palette imported', 'Choose it in the terminal palette list for dark or light mode.');
    } catch (error) {
      if (active.current) {
        Alert.alert(
          'Cannot import palette',
          error instanceof GhosttyImportError
            ? error.message
            : 'The file could not be read. Choose a local Ghostty theme file and try again.',
        );
      }
    } finally {
      picking.current = false;
      if (active.current) setImporting(false);
    }
  };
  return (
    <>
      <SectionHeader title="Terminal palettes" />
      <LinkRow
        title="Terminal palette in dark mode"
        description={terminalPaletteLabel(dark)}
        onPress={() => navigation.navigate('SettingsPage', { page: 'terminalPaletteDark' })}
      />
      <LinkRow
        title="Terminal palette in light mode"
        description={terminalPaletteLabel(light)}
        onPress={() => navigation.navigate('SettingsPage', { page: 'terminalPaletteLight' })}
      />
      <Caption>The terminal colours in dark mode and in light mode.</Caption>
      <SettingsSearchAnchor label="Import Ghostty theme">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Import Ghostty theme"
          accessibilityState={{ disabled: !hydrated || importing, busy: importing }}
          disabled={!hydrated || importing}
          onPress={() => void importPalette()}
          style={({ pressed }) => [
            settingsStyles.row,
            pressed && settingsStyles.rowPressed,
            (!hydrated || importing) && settingsStyles.rowDisabled,
          ]}
        >
          <View style={settingsStyles.linkText}>
            <Text style={settingsStyles.linkTitle}>Import Ghostty theme</Text>
            <Text style={settingsStyles.linkDescription}>
              {importing ? 'Reading file…' : 'Add a private terminal palette from a local file.'}
            </Text>
          </View>
        </Pressable>
      </SettingsSearchAnchor>
    </>
  );
}

export default function ThemePage() {
  // Reset whenever the page opens: a page is a new mount each time it is opened.
  const [picked, setPicked] = useState<Picked>({ dark: false, light: false });
  const onPicked = (dark: boolean): void =>
    setPicked((current) => (dark ? { ...current, dark: true } : { ...current, light: true }));

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:theme:presets">
        <PresetsSection picked={picked} onPicked={onPicked} />
      </SettingsSection>
      <SettingsSection name="settings:theme:colours">
        <SectionHeader title="Colours" />
        <Caption>The colour of the app in each mode.</Caption>
        <AppearanceRow />
        <ColourRow dark picked={picked} onPicked={onPicked} />
        <ColourRow dark={false} picked={picked} onPicked={onPicked} />
        <ColourfulnessRows />
      </SettingsSection>
      <SettingsSection name="settings:theme:chat-terminal">
        <ContentSchemeRows
          settingKey="sessionChatTheme"
          title="Chat theme"
          caption="Follow the app theme, or choose a separate appearance for chat."
        />
        <ContentSchemeRows
          settingKey="terminalColorScheme"
          title="Terminal theme"
          caption="Follow the app theme, or choose a separate appearance for terminals."
        />
        <TerminalPaletteRows />
      </SettingsSection>
    </SettingsScreenLayout>
  );
}

const styles = StyleSheet.create({
  families: {
    gap: 20,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  family: {
    gap: 8,
  },
  familyName: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  familyCards: {
    flexDirection: 'row',
    gap: 8,
  },
  presetCard: {
    width: 84,
    gap: 5,
  },
  presetArt: {
    height: 52,
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
  },
  presetSidebar: {
    width: 22,
  },
  presetWork: {
    flex: 1,
    gap: 4,
    paddingHorizontal: 7,
    paddingTop: 7,
    borderLeftWidth: 1,
  },
  presetLine: {
    height: 3,
    borderRadius: 2,
  },
  presetDots: {
    flexDirection: 'row',
    gap: 3,
    marginTop: 4,
  },
  presetDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  presetRing: {
    position: 'absolute',
    top: -3.5,
    left: -3.5,
    right: -3.5,
    bottom: -3.5,
    borderRadius: 10.5,
    borderWidth: 1.5,
  },
  presetName: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 3,
  },
  presetLabel: {
    flex: 1,
    fontSize: 11,
    lineHeight: 13,
  },
  appearanceCards: {
    flexDirection: 'row',
    gap: 12,
  },
  appearanceCard: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  appearanceArt: {
    width: '100%',
    height: 56,
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    overflow: 'hidden',
  },
  appearanceArtSelected: {
    borderWidth: 2,
  },
  miniWindow: {
    flex: 1,
    flexDirection: 'row',
  },
  miniSidebar: {
    width: '34%',
  },
  miniWork: {
    flex: 1,
  },
  appearanceLabel: {
    fontSize: 13,
  },
  colourHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  readout: {
    flexShrink: 1,
    fontSize: 12,
    textAlign: 'right',
  },
  squares: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  squareFrame: {
    padding: 2,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  square: {
    width: 28,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  squarePlus: {
    fontSize: 18,
    lineHeight: 20,
  },
});
