/**
 * The native chat's tones and type: the transcript, the composer and its sheets, and the cards all read this one
 * object (`useTranscriptTheme`), so the whole screen follows the chat's appearance together.
 *
 * Each value is the desktop's `ChatAppearance` (apps/desktop/src/app/native_chat/appearance.rs). Text, status and
 * control roles are fixed per appearance; the surfaces (page, bubble, cards, composer, menus) are the desktop's
 * steps off the chat's own work-area colour, so a theme preset carries into all of them. Over the phone's former
 * fixed backgrounds (`#0e0e0e` dark, `#fdfdfd` light) the steps land on the values the phone drew before.
 *
 * CDXC:Theming WHY: the phone copies the Mac app's theme functions. The chat's appearance is the
 * Mac's Chat theme (Follow app, System, Light, Dark) and its colours come from the same resolver as Settings.
 */

import { useMemo } from 'react';
import {
  Appearance,
  type ImageStyle,
  Platform,
  StyleSheet,
  type TextStyle,
  useColorScheme,
  type ViewStyle,
} from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { useSettingsStore, type GhostexSettings } from '../../../settings/store';
import { colorOver, colorWithOpacity, destructiveButtonFills, mixHexColors, neutralButtonFills } from '../../../theme/palette';
import {
  contentIsLight,
  readableSecondaryText,
  resolveThemeAreas,
  stepTowardHex,
  type ContentColorScheme,
  type SidebarThemeSetting,
  type ThemeColourSettings,
} from '../../../theme/sidebarAppearance';
import { themeColourSettings } from '../../../theme/useAppearance';

export type TranscriptTheme = {
  light: boolean;
  background: string;
  foreground: string;
  /** Icons, disclosure headings, the user bubble's text (`--chat-primary-foreground`). */
  primary: string;
  /** The answer's running prose. */
  prose: string;
  controlPrimary: string;
  muted: string;
  cardMuted: string;
  border: string;
  /** The user bubble, tool bodies and file cards. */
  input: string;
  cardBackground: string;
  error: string;
  /** Inline code chips. */
  inlineCodeSurface: string;
  inlineCodeBorder: string;
  /**
   * Reference colours in the transcript, by kind: `transcript` in `reference-visual.json`, the same
   * brighter set the GPUI transcript uses (see `presentations` in native_chat/markdown_links.rs).
   */
  link: { url: string; file: string; folder: string; image: string; skill: string; comment: string };
  alert: { note: string; tip: string; important: string; warning: string; caution: string };
  diff: { added: string; removed: string; addedRow: string; removedRow: string; rail: string; border: string };
  /** A pressed row. */
  pressed: string;
  /** Behind each occurrence of the query in a matched row's text, and behind the selected one. */
  searchMatch: string;
  searchMatchActive: string;

  /** Hairlines of choice rows and card buttons (`control_border`), and of inputs (`input_border`). */
  controlBorder: string;
  inputBorder: string;
  /**
   * The status card's panel and its footer band (`card_panel`, `card_footer`), and the rows inside a
   * card such as a question's options and note box (`card_row`).
   *
   * CDXC:Theming 2026-10-11 DECISION:
   * User: every chat card is as dark as the page question cards ("yellow + dark all"). Dark mode lifts the panel 3.5%, the rows 1.5% and the footer 2.5% toward white off the background (#161616 / #121212 / #141414 over #0e0e0e), replacing 7% / 3% / 3.3%; light mode is unchanged and its rows keep the input tone.
   * SEE-ALSO: apps/desktop/src/app/native_chat/appearance.rs (the same rule), server/src/visual_pages/kit.rs (the page question cards).
   */
  cardPanel: string;
  cardRow: string;
  cardFooter: string;
  /** A focused field's edge, and the glow around it (`border-ring`, ring at 20%). */
  ring: string;
  ringGlow: string;
  /** The theme accent (`theme_accent_for_variant`), used by the account-switch card. */
  accent: string;
  /** A pressed card, card header or choice. */
  pressedFill: string;
  /**
   * Every secondary text button in the chat's cards, sheets and dialogs: the neutral fill at rest
   * and pressed, no border (`neutralButtonFills`, CDXC:AppModal 2026-10-14 on the desktop's
   * `neutral_button_fills`). Destructive ones (Delete, Remove) take `destructiveFill`, a tint of `error`.
   */
  neutralFill: string;
  neutralFillPressed: string;
  destructiveFill: string;
  destructiveFillPressed: string;
  /** A selected choice's fill and border (`control_primary` at 10% / 30%). */
  selectedFill: string;
  selectedBorder: string;
  /** The inset well a command or a terminal excerpt sits in. */
  wellFill: string;
  wellBorder: string;
  /** The dimmer behind a modal over the chat (the subagent viewer, the account switch). */
  modalBackdrop: string;
  /** The dimmer behind a composer sheet. */
  sheetBackdrop: string;
  /** The async question dot and spinner ring. */
  asyncDot: string;
  asyncSpinner: string;
  /** The composer card and its border. */
  composerBackground: string;
  composerBorder: string;
  /** Menus, sheets and popovers (`--popover`), their hairline, ink and a pressed row. */
  menu: string;
  menuBorder: string;
  menuForeground: string;
  controlPressed: string;
  grabber: string;
  /** Placeholder text in every field. */
  placeholder: string;
  /** A starred model or prompt. */
  star: string;
  /** Send and Stop (`send_control.rs`; the light pair is the React chat's user decision). */
  send: { fill: string; ink: string; stopFill: string; stopInk: string; stopBorder: string };
  /**
   * Composer reference pill tints: the same brighter set as `link`.
   *
   * CDXC:SessionChat 2026-09-27 DECISION:
   * User: the phone composer's reference pills take the transcript's brighter reference colours. The GPUI composer still uses the dimmer `colors` from `reference-visual.json`.
   */
  reference: Record<string, string>;
  /** The account-switch card's raised surface and its tiles (`account_switch_card.rs`). */
  floatingSurface: string;
  floatingTile: string;
  /** The new-session welcome's agent mark card (card background 12% toward the foreground). */
  markCard: string;
  /** The context meter ring (`context_meter.rs`). */
  meterTrack: string;
  meterFill: string;
  /** The foreground at an alpha: hairlines, washes and quiet fills that must flip with the theme. */
  ink(alpha: number): string;
  /** The muted text colour at an alpha. */
  mutedInk(alpha: number): string;
};

