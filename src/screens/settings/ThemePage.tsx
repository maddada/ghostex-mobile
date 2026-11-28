/**
 * Settings > Themes: full desktop-matching Themes screen.
 *
 * Order matches desktop Settings > Themes (commits 8ac98a01d, 5ce4a5f7d, 67eb86437):
 * 1. Compact live mini-chat preview (with dimmed still artwork backdrop behind the card)
 * 2. Copy from a computer (one-time copy with live swatch preview over chatMachineLink + SSH fallback)
 * 3. Appearance mode (System / Dark / Light)
 * 4. Themes strip (Default, Moonwater, Polar with blue accents, remaining Art themes & still-art looks)
 * 5. Artwork strip (None + 32 on-demand artworks) + Show artwork toggle + Dimming slider
 * 6. Dark and Light subtle OKLCH colour swatches + uncapped Custom hex + Colourfulness
 * 7. Fine-tune accents & fills (all 18 desktop themeRoles, uncapped)
 * 8. Named presets, Chat theme, Terminal theme, Terminal palettes, Import Ghostty theme, and Reset to default
 *
 * Window transparency stays desktop-only.
 */

import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

import { Glyph } from '../../chat/native/cards/icons';
import { useTranscriptTheme } from '../../chat/native/transcript/theme';
import { useTwoColumns } from '../../components/common/verticalBar/VerticalBarArea';
import type { RootStackParamList } from '../../navigation/types';
import { defaultSettings, useSettingsStore, type GhostexSettings } from '../../settings/store';
import { isAppearanceSyncActive } from '../../settingsSync/appearanceSync';
import { patchThemeSettings } from '../../settingsSync/settingsSync';
import { useSyncedEntriesStore } from '../../settingsSync/syncedEntries';
import {
  artworkById,
  artworkThumbSource,
  isKnownArtworkId,
  THEME_ARTWORKS,
  YOUR_IMAGE_ART_ID,
  type ThemeArtwork,
} from '../../theme/artworks';
import { GhosttyImportError, importGhosttyTheme } from '../../theme/importGhostty';
import { colorWithOpacity, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import {
  THEME_PRESET_FAMILIES,
  THEME_PRESETS,
  themePresetMatches,
  themePresetPatch,
  type ThemePreset,
} from '../../theme/presets';
import { ScreenArtBackdrop } from '../../theme/ScreenArtBackdrop';
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
import {
  ALL_THEME_LOOKS,
  QUICK_ACCENT_SWATCHES,
  resetThemeToDefaultPatch,
  themeLookMatches,
  themeLookPatch,
  type ThemeLook,
} from '../../theme/themeLooks';
import {
  countThemeRoleOverrides,
  parseRoleValue,
  resolveRoleOverBase,
  rolesForAppearance,
  setThemeRole,
  STAGE1_PRESET_TINTS,
  THEME_ROLES,
  type ThemeRoleDefinition,
  type ThemeRoleId,
} from '../../theme/themeRoles';
import { useAppearance, type Appearance } from '../../theme/useAppearance';
import { CopyComputerThemeSheet } from './CopyComputerThemeSheet';
import { SettingsSection } from './SectionBoundary';
import {
  Caption,
  ChoiceRow,
  HexColourField,
  LinkRow,
  SectionHeader,
  SegmentedRow,
  SettingsScreenLayout,
  SettingsSlider,
  ToggleRow,
  useSettingsStyles,
  ValueRow,
} from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';
import { showAlert } from '../../components/common/dialog/alert';

/** Which appearance had a colour or preset picked on purpose since the page opened (`pickedOnPurpose`). */
type Picked = { dark: boolean; light: boolean };

/** Appearance mode choices in desktop/mockup order: System, Dark, Light. */
const APPEARANCE_CHOICES: ReadonlyArray<{ value: SidebarThemeSetting; label: string }> = [
  { value: 'system', label: 'System' },
  { value: 'dark-2', label: 'Dark' },
  { value: 'plain-light', label: 'Light' },
];

const CONTENT_SCHEME_LABELS: Readonly<Record<ContentColorScheme, string>> = {
  app: 'Follow app',
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Primary chat & chrome roles shown directly in the Fine-tune card; the rest sit under More theme colours. */
const PRIMARY_ROLE_IDS: readonly ThemeRoleId[] = [
  'userMessage',
  'chatBox',
  'surface',
  'border',
  'text',
  'mutedText',
  'link',
  'codeBlock',
];

const PRIMARY_ROLES: readonly ThemeRoleDefinition[] = PRIMARY_ROLE_IDS.map(
  (id) => THEME_ROLES.find((role) => role.id === id)!,
);
const EXTRA_ROLES: readonly ThemeRoleDefinition[] = THEME_ROLES.filter(
  (role) => role.id !== 'accent' && !PRIMARY_ROLE_IDS.includes(role.id),
);

/** Each named preset preview using Stage 1 subtle tint overrides where present. */
const PRESET_PREVIEWS: ReadonlyMap<string, { sidebar: string; work: string; ink: string }> = new Map(
  THEME_PRESETS.map((preset) => {
    const stage1 = STAGE1_PRESET_TINTS[preset.id];
    const patch = {
      ...preset.patches.lightPickedOnPurpose,
      ...(stage1 !== undefined
        ? preset.mode === 'dark'
          ? { customSidebarTitlebarBackgroundTintColor: stage1.tintColor }
          : { customSidebarTitlebarLightBackgroundTintColor: stage1.tintColor }
        : {}),
    };
    const areas = resolveThemeAreas({ ...defaultSettings(), ...patch }, preset.mode === 'light');
    return [
      preset.id,
      { sidebar: areas.sidebar, work: areas.workArea, ink: sidebarAppearanceFor(areas.workArea).foreground },
    ];
  }),
);

function activeThemeBadge(settings: GhostexSettings, light: boolean): string {
  const matchedLook = ALL_THEME_LOOKS.find((look) => themeLookMatches(settings, look));
  if (matchedLook !== undefined) return matchedLook.badge;
  const matchedPreset = THEME_PRESETS.find((preset) => themePresetMatches(settings, preset));
  if (matchedPreset !== undefined) return `${matchedPreset.label} · Preset`;
  const preset = light ? settings.lightThemePreset : settings.darkThemePreset;
  if (preset === 'custom') return 'Custom · Uncapped';
  const sq = themeSquares(light).find((entry) => entry.id === preset);
  return `${sq?.label ?? 'Graphite'} · Subtle`;
}

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

/** Compact live mini-chat preview at the top of Settings > Themes, showing the still artwork backdrop behind it. */
function LiveMiniChatPreview() {
  const settings = useSettingsStore((state) => state.settings);
  const appearance = useAppearance();
  const chatTheme = useTranscriptTheme();
  const badge = activeThemeBadge(settings, appearance.light);
  const activeArtId = chatTheme.light ? settings.windowArtLight : settings.windowArt;
  const hasArt = settings.showHeaderArtworkBackdrop && isKnownArtworkId(activeArtId);
  const art = hasArt ? artworkById(activeArtId) : undefined;

  return (
    <View
      accessibilityLabel={`Live preview: ${badge}`}
      style={[
        styles.previewCard,
        {
          backgroundColor: chatTheme.background,
          borderColor: chatTheme.border,
        },
      ]}
    >
      <ScreenArtBackdrop baseColor={chatTheme.background} area="preview" lightOverride={chatTheme.light} />
      <View
        style={[
          styles.previewHeader,
          {
            backgroundColor: hasArt ? 'transparent' : appearance.background,
            borderBottomColor: chatTheme.border,
          },
        ]}
      >
        <Text style={[styles.previewTitle, { color: appearance.foreground }]} numberOfLines={1}>
          Live preview
        </Text>
        <Text style={[styles.previewBadge, { color: appearance.accent }]} numberOfLines={1}>
          {art !== undefined ? `${badge} · ${settings.windowArtDim}% dim` : badge}
        </Text>
      </View>

      <View style={styles.previewBody}>
        <View style={[styles.previewBubble, { backgroundColor: chatTheme.userBubble }]}>
          <Text style={[styles.previewBubbleText, { color: chatTheme.foreground }]}>
            Show my open PRs on Ghostex
          </Text>
        </View>

        <View style={styles.previewReply}>
          <Text style={[styles.previewThinking, { color: chatTheme.muted }]}>Checked 2 branches in 0.4s</Text>
          <Text style={[styles.previewReplyText, { color: chatTheme.foreground }]}>
            Ready to review{' '}
            <Text style={{ color: chatTheme.link.url, fontWeight: '600' }}>#1842</Text> and merge.
          </Text>
        </View>

        <View
          style={[
            styles.previewComposer,
            {
              backgroundColor: chatTheme.composerBackground,
              borderColor: chatTheme.composerBorder,
            },
          ]}
        >
          <Text style={[styles.previewComposerText, { color: chatTheme.muted }]}>Message Claude…</Text>
          <View style={[styles.previewSendDot, { backgroundColor: chatTheme.send.fill }]}>
            <Text style={[styles.previewSendGlyph, { color: chatTheme.send.ink }]}>↑</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** One tile in the Themes gallery strip (Default, Moonwater, Polar, and the rest in desktop order). */
function LookTile({
  look,
  selected,
  appearance,
  onPress,
}: {
  look: ThemeLook;
  selected: boolean;
  appearance: Appearance;
  onPress: () => void;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/gu, '');
  const thumbBorder = selected ? appearance.accent : colorWithOpacity(appearance.foreground, 14);
  const thumbSource = look.artId !== null ? artworkThumbSource(look.artId) : null;
  const artMeta = look.artId !== null ? artworkById(look.artId) : undefined;
  const fallbackGradient = look.preview.gradient ?? artMeta?.previewStops;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${look.name} theme`}
      accessibilityState={{ selected }}
      style={styles.lookTile}
      onPress={onPress}
    >
      <View
        style={[
          styles.lookThumb,
          {
            borderColor: thumbBorder,
            borderWidth: selected ? 2 : 1.5,
            backgroundColor: look.preview.work,
          },
        ]}
      >
        {fallbackGradient !== undefined ? (
          <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
            <Defs>
              <LinearGradient id={`look-${gradId}`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor={fallbackGradient[0]} />
                <Stop offset="55%" stopColor={fallbackGradient[1]} />
                <Stop offset="100%" stopColor={fallbackGradient[2]} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#look-${gradId})`} />
          </Svg>
        ) : (
          <View style={styles.lookDefaultSplit}>
            <View style={[styles.lookDefaultSide, { backgroundColor: look.preview.sidebar }]} />
            <View style={[styles.lookDefaultMain, { backgroundColor: look.preview.work }]} />
          </View>
        )}
        {thumbSource !== null ? (
          <Image source={thumbSource} resizeMode="cover" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[styles.lookAccentDot, { backgroundColor: look.preview.accent }]} />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.lookName,
          {
            color: selected ? appearance.foreground : appearance.muted,
            fontWeight: selected ? '600' : '400',
          },
        ]}
      >
        {look.label}
      </Text>
    </Pressable>
  );
}

