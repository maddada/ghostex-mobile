import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useSettingsStore, type GhostexSettings } from '../settings/store';
import {
  ATTENTION_ROW_WASH, BLOCKED_CARD_WASH, VOICE_MEMORY_WASH, colorOver, destructiveButtonFills,
  GhostexPalette, mixHexColors, neutralButtonFills, primaryButtonFills,
} from './palette';
import {
  appearanceIsLight,
  isLightBackground,
  resolveThemeAreas,
  readableSecondaryText,
  sidebarAppearanceFor,
  type SidebarAppearance,
  type ThemeColourSettings,
} from './sidebarAppearance';
import { resolveRoleCss, resolveRoleOverBase, rolesForAppearance } from './themeRoles';

/**
 * The sessions drawer's colors plus the few control tokens a form screen needs.
 * Every drawer token comes from `sidebarAppearanceFor` over the resolved sidebar colour.
 */
export type Appearance = SidebarAppearance & {
  /** The work area colour of the same appearance (chat, a theme-coloured terminal). */
  workArea: string;
  /** Text fields: one step above the page so the field edge reads. */
  input: string;
  /** Off-state switch tracks, radio rings and slider tracks. */
  control: string;
  /** Off-state switch thumb. */
  controlThumb: string;
  /** A light page (dark ink), for fills that flip with the theme such as `destructiveButtonFills`. */
  light: boolean;
  /** Secondary text buttons: the neutral fill at rest and pressed (`neutralButtonFills`, no border). */
  neutralFill: string;
  neutralFillPressed: string;
  /** Primary text buttons: one step brighter than `neutralFill`, with `foreground` text (`primaryButtonFills`). */
  primaryFill: string;
  primaryFillPressed: string;
  /** Selected radios, switches and slider fills, and accent text: the sky accent, a deep blue-grey on a light page. */
  accent: string;
  accentForeground: string;
  danger: string;
  /** The destructive colour as designed (or set under the theme's roles), before `danger` makes it readable on every surface. */
  dangerHue: string;
  dangerFill: string;
  dangerFillPressed: string;
  attention: string;
  working: string;
  connected: string;
  sleeping: string;
};

/** The desktop's light Settings accent (`settings_accent`: #262626 mixed half with #174564). */
const LIGHT_ACCENT = mixHexColors('#262626', '#174564', 50);

let lastResolved: { key: string; appearance: Appearance } | null = null;

/**
 * Resolves the colour settings for one appearance into page colors.
 * Equal inputs return the same object so per-appearance style caches stay warm.
 */