/** The surfaces stepped off the chat's work-area colour (`chatSurfaces`); every other value is fixed per appearance. */
type ChatSurfaceKey =
  | 'background'
  | 'input'
  | 'border'
  | 'cardBackground'
  | 'cardPanel'
  | 'cardRow'
  | 'cardFooter'
  | 'composerBackground'
  | 'composerBorder'
  | 'controlBorder'
  | 'inputBorder'
  | 'menu'
  | 'wellFill'
  | 'floatingSurface'
  | 'floatingTile'
  | 'markCard';

type ChatRoles = Omit<TranscriptTheme, ChatSurfaceKey>;

const DARK: ChatRoles = {
  light: false,
  foreground: '#fcfcfc',
  primary: '#b4b8c0',
  prose: '#b4b8c0',
  controlPrimary: '#e5e5e5',
  muted: '#9e9e9e',
  cardMuted: '#b4b8bf',
  error: '#ef9999',
  inlineCodeSurface: '#282828',
  inlineCodeBorder: 'rgba(252,252,252,0.18)',
  link: { url: '#6cb4ff', file: '#9dbcf0', folder: '#e3c283', image: '#8ed8ab', skill: '#a3d9bd', comment: '#b4c3ef' },
  alert: { note: '#51a2ff', tip: '#00d492', important: '#c27aff', warning: '#fe9a00', caution: '#ff6467' },
  diff: {
    added: '#94caaa',
    removed: '#e5a0a4',
    addedRow: 'rgba(34,197,94,0.12)',
    removedRow: 'rgba(239,68,68,0.12)',
    rail: 'rgba(158,158,158,0.7)',
    border: 'rgba(158,158,158,0.2)',
  },
  pressed: 'rgba(252,252,252,0.05)',
  searchMatch: 'rgba(250,204,21,0.3)',
  searchMatchActive: 'rgba(249,115,22,0.6)',
  ring: '#737373',
  ringGlow: 'rgba(115,115,115,0.20)',
  accent: '#86d3f8',
  pressedFill: 'rgba(252,252,252,0.06)',
  neutralFill: neutralButtonFills(false).rest,
  neutralFillPressed: neutralButtonFills(false).pressed,
  destructiveFill: destructiveButtonFills('#ef9999', false).rest,
  destructiveFillPressed: destructiveButtonFills('#ef9999', false).pressed,
  selectedFill: 'rgba(229,229,229,0.10)',
  selectedBorder: 'rgba(229,229,229,0.30)',
  wellBorder: 'rgba(255,255,255,0.05)',
  modalBackdrop: 'rgba(0,0,0,0.58)',
  sheetBackdrop: 'rgba(0,0,0,0.5)',
  asyncDot: '#f472b6',
  asyncSpinner: '#d99a62',
  menuBorder: 'rgba(255,255,255,0.10)',
  menuForeground: '#fcfcfc',
  controlPressed: 'rgba(252,252,252,0.08)',
  grabber: 'rgba(255,255,255,0.22)',
  placeholder: 'rgba(158,158,158,0.6)',
  star: '#f6c945',
  send: {
    fill: '#e5e5e5',
    ink: '#171717',
    stopFill: 'transparent',
    stopInk: '#fcfcfc',
    stopBorder: 'rgba(255,255,255,0.14)',
  },
  reference: {
    file: '#9dbcf0',
    folder: '#e3c283',
    image: '#8ed8ab',
    skill: '#a3d9bd',
    url: '#6cb4ff',
    sideChat: '#bdb2f5',
    comment: '#b4c3ef',
    session: '#e4e4e7',
    // A board mention's own tint (`board` in reference-visual.json's `transcript`, desktop `board_mention_link`).
    board: '#5ccfc4',
  },
  meterTrack: 'rgba(158,158,158,0.24)',
  meterFill: '#b9b9b9',
  ink: (alpha) => `rgba(252,252,252,${alpha})`,
  mutedInk: (alpha) => `rgba(158,158,158,${alpha})`,
};