/** Themes gallery strip: Default, Moonwater, Polar, and the remaining Art themes & still-art looks. */
function ThemesGallerySection({ onPicked }: { onPicked: (dark: boolean) => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();

  return (
    <SettingsSearchAnchor label="Themes">
      <View style={settingsStyles.card}>
        <View style={styles.colourHeader}>
          <Text style={settingsStyles.cardLabel}>Themes</Text>
          <Text style={[styles.readout, { color: appearance.muted }]}>Art themes</Text>
        </View>
        <ScrollView
          horizontal
          accessibilityLabel="Built-in themes"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.lookStrip}
        >
          {ALL_THEME_LOOKS.map((look) => (
            <LookTile
              key={look.id}
              look={look}
              selected={themeLookMatches(settings, look)}
              appearance={appearance}
              onPress={() => {
                patchThemeSettings(themeLookPatch(look, settings.themeRoles));
                if (look.kind !== 'default') onPicked(true);
              }}
            />
          ))}
        </ScrollView>
      </View>
    </SettingsSearchAnchor>
  );
}

type ArtworkStripItem = { kind: 'none' } | { kind: 'art'; artwork: ThemeArtwork };

const ARTWORK_STRIP_ITEMS: readonly ArtworkStripItem[] = [
  { kind: 'none' },
  ...THEME_ARTWORKS.map((artwork): ArtworkStripItem => ({ kind: 'art', artwork })),
];