export function resolveAppearance(settings: ThemeColourSettings, light: boolean): Appearance {
  const activeRoles = rolesForAppearance(settings.themeRoles, light);
  const key = JSON.stringify([
    light,
    settings.darkThemePreset,
    settings.lightThemePreset,
    settings.customSidebarTitlebarBackgroundTintColor,
    settings.customSidebarTitlebarLightBackgroundTintColor,
    settings.customSidebarTitlebarBackgroundDarknessPercent,
    settings.customSidebarTitlebarLightBackgroundLightnessPercent,
    settings.themeSidebarContrast,
    settings.themeWorkAreaContrast,
    activeRoles,
  ]);
  if (lastResolved !== null && lastResolved.key === key) return lastResolved.appearance;
  const areas = resolveThemeAreas(settings, light);
  const sidebar = sidebarAppearanceFor(areas.sidebar);
  // Desktop `theme_roles.rs` resolves every relative role (`base+N%`) against the appearance's work area base colour.
  const roleBase = areas.workArea;
  const card = resolveRoleOverBase(activeRoles.surface, light, roleBase) ?? sidebar.card;
  const controlSurface = resolveRoleOverBase(activeRoles.control, light, roleBase);
  const cardActive =
    resolveRoleOverBase(activeRoles.selection, light, roleBase) ??
    controlSurface ??
    sidebar.cardActive;
  const border = resolveRoleCss(activeRoles.border, light, roleBase) ?? sidebar.border;
  const fills = neutralButtonFills(light);
  const primaryFills = primaryButtonFills(light);
  const customDanger = resolveRoleOverBase(activeRoles.danger, light, roleBase);
  const dangerBase = customDanger ?? GhostexPalette.DANGER;
  const dangerFills = destructiveButtonFills(dangerBase, light);
  const surfaces = [
    sidebar.background,
    card,
    cardActive,
    ...[sidebar.background, card].flatMap((base) =>
      [
        fills.rest,
        fills.pressed,
        primaryFills.rest,
        primaryFills.pressed,
        dangerFills.rest,
        dangerFills.pressed,
      ].map((fill) => colorOver(fill, base)),
    ),
    colorOver(BLOCKED_CARD_WASH, sidebar.background),
    colorOver(ATTENTION_ROW_WASH, sidebar.background),
    colorOver(VOICE_MEMORY_WASH, sidebar.background),
  ];
  // Keep the desktop's surfaces and fill alphas; honour explicit themeRoles text/accent while preserving readability.
  const baseForeground = resolveRoleOverBase(activeRoles.text, light, roleBase) ?? sidebar.foreground;
  const foreground = readableSecondaryText(baseForeground, light ? '#000000' : '#ffffff', surfaces);
  const text = (designed: string) => readableSecondaryText(designed, foreground, surfaces);
  const baseMuted = resolveRoleOverBase(activeRoles.mutedText, light, roleBase) ?? sidebar.muted;
  const customAccent = resolveRoleOverBase(activeRoles.accent, light, roleBase);
  const accent = customAccent ?? text(light ? LIGHT_ACCENT : GhostexPalette.ACCENT);
  const accentForeground =
    customAccent !== null
      ? isLightBackground(accent)
        ? '#141518'
        : '#ffffff'
      : light
        ? GhostexPalette.FOREGROUND
        : GhostexPalette.ACCENT_FOREGROUND;
  const danger = text(dangerBase);
  const customSuccess = resolveRoleOverBase(activeRoles.success, light, roleBase);
  const customWarning = resolveRoleOverBase(activeRoles.warning, light, roleBase);
  const appearance: Appearance = {
    ...sidebar,
    card,
    cardActive,
    border,
    foreground,
    muted: text(baseMuted),
    workArea: areas.workArea,
    input: controlSurface ?? mixHexColors(foreground, sidebar.background, 3),
    control: mixHexColors(foreground, sidebar.background, 22),
    controlThumb: mixHexColors(foreground, sidebar.background, 75),
    light,
    neutralFill: fills.rest,
    neutralFillPressed: fills.pressed,
    primaryFill: primaryFills.rest,
    primaryFillPressed: primaryFills.pressed,
    accent,
    accentForeground,
    danger,
    dangerHue: dangerBase,
    dangerFill: dangerFills.rest,
    dangerFillPressed: dangerFills.pressed,
    attention: text(customAccent ?? GhostexPalette.STATUS_ATTENTION),
    working: text(customWarning ?? GhostexPalette.STATUS_WORKING),
    connected: text(customSuccess ?? GhostexPalette.STATUS_CONNECTED),
    sleeping: text(GhostexPalette.STATUS_SLEEPING),
  };
  lastResolved = { key, appearance };
  return appearance;
}

/** The colour keys of the settings, for a shallow store selector (the drawer, Settings and the chat read the same). */
export function themeColourSettings(settings: GhostexSettings): ThemeColourSettings {
  return {
    darkThemePreset: settings.darkThemePreset,
    lightThemePreset: settings.lightThemePreset,
    customSidebarTitlebarBackgroundTintColor: settings.customSidebarTitlebarBackgroundTintColor,
    customSidebarTitlebarLightBackgroundTintColor: settings.customSidebarTitlebarLightBackgroundTintColor,
    customSidebarTitlebarBackgroundDarknessPercent: settings.customSidebarTitlebarBackgroundDarknessPercent,
    customSidebarTitlebarLightBackgroundLightnessPercent: settings.customSidebarTitlebarLightBackgroundLightnessPercent,
    themeSidebarContrast: settings.themeSidebarContrast,
    themeWorkAreaContrast: settings.themeWorkAreaContrast,
    themeRoles: settings.themeRoles,
  };
}

/**
 * CDXC:Theming DECISION: the selected colours reach the settings screens. The theme colours paint every Settings page, the Extra Keys and Agent Hotkeys editors, their navigation headers and the sessions drawer with the same colors, and a change repaints the open page at once.
 *
 * CDXC:Theming WHY: The colours come from the desktop's model (the phone copies the Mac app's theme functions): the saved appearance (System follows the device) picks the dark or light colour settings, and the drawer reads this same hook instead of a second resolver.
 */
export function useAppearance(): Appearance {
  const theme = useSettingsStore(useShallow(({ settings }) => themeColourSettings(settings)));
  const light = useAppearanceIsLight();
  return useMemo(() => resolveAppearance(theme, light), [theme, light]);
}

/**
 * Whether the saved appearance is light (System follows the device): `useAppearance().light` without resolving the
 * colours, for the many Sessions list rows that only pick their ink by it (rows.tsx `useSidebarInk`).
 */
export function useAppearanceIsLight(): boolean {
  const sidebarTheme = useSettingsStore((state) => state.settings.sidebarTheme);
  return appearanceIsLight(sidebarTheme, useColorScheme() === 'light');
}