const LIGHT: ChatRoles = {
  light: true,
  foreground: '#27272a',
  primary: '#27272a',
  prose: '#4d4d50',
  controlPrimary: '#18181b',
  muted: '#71717b',
  cardMuted: '#71717b',
  error: '#c53030',
  inlineCodeSurface: '#efefef',
  inlineCodeBorder: 'rgba(39,39,42,0.16)',
  link: { url: '#1447e6', file: '#3f6aa8', folder: '#93631a', image: '#2a7d4c', skill: '#3d7458', comment: '#4b5c99' },
  alert: { note: '#1447e6', tip: '#009966', important: '#9810fa', warning: '#e17100', caution: '#e7000b' },
  diff: {
    added: '#16803d',
    removed: '#c53030',
    addedRow: 'rgba(34,197,94,0.12)',
    removedRow: 'rgba(239,68,68,0.12)',
    rail: '#e5e5e5',
    border: '#e5e5e5',
  },
  pressed: 'rgba(0,0,0,0.04)',
  searchMatch: 'rgba(250,204,21,0.45)',
  searchMatchActive: 'rgba(249,115,22,0.45)',
  ring: '#9f9fa9',
  ringGlow: 'rgba(159,159,169,0.20)',
  accent: '#262626',
  pressedFill: '#f5f5f5',
  neutralFill: neutralButtonFills(true).rest,
  neutralFillPressed: neutralButtonFills(true).pressed,
  destructiveFill: destructiveButtonFills('#c53030', true).rest,
  destructiveFillPressed: destructiveButtonFills('#c53030', true).pressed,
  selectedFill: 'rgba(24,24,27,0.10)',
  selectedBorder: 'rgba(24,24,27,0.30)',
  wellBorder: '#e5e5e5',
  modalBackdrop: 'rgba(0,0,0,0.38)',
  sheetBackdrop: 'rgba(0,0,0,0.3)',
  asyncDot: '#f472b6',
  asyncSpinner: '#d99a62',
  menuBorder: 'rgba(0,0,0,0.12)',
  menuForeground: '#292929',
  controlPressed: 'rgba(41,41,41,0.06)',
  grabber: 'rgba(0,0,0,0.18)',
  placeholder: 'rgba(113,113,123,0.6)',
  star: '#d97706',
  send: { fill: '#7db8fb', ink: '#ffffff', stopFill: '#f6b5b5', stopInk: '#7a2929', stopBorder: 'transparent' },
  reference: {
    file: '#3f6aa8',
    folder: '#93631a',
    image: '#2a7d4c',
    skill: '#3d7458',
    url: '#1447e6',
    sideChat: '#5a4ab0',
    comment: '#4b5c99',
    session: '#27272a',
    board: '#0f766e',
  },
  meterTrack: 'rgba(85,85,92,0.24)',
  meterFill: '#8b8b8b',
  ink: (alpha) => `rgba(39,39,42,${alpha})`,
  mutedInk: (alpha) => `rgba(113,113,123,${alpha})`,
};