function ArtworkTile({
  item,
  selected,
  appearance,
  onPress,
}: {
  item: ArtworkStripItem;
  selected: boolean;
  appearance: Appearance;
  onPress: () => void;
}) {
  const gradId = useId().replace(/[^a-zA-Z0-9_-]/gu, '');
  const thumbBorder = selected ? appearance.accent : colorWithOpacity(appearance.foreground, 14);

  if (item.kind === 'none') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="No artwork"
        accessibilityState={{ selected }}
        style={styles.lookTile}
        onPress={onPress}
      >
        <View
          style={[
            styles.lookThumb,
            styles.artworkNoneThumb,
            {
              borderColor: thumbBorder,
              borderWidth: selected ? 2 : 1.5,
              backgroundColor: appearance.background,
            },
          ]}
        >
          <Text style={[styles.artworkNoneGlyph, { color: appearance.mutedGlyph }]}>∅</Text>
        </View>
        <Text
          numberOfLines={1}
          style={[
            styles.lookName,
            {
              color: selected ? appearance.foreground : appearance.muted,
              fontWeight: selected ? '600' : '400',
            },
          ]}
        >
          None
        </Text>
      </Pressable>
    );
  }

  const { artwork } = item;
  const thumbSource = artworkThumbSource(artwork.id);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${artwork.name} artwork`}
      accessibilityState={{ selected }}
      style={styles.lookTile}
      onPress={onPress}
    >
      <View
        style={[
          styles.lookThumb,
          {
            borderColor: thumbBorder,
            borderWidth: selected ? 2 : 1.5,
            backgroundColor: artwork.previewStops[0],
          },
        ]}
      >
        <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`art-${gradId}`} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0%" stopColor={artwork.previewStops[0]} />
              <Stop offset="55%" stopColor={artwork.previewStops[1]} />
              <Stop offset="100%" stopColor={artwork.previewStops[2]} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill={`url(#art-${gradId})`} />
        </Svg>
        {thumbSource !== null ? (
          <Image source={thumbSource} resizeMode="cover" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={[styles.lookAccentDot, { backgroundColor: artwork.previewAccent }]} />
      </View>
      <Text
        numberOfLines={1}
        style={[
          styles.lookName,
          {
            color: selected ? appearance.foreground : appearance.muted,
            fontWeight: selected ? '600' : '400',
          },
        ]}
      >
        {artwork.label}
      </Text>
    </Pressable>
  );
}

/** Single Artwork strip (None + 32 on-demand artworks), local screen toggle, and Dimming slider. */
function ArtworkPickerSection() {
  const settings = useSettingsStore((state) => state.settings);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();

  const artKey = appearance.light ? 'windowArtLight' : 'windowArt';
  const currentArtId = appearance.light ? settings.windowArtLight : settings.windowArt;
  const currentArt = artworkById(currentArtId);
  const isYourImage = currentArtId === YOUR_IMAGE_ART_ID;
  const hasArt = currentArt !== undefined;
  const modeLabel = appearance.light ? 'Light mode' : 'Dark mode';

  const selectArtwork = (id: string): void => {
    patchThemeSettings({
      [artKey]: id,
      ...(id !== 'none' ? { windowLiveStyle: 'none' } : {}),
    });
  };

  return (
    <>
      <SettingsSearchAnchor label="Artwork">
        <View style={settingsStyles.card}>
          <View style={styles.colourHeader}>
            <Text style={settingsStyles.cardLabel}>Artwork</Text>
            <Text style={[styles.readout, { color: appearance.muted }]}>
              {currentArt !== undefined
                ? `${currentArt.name} · ${modeLabel}`
                : isYourImage
                  ? `Custom (computer) · ${modeLabel}`
                  : `None · ${modeLabel}`}
            </Text>
          </View>
          <FlatList
            horizontal
            data={ARTWORK_STRIP_ITEMS}
            keyExtractor={(item) => (item.kind === 'none' ? 'none' : item.artwork.id)}
            accessibilityLabel="Artwork backgrounds"
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.lookStrip}
            initialNumToRender={7}
            maxToRenderPerBatch={8}
            windowSize={5}
            renderItem={({ item }) => (
              <ArtworkTile
                item={item}
                selected={
                  item.kind === 'none'
                    ? !hasArt
                    : currentArt !== undefined && currentArt.id === item.artwork.id
                }
                appearance={appearance}
                onPress={() => selectArtwork(item.kind === 'none' ? 'none' : item.artwork.id)}
              />
            )}
          />
          {isYourImage ? (
            <Caption>
              Your computer uses a local custom image for {modeLabel.toLowerCase()}. Pick an artwork above to show one on this phone.
            </Caption>
          ) : (
            <Caption>
              Downloads on demand and caches locally. Shown softly dimmed behind the sessions list and chat.
            </Caption>
          )}
        </View>
      </SettingsSearchAnchor>

      <ToggleRow
        label="Show artwork behind screens"
        detail={
          hasArt
            ? `Paints ${currentArt.name} softly dimmed behind the sessions list and chat on this phone.`
            : 'When an artwork is picked, paints it softly dimmed behind the sessions list and chat.'
        }
        value={settings.showHeaderArtworkBackdrop}
        onValueChange={(next) => setSetting('showHeaderArtworkBackdrop', next)}
      />

      {hasArt && settings.showHeaderArtworkBackdrop ? (
        <SettingsSlider
          label="Artwork dimming"
          minimumValue={0}
          maximumValue={85}
          step={5}
          value={Math.min(85, Math.max(0, settings.windowArtDim))}
          valueLabel={`${settings.windowArtDim}%`}
          rangeLabels={['Lighter', 'Darker']}
          onValueChange={(next) => patchThemeSettings({ windowArtDim: next })}
        />
      ) : null}
    </>
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
  const appearance = useAppearance();

  return (
    <>
      <SectionHeader title="Presets" />
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
                    patchThemeSettings(themePresetPatch(preset.id, picked.light, settings.themeRoles)!);
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

function AppearanceRow() {
  const sidebarTheme = useSettingsStore((state) => state.settings.sidebarTheme);
  const carrying = useSettingsStore((state) => state.settings.settingsSyncThroughPhone);
  const syncing = useSyncedEntriesStore((state) =>
    isAppearanceSyncActive(state.categoriesByMachine, state.values),
  );
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();
  const currentLabel = APPEARANCE_CHOICES.find((choice) => choice.value === sidebarTheme)?.label ?? 'System';

  return (
    <SettingsSearchAnchor label="Appearance">
      <View style={settingsStyles.card}>
        <View style={styles.colourHeader}>
          <Text style={settingsStyles.cardLabel}>Appearance</Text>
          <Text style={[styles.readout, { color: appearance.muted }]}>{currentLabel}</Text>
        </View>
        <SegmentedRow
          label="Appearance mode"
          options={APPEARANCE_CHOICES}
          value={sidebarTheme}
          onChange={(next) => patchThemeSettings({ sidebarTheme: next })}
        />
        <Caption>
          {carrying && syncing
            ? 'System follows your phone\u2019s light or dark mode. Theme, artwork and fine-tune colours sync with your computers.'
            : 'System follows your phone\u2019s light or dark mode.'}
        </Caption>
      </View>
    </SettingsSearchAnchor>
  );
}

/** Dark mode colour or Light mode colour: the sixteen Stage 1 subtle OKLCH squares plus uncapped Custom hex. */
function ColourRow({ dark, picked, onPicked }: { dark: boolean; picked: Picked; onPicked: (dark: boolean) => void }) {
  const settings = useSettingsStore((state) => state.settings);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();
  const mode = dark ? 'dark' : 'light';
  const selected = dark ? settings.darkThemePreset : settings.lightThemePreset;
  const tintKey = dark ? 'customSidebarTitlebarBackgroundTintColor' : 'customSidebarTitlebarLightBackgroundTintColor';
  const squares = themeSquares(!dark);
  const pickedHere = dark ? picked.dark : picked.light;
  const otherPicked = dark ? picked.light : picked.dark;
  const follows = themeColoursPaired(settings, dark) && !pickedHere && (!dark || otherPicked);
  const name = selected === 'custom' ? 'Custom' : (squares.find((square) => square.id === selected)?.label ?? selected);
  const choose = (preset: DarkThemePreset | LightThemePreset): void => {
    patchThemeSettings({
      ...themeColourPatch(settings, dark, preset, otherPicked),
      ...(preset !== 'custom' && dark ? { windowLiveStyle: 'none' } : {}),
    });
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
        style={[
          styles.square,
          { borderColor: colorWithOpacity(appearance.foreground, 18) },
          fill === null ? null : { backgroundColor: fill },
        ]}
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
            ? 'Built-in squares stay subtle in dark mode. Tap + for any uncapped custom hex colour.'
            : 'Follows dark mode until picked here. Tap + for any uncapped custom hex colour.'}
        </Caption>
        <View style={styles.squares}>
          {squares.map((entry) =>
            square(entry.id, entry.label, entry.swatch, selected === entry.id, () => choose(entry.id)),
          )}
          {square('custom', 'Custom', selected === 'custom' ? settings[tintKey] : null, selected === 'custom', () =>
            choose('custom'),
          )}
        </View>
        {selected === 'custom' ? (
          <View style={styles.uncappedWrap}>
            <HexColourField
              label="Custom tint"
              value={settings[tintKey]}
              onChange={(hex) => {
                patchThemeSettings({ [tintKey]: hex });
                onPicked(dark);
              }}
            />
            <Text style={[styles.uncappedNote, { color: appearance.muted }]}>
              Uncapped: custom hex colours keep their exact chroma and lightness.
            </Text>
          </View>
        ) : null}
      </View>
    </SettingsSearchAnchor>
  );
}

/** Colourfulness, and the sidebar and work area set apart. */
function ColourfulnessRows() {
  const settings = useSettingsStore((state) => state.settings);
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
          onValueChange={(next) => patchThemeSettings(colourfulnessPatch(next))}
        />
      )}
      <Caption>
        How much of the colour shows in the sidebar and work area. Subtle is nearly neutral; Full reaches the picked tint.
      </Caption>
      <ToggleRow
        label="Set the sidebar and work area separately"
        value={split}
        onValueChange={(checked) => {
          setSplit(checked);
          if (!checked) patchThemeSettings(colourfulnessPatch(colourfulnessDisplayStep(settings.themeSidebarContrast)));
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
                onValueChange={(next) => patchThemeSettings(areaColourfulnessPatch(key, next))}
              />
            );
          })
        : null}
    </>
  );
}