/**
 * The surfaces over the chat's work-area colour `background` (`ChatAppearance::resolve`): dark fills step toward
 * white, light ones toward black, and the light composer and cards a little toward white; menus take the sidebar
 * menu colour of the same appearance (`menu`). The account-switch card's surface and tiles follow
 * `account_switch_card.rs`; the welcome's mark card is the card background 12% toward the foreground.
 */
function chatSurfaces(roles: ChatRoles, background: string, menu: string): Pick<TranscriptTheme, ChatSurfaceKey> {
  const light = roles.light;
  const up = (amount: number): string => stepTowardHex(background, true, amount);
  const down = (amount: number): string => stepTowardHex(background, false, amount);
  const lifted = (dark: number, lightAmount: number): string => (light ? down(lightAmount) : up(dark));
  const cardBackground = light ? up(0.3) : background;
  return {
    background,
    input: lifted(0.03, 0.032),
    border: lifted(0.062, 0.095),
    cardBackground,
    cardPanel: up(light ? 0.6 : 0.035),
    cardRow: lifted(0.015, 0.032),
    cardFooter: up(light ? 0.1 : 0.025),
    composerBackground: up(light ? 0.3 : 0.03),
    composerBorder: lifted(0.08, 0.067),
    controlBorder: light ? down(0.095) : 'rgba(255,255,255,0.06)',
    inputBorder: light ? down(0.095) : 'rgba(255,255,255,0.08)',
    menu,
    wellFill: light ? '#f7f7f7' : colorWithOpacity(background, 70),
    floatingSurface: up(light ? 0.7 : 0.04),
    floatingTile: light ? down(0.03) : up(0.07),
    markCard: mixHexColors(roles.foreground, cardBackground, 12),
  };
}

/** What the chat's colours read from the settings. */
type ChatThemeSettings = ThemeColourSettings & {
  sidebarTheme: SidebarThemeSetting;
  sessionChatTheme: ContentColorScheme;
};

function chatThemeSettings(settings: GhostexSettings): ChatThemeSettings {
  return {
    ...themeColourSettings(settings),
    sidebarTheme: settings.sidebarTheme,
    sessionChatTheme: settings.sessionChatTheme,
  };
}

/**
 * The few chat themes in use, newest last: the same inputs return the same object, so the per-theme style sheets
 * stay warm, while a Colourfulness drag does not keep every intermediate theme alive.
 */
const themes = new Map<string, TranscriptTheme>();
const KEPT_THEMES = 4;