/** Single editable theme role row accepting `#rrggbb`, `#rrggbbaa`, `base+N%`, `base-N%`, `base+N%/A%`, or `N%`. */
function ThemeRoleEditorRow({
  role,
  value,
  light,
  baseHex,
  appearance,
  onChange,
}: {
  role: ThemeRoleDefinition;
  value: string | undefined;
  light: boolean;
  baseHex: string;
  appearance: Appearance;
  onChange: (next: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => {
    setDraft(value ?? '');
  }, [value]);

  const resolvedSwatch = resolveRoleOverBase(value, light, baseHex);

  const commit = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed.toLowerCase() === 'default') {
      if (value !== undefined) onChange(null);
      setDraft('');
      return;
    }
    if (parseRoleValue(trimmed) !== null) {
      if (trimmed !== value) onChange(trimmed);
    } else {
      setDraft(value ?? '');
    }
  };

  return (
    <View style={[styles.roleRow, { borderTopColor: appearance.border }]}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.roleSwatch,
          {
            borderColor: colorWithOpacity(appearance.foreground, 22),
            backgroundColor: resolvedSwatch ?? 'transparent',
          },
        ]}
      />
      <View style={styles.roleInfo}>
        <Text style={[styles.roleTitle, { color: appearance.foreground }]}>{role.title}</Text>
        <Text style={[styles.roleAbout, { color: appearance.muted }]} numberOfLines={2}>
          {role.about}
        </Text>
      </View>
      <TextInput
        accessibilityLabel={`${role.title} role value`}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardAppearance={appearance.light ? 'light' : 'dark'}
        placeholder="default"
        placeholderTextColor={appearance.muted}
        returnKeyType="done"
        spellCheck={false}
        style={[
          styles.roleInput,
          {
            backgroundColor: appearance.input,
            borderColor: appearance.border,
            color: appearance.foreground,
          },
        ]}
        value={draft}
        onBlur={commit}
        onSubmitEditing={commit}
        onChangeText={(next) => {
          setDraft(next);
          const trimmed = next.trim();
          if (trimmed === '') {
            if (value !== undefined) onChange(null);
            // Avoid committing bare "base" mid-keystroke while the user is typing e.g. "base+7%".
          } else if (trimmed.toLowerCase() !== 'base' && parseRoleValue(trimmed) !== null && trimmed !== value) {
            onChange(trimmed);
          }
        }}
      />
      {value !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${role.title}`}
          hitSlop={6}
          onPress={() => onChange(null)}
          style={[styles.roleClearBtn, { backgroundColor: appearance.neutralFill }]}
        >
          <Text style={[styles.roleClearText, { color: appearance.muted }]}>×</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Fine-tune accents & fills (`themeRoles`): quick accent dots, chat/surface fills, and expandable More theme colours. */
function FineTuneSection() {
  const settings = useSettingsStore((state) => state.settings);
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();
  const light = appearance.light;
  const activeRoles = rolesForAppearance(settings.themeRoles, light);
  const overrideCount = countThemeRoleOverrides(settings.themeRoles, light);
  const [showMore, setShowMore] = useState(() =>
    EXTRA_ROLES.some((role) => activeRoles[role.id] !== undefined),
  );

  const updateRole = (role: ThemeRoleId, next: string | null): void => {
    patchThemeSettings({ themeRoles: setThemeRole(settings.themeRoles, light, role, next) });
  };

  const accentValue = activeRoles.accent ?? '';
  const modeLabel = light ? 'Light mode' : 'Dark mode';

  return (
    <SettingsSearchAnchor label="Fine-tune colours">
      <View style={settingsStyles.card}>
        <View style={styles.colourHeader}>
          <Text style={settingsStyles.cardLabel}>Accent &amp; chat fills</Text>
          <Text style={[styles.readout, { color: appearance.muted }]}>
            {overrideCount > 0 ? `${modeLabel} · ${overrideCount} set` : modeLabel}
          </Text>
        </View>
        <Caption>
          Uncapped overrides for the current appearance. Accepts #hex, opacity like 8%, or relative steps like base+7%.
        </Caption>

        <View style={styles.accentRow}>
          <Text style={[styles.roleTitle, { color: appearance.foreground }]}>Accent</Text>
          <View style={styles.accentDots}>
            {QUICK_ACCENT_SWATCHES.map((swatch) => {
              const selected = accentValue.toLowerCase() === swatch.hex.toLowerCase();
              return (
                <Pressable
                  key={swatch.hex}
                  accessibilityRole="radio"
                  accessibilityLabel={`${swatch.label} accent`}
                  accessibilityState={{ selected }}
                  hitSlop={4}
                  onPress={() => {
                    const withAccent = setThemeRole(settings.themeRoles, light, 'accent', swatch.hex);
                    patchThemeSettings({
                      themeRoles: setThemeRole(withAccent, light, 'focusRing', swatch.hex),
                    });
                  }}
                  style={[
                    styles.accentDotFrame,
                    selected && { borderColor: appearance.foreground },
                  ]}
                >
                  <View style={[styles.accentDot, { backgroundColor: swatch.hex }]} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <ThemeRoleEditorRow
          role={THEME_ROLES.find((r) => r.id === 'accent')!}
          value={activeRoles.accent}
          light={light}
          baseHex={appearance.workArea}
          appearance={appearance}
          onChange={(next) => {
            const withAccent = setThemeRole(settings.themeRoles, light, 'accent', next);
            patchThemeSettings({
              themeRoles: setThemeRole(withAccent, light, 'focusRing', next),
            });
          }}
        />

        {PRIMARY_ROLES.map((role) => (
          <ThemeRoleEditorRow
            key={role.id}
            role={role}
            value={activeRoles[role.id]}
            light={light}
            baseHex={appearance.workArea}
            appearance={appearance}
            onChange={(next) => updateRole(role.id, next)}
          />
        ))}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showMore }}
          onPress={() => setShowMore((prev) => !prev)}
          style={({ pressed }) => [
            styles.moreToggle,
            {
              borderTopColor: appearance.border,
              backgroundColor: pressed ? appearance.cardActive : 'transparent',
            },
          ]}
        >
          <Text style={[styles.roleTitle, { color: appearance.foreground }]}>
            {showMore ? 'Hide more theme colours' : 'More theme colours'}
          </Text>
          <Glyph
            name={showMore ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={appearance.mutedGlyph}
          />
        </Pressable>

        {showMore
          ? EXTRA_ROLES.map((role) => (
              <ThemeRoleEditorRow
                key={role.id}
                role={role}
                value={activeRoles[role.id]}
                light={light}
                baseHex={appearance.workArea}
                appearance={appearance}
                onChange={(next) => updateRole(role.id, next)}
              />
            ))
          : null}

        {overrideCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear fine-tune colours"
            onPress={() => {
              const mode = light ? 'light' : 'dark';
              const next = { ...settings.themeRoles };
              delete next[mode];
              patchThemeSettings({ themeRoles: next });
            }}
            style={({ pressed }) => [
              styles.clearAllBtn,
              { backgroundColor: pressed ? appearance.neutralFillPressed : appearance.neutralFill },
            ]}
          >
            <Text style={[styles.clearAllText, { color: appearance.foreground }]}>
              Reset {modeLabel.toLowerCase()} fine-tune colours
            </Text>
          </Pressable>
        ) : null}
      </View>
    </SettingsSearchAnchor>
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
  return (
    <>
      <SectionHeader title={title} />
      {CONTENT_COLOR_SCHEMES.map((scheme) => (
        <ChoiceRow
          key={scheme}
          label={CONTENT_SCHEME_LABELS[scheme]}
          selected={value === scheme}
          onPress={() => patchThemeSettings({ [settingKey]: scheme })}
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
        file.delete();
      }
      if (!active.current) return;
      const state = useSettingsStore.getState();
      const next = importGhosttyTheme(state.settings, text, asset.name);
      state.patchSettings({ importedTerminalPalettes: next.importedTerminalPalettes });
      showAlert('Palette imported', 'Choose it in the terminal palette list for dark or light mode.');
    } catch (error) {
      if (active.current) {
        showAlert(
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

/** Confirmation dialog shared by the header Reset button (single & two-column Duo) and bottom Reset row. */
export function promptResetThemeToDefault(onDidReset?: () => void): void {
  showAlert(
    'Reset theme to default?',
    'This restores Ghostex default colours, artwork settings, and fine-tune overrides on this phone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: () => {
          patchThemeSettings(resetThemeToDefaultPatch());
          onDidReset?.();
        },
      },
    ],
  );
}

/** Compact Reset button for Settings > Themes' navigation header and two-column Duo title row. */
export function ThemeResetHeaderButton({ onDidReset }: { onDidReset?: () => void }) {
  const appearance = useAppearance();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Reset theme to default"
      hitSlop={8}
      onPress={() => promptResetThemeToDefault(onDidReset)}
      style={({ pressed }) => [
        styles.headerResetBtn,
        { backgroundColor: pressed ? appearance.neutralFillPressed : appearance.neutralFill },
      ]}
    >
      <Text style={[styles.headerResetText, { color: appearance.foreground }]}>Reset</Text>
    </Pressable>
  );
}

export default function ThemePage() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const twoColumns = useTwoColumns();
  const settingsStyles = useSettingsStyles();
  const appearance = useAppearance();

  const [picked, setPicked] = useState<Picked>({ dark: false, light: false });
  const [copySheetOpen, setCopySheetOpen] = useState(false);
  const [copiedNote, setCopiedNote] = useState<string | null>(null);

  const onPicked = (dark: boolean): void =>
    setPicked((current) => (dark ? { ...current, dark: true } : { ...current, light: true }));

  const clearLocalThemeState = useMemo(
    () => () => {
      setPicked({ dark: false, light: false });
      setCopiedNote(null);
    },
    [],
  );

  const confirmReset = useMemo(
    () => () => promptResetThemeToDefault(clearLocalThemeState),
    [clearLocalThemeState],
  );

  useLayoutEffect(() => {
    if (route.name !== 'SettingsPage' || twoColumns) return;
    navigation.setOptions({
      headerRight: () => <ThemeResetHeaderButton onDidReset={clearLocalThemeState} />,
    });
    return () => {
      navigation.setOptions({ headerRight: undefined });
    };
  }, [navigation, route.name, twoColumns, clearLocalThemeState]);

  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:theme:preview">
        <LiveMiniChatPreview />
      </SettingsSection>

      <SettingsSection name="settings:theme:copy-computer">
        <SettingsSearchAnchor label="Copy from a computer">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy from a computer"
            onPress={() => setCopySheetOpen(true)}
            style={({ pressed }) => [settingsStyles.row, pressed && settingsStyles.rowPressed]}
          >
            <View
              style={[
                styles.copyIconBox,
                { backgroundColor: appearance.cardActive, borderColor: appearance.border },
              ]}
            >
              <Glyph name="device-desktop" size={17} color={appearance.foreground} />
            </View>
            <View style={settingsStyles.linkText}>
              <Text style={settingsStyles.linkTitle}>Copy from a computer…</Text>
              <Text style={settingsStyles.linkDescription}>
                {copiedNote ?? 'Pick a paired computer and preview its look.'}
              </Text>
            </View>
            <Text style={settingsStyles.chevron}>›</Text>
          </Pressable>
        </SettingsSearchAnchor>
      </SettingsSection>

      <SettingsSection name="settings:theme:appearance">
        <AppearanceRow />
      </SettingsSection>

      <SettingsSection name="settings:theme:gallery">
        <ThemesGallerySection onPicked={onPicked} />
      </SettingsSection>

      <SettingsSection name="settings:theme:artwork">
        <ArtworkPickerSection />
      </SettingsSection>

      <SettingsSection name="settings:theme:colours">
        <SectionHeader title="Colours" />
        <ColourRow dark picked={picked} onPicked={onPicked} />
        <ColourRow dark={false} picked={picked} onPicked={onPicked} />
        <ColourfulnessRows />
      </SettingsSection>

      <SettingsSection name="settings:theme:fine-tune">
        <SectionHeader title="Fine-tune" />
        <FineTuneSection />
      </SettingsSection>

      <SettingsSection name="settings:theme:presets">
        <PresetsSection picked={picked} onPicked={onPicked} />
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

      <SettingsSection name="settings:theme:reset">
        <SettingsSearchAnchor label="Reset to default">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset theme to default"
            onPress={confirmReset}
            style={({ pressed }) => [
              settingsStyles.row,
              styles.resetRow,
              pressed && settingsStyles.rowPressed,
            ]}
          >
            <Text style={[styles.resetRowText, { color: appearance.danger }]}>Reset to default</Text>
          </Pressable>
        </SettingsSearchAnchor>
      </SettingsSection>

      <CopyComputerThemeSheet
        visible={copySheetOpen}
        onClose={() => setCopySheetOpen(false)}
        onCopied={(machineName, themeName) => setCopiedNote(`Last copied ${themeName} from ${machineName}.`)}
      />
    </SettingsScreenLayout>
  );
}

const styles = StyleSheet.create({
  headerResetBtn: {
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headerResetText: {
    fontSize: 13,
    fontWeight: '600',
  },
  previewCard: {
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    overflow: 'hidden',
  },
  previewHeader: {
    position: 'relative',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: GhostexStrokeWidth,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  previewBadge: {
    fontSize: 11,
    fontWeight: '600',
    flexShrink: 1,
  },
  previewBody: {
    padding: 11,
    gap: 8,
  },
  previewBubble: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewBubbleText: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  previewReply: {
    gap: 2,
  },
  previewThinking: {
    fontSize: 11,
  },
  previewReplyText: {
    fontSize: 12.5,
    lineHeight: 17,
  },
  previewComposer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderRadius: 9,
    borderWidth: GhostexStrokeWidth,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  previewComposerText: {
    fontSize: 12,
  },
  previewSendDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewSendGlyph: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  copyIconBox: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: GhostexStrokeWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookStrip: {
    gap: 10,
    paddingVertical: 2,
  },
  lookTile: {
    width: 72,
    gap: 5,
  },
  lookThumb: {
    width: 72,
    height: 46,
    borderRadius: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  artworkNoneThumb: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  artworkNoneGlyph: {
    fontSize: 18,
    fontWeight: '500',
  },
  lookDefaultSplit: {
    flex: 1,
    flexDirection: 'row',
  },
  lookDefaultSide: {
    width: '34%',
    height: '100%',
  },
  lookDefaultMain: {
    flex: 1,
    height: '100%',
  },
  lookAccentDot: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  lookName: {
    fontSize: 11,
    lineHeight: 14,
  },
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
  uncappedWrap: {
    gap: 5,
  },
  uncappedNote: {
    fontSize: 11,
    paddingHorizontal: 2,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingVertical: 2,
  },
  accentDots: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'flex-end',
    flex: 1,
  },
  accentDotFrame: {
    padding: 2,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  accentDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 9,
    borderTopWidth: GhostexStrokeWidth,
  },
  roleSwatch: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: GhostexStrokeWidth,
  },
  roleInfo: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  roleTitle: {
    fontSize: 13,
    fontWeight: '500',
  },
  roleAbout: {
    fontSize: 11,
    lineHeight: 14,
  },
  roleInput: {
    width: 108,
    minHeight: 34,
    paddingHorizontal: 8,
    borderRadius: GhostexRadii.row,
    borderWidth: GhostexStrokeWidth,
    fontFamily: 'monospace',
    fontSize: 12,
  },
  roleClearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleClearText: {
    fontSize: 15,
    lineHeight: 17,
    fontWeight: '600',
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
    paddingBottom: 2,
    borderTopWidth: GhostexStrokeWidth,
  },
  clearAllBtn: {
    borderRadius: GhostexRadii.row,
    minHeight: 38,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 2,
  },
  clearAllText: {
    fontSize: 13,
    fontWeight: '500',
  },
  resetRow: {
    justifyContent: 'center',
    marginTop: 8,
  },
  resetRowText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