/** The chat theme for `settings` with the chat drawn light or dark (`light`). */
export function transcriptThemeFor(settings: ThemeColourSettings, light: boolean): TranscriptTheme {
  const areas = resolveThemeAreas(settings, light);
  const key = `${light}|${areas.workArea}|${areas.menu}`;
  let theme = themes.get(key);
  if (theme === undefined) {
    const roles = light ? LIGHT : DARK;
    const surfaces = chatSurfaces(roles, areas.workArea, areas.menu);
    const backgrounds = [
      surfaces.background, surfaces.input, surfaces.cardBackground, surfaces.cardPanel, surfaces.cardRow,
      surfaces.cardFooter, surfaces.composerBackground, surfaces.menu, surfaces.floatingSurface,
      surfaces.floatingTile, surfaces.markCard, roles.inlineCodeSurface,
      colorOver(roles.neutralFill, surfaces.cardPanel),
      colorOver(roles.neutralFillPressed, surfaces.cardPanel),
      colorOver(roles.destructiveFill, surfaces.cardPanel),
      colorOver(roles.destructiveFillPressed, surfaces.cardPanel),
      colorOver(roles.selectedFill, surfaces.cardPanel),
    ];
    const foreground = readableSecondaryText(roles.foreground, light ? '#000000' : '#ffffff', backgrounds);
    const text = (designed: string) => readableSecondaryText(designed, foreground, backgrounds);
    theme = {
      ...roles, ...surfaces, foreground,
      primary: text(roles.primary), prose: text(roles.prose), controlPrimary: text(roles.controlPrimary),
      muted: text(roles.muted), cardMuted: text(roles.cardMuted), error: text(roles.error),
      menuForeground: text(roles.menuForeground),
      placeholder: text(colorOver(roles.placeholder, surfaces.composerBackground)),
      link: { url: text(roles.link.url), file: text(roles.link.file), folder: text(roles.link.folder), image: text(roles.link.image), skill: text(roles.link.skill), comment: text(roles.link.comment) },
      alert: { note: text(roles.alert.note), tip: text(roles.alert.tip), important: text(roles.alert.important), warning: text(roles.alert.warning), caution: text(roles.alert.caution) },
      diff: { ...roles.diff, added: text(roles.diff.added), removed: text(roles.diff.removed) },
      reference: Object.fromEntries(Object.entries(roles.reference).map(([key, value]) => [key, text(value)])),
    };
    if (themes.size >= KEPT_THEMES) themes.delete(themes.keys().next().value!);
  } else {
    themes.delete(key);
  }
  themes.set(key, theme);
  return theme;
}

/** Whether the chat draws light now, outside React (the page links opened from the chat follow it). */
export function chatIsLightNow(): boolean {
  return contentIsLight(
    useSettingsStore.getState().settings,
    'sessionChatTheme',
    Appearance.getColorScheme() === 'light',
  );
}

/** The chat theme for the current settings: Chat theme (Follow app, System, Light, Dark) over the app's colours. */
export function useTranscriptTheme(): TranscriptTheme {
  const settings = useSettingsStore(useShallow(({ settings }) => chatThemeSettings(settings)));
  const light = contentIsLight(settings, 'sessionChatTheme', useColorScheme() === 'light');
  return useMemo(() => transcriptThemeFor(settings, light), [settings, light]);
}

/**
 * A style sheet built from the chat theme, created once per theme: `const useStyles =
 * themedStyles((t) => ({ ... }))` at module scope, then `const styles = useStyles()` in a component. A sheet lives as
 * long as its theme object.
 */
export function themedStyles<T extends { [P in keyof T]: ViewStyle | TextStyle | ImageStyle }>(
  build: (theme: TranscriptTheme) => T,
): () => T {
  const sheets = new WeakMap<TranscriptTheme, T>();
  const sheetFor = (theme: TranscriptTheme): T => {
    let sheet = sheets.get(theme);
    if (sheet === undefined) {
      sheet = StyleSheet.create(build(theme));
      sheets.set(theme, sheet);
    }
    return sheet;
  };
  return () => sheetFor(useTranscriptTheme());
}

/** The transcript's one prose size and its leading (React: `0.875rem` at `1.625`). */
export const PROSE_SIZE = 14;
export const PROSE_LINE = 22.75;
/** Code inside prose and tool bodies (`--chat-code-size: 0.9em`). */
export const CODE_SIZE = 12.6;
export const CODE_LINE = 20.5;
export const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** The marker column every prose lane hangs its first line from (React's `--chat-marker-*`). */
export const MARKER_INSET = 2;
export const MARKER_SLOT = 16;
export const MARKER_GAP = 6;
/** Where a row's prose starts: inset + slot + gap. */
export const PROSE_COLUMN = MARKER_INSET + MARKER_SLOT + MARKER_GAP;
