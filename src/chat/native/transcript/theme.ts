/**
 * The native chat's tones and type, for the phone's two chat themes: the transcript, the composer
 * and its sheets, and the cards all read this one object (`useTranscriptTheme`), so the whole screen
 * follows Settings > Chat theme together.
 *
 * Each value is desktop's `ChatAppearance` (apps/desktop/src/app/native_chat/appearance.rs) computed
 * over the phone chat's own backgrounds (`#0e0e0e` dark, `#fdfdfd` light, the ones the retired
 * WebView chat used), so a row here reads like the same row in the GPUI chat.
 */

import { Platform, StyleSheet } from 'react-native';

import { useSettingsStore } from '../../../settings/store';

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
  link: { url: string; file: string; folder: string; image: string; skill: string };
  alert: { note: string; tip: string; important: string; warning: string; caution: string };
  diff: { added: string; removed: string; addedRow: string; removedRow: string; rail: string; border: string };
  /** A pressed row. */
  pressed: string;
  /** Search hits: every matched row, and the selected one. */
  searchHit: string;
  searchActive: string;
  /** Behind each occurrence of the query in a matched row's text, and behind the selected one. */
  searchMatch: string;
  searchMatchActive: string;

  /** Hairlines of choice rows and card buttons (`control_border`), and of inputs (`input_border`). */
  controlBorder: string;
  inputBorder: string;
  /** The status card's panel and its footer band (`card_panel`, `card_footer`). */
  cardPanel: string;
  cardFooter: string;
  /** A focused field's edge, and the glow around it (`border-ring`, ring at 20%). */
  ring: string;
  ringGlow: string;
  /** The theme accent (`theme_accent_for_variant`), used by the account-switch card. */
  accent: string;
  /** A pressed card, card header or choice. */
  pressedFill: string;
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

const DARK: TranscriptTheme = {
  light: false,
  background: '#0e0e0e',
  foreground: '#fcfcfc',
  primary: '#b4b8c0',
  prose: '#b4b8c0',
  controlPrimary: '#e5e5e5',
  muted: '#9e9e9e',
  cardMuted: '#b4b8bf',
  border: '#1d1d1d',
  input: '#151515',
  cardBackground: '#0e0e0e',
  error: '#ef9999',
  inlineCodeSurface: '#282828',
  inlineCodeBorder: 'rgba(252,252,252,0.18)',
  link: { url: '#6cb4ff', file: '#9dbcf0', folder: '#e3c283', image: '#8ed8ab', skill: '#a3d9bd' },
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
  searchHit: 'rgba(229,229,229,0.06)',
  searchActive: 'rgba(229,229,229,0.16)',
  searchMatch: 'rgba(250,204,21,0.3)',
  searchMatchActive: 'rgba(249,115,22,0.6)',
  controlBorder: 'rgba(255,255,255,0.06)',
  inputBorder: 'rgba(255,255,255,0.08)',
  cardPanel: '#1f1f1f',
  cardFooter: '#161616',
  ring: '#737373',
  ringGlow: 'rgba(115,115,115,0.20)',
  accent: '#86d3f8',
  pressedFill: 'rgba(252,252,252,0.06)',
  selectedFill: 'rgba(229,229,229,0.10)',
  selectedBorder: 'rgba(229,229,229,0.30)',
  wellFill: 'rgba(14,14,14,0.7)',
  wellBorder: 'rgba(255,255,255,0.05)',
  modalBackdrop: 'rgba(0,0,0,0.58)',
  sheetBackdrop: 'rgba(0,0,0,0.5)',
  asyncDot: '#f472b6',
  asyncSpinner: '#d99a62',
  composerBackground: '#151515',
  composerBorder: '#212121',
  menu: '#171717',
  menuBorder: 'rgba(255,255,255,0.10)',
  menuForeground: '#fcfcfc',
  controlPressed: 'rgba(252,252,252,0.08)',
  grabber: 'rgba(255,255,255,0.22)',
  placeholder: 'rgba(158,158,158,0.6)',
  star: '#f6c945',
  send: { fill: '#e5e5e5', ink: '#171717', stopFill: '#171717', stopInk: '#fcfcfc', stopBorder: 'rgba(255,255,255,0.14)' },
  reference: { file: '#9dbcf0', folder: '#e3c283', image: '#8ed8ab', skill: '#a3d9bd', url: '#6cb4ff', sideChat: '#bdb2f5' },
  floatingSurface: '#181818',
  floatingTile: '#1f1f1f',
  markCard: '#2c2c2c',
  meterTrack: 'rgba(158,158,158,0.24)',
  meterFill: '#b9b9b9',
  ink: (alpha) => `rgba(252,252,252,${alpha})`,
  mutedInk: (alpha) => `rgba(158,158,158,${alpha})`,
};

const LIGHT: TranscriptTheme = {
  light: true,
  background: '#fdfdfd',
  foreground: '#27272a',
  primary: '#27272a',
  prose: '#4d4d50',
  controlPrimary: '#18181b',
  muted: '#71717b',
  cardMuted: '#71717b',
  border: '#e5e5e5',
  input: '#f5f5f5',
  cardBackground: '#fefefe',
  error: '#c53030',
  inlineCodeSurface: '#efefef',
  inlineCodeBorder: 'rgba(39,39,42,0.16)',
  link: { url: '#1447e6', file: '#3f6aa8', folder: '#93631a', image: '#2a7d4c', skill: '#3d7458' },
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
  searchHit: 'rgba(24,24,27,0.06)',
  searchActive: 'rgba(24,24,27,0.16)',
  searchMatch: 'rgba(250,204,21,0.45)',
  searchMatchActive: 'rgba(249,115,22,0.45)',
  controlBorder: '#e5e5e5',
  inputBorder: '#e5e5e5',
  cardPanel: '#fefefe',
  cardFooter: '#fdfdfd',
  ring: '#9f9fa9',
  ringGlow: 'rgba(159,159,169,0.20)',
  accent: '#262626',
  pressedFill: '#f5f5f5',
  selectedFill: 'rgba(24,24,27,0.10)',
  selectedBorder: 'rgba(24,24,27,0.30)',
  wellFill: '#f7f7f7',
  wellBorder: '#e5e5e5',
  modalBackdrop: 'rgba(0,0,0,0.38)',
  sheetBackdrop: 'rgba(0,0,0,0.3)',
  asyncDot: '#f472b6',
  asyncSpinner: '#d99a62',
  composerBackground: '#fefefe',
  composerBorder: '#ececec',
  menu: '#ffffff',
  menuBorder: 'rgba(0,0,0,0.12)',
  menuForeground: '#292929',
  controlPressed: 'rgba(41,41,41,0.06)',
  grabber: 'rgba(0,0,0,0.18)',
  placeholder: 'rgba(113,113,123,0.6)',
  star: '#d97706',
  send: { fill: '#7db8fb', ink: '#ffffff', stopFill: '#f6b5b5', stopInk: '#7a2929', stopBorder: 'transparent' },
  reference: { file: '#3f6aa8', folder: '#93631a', image: '#2a7d4c', skill: '#3d7458', url: '#1447e6', sideChat: '#5a4ab0' },
  floatingSurface: '#fefefe',
  floatingTile: '#f5f5f5',
  markCard: '#e4e4e5',
  meterTrack: 'rgba(85,85,92,0.24)',
  meterFill: '#8b8b8b',
  ink: (alpha) => `rgba(39,39,42,${alpha})`,
  mutedInk: (alpha) => `rgba(113,113,123,${alpha})`,
};

export function transcriptTheme(theme: 'light' | 'dark'): TranscriptTheme {
  return theme === 'light' ? LIGHT : DARK;
}

/** The chat theme for the current chat setting (Settings > Chat theme). */
export function useTranscriptTheme(): TranscriptTheme {
  return transcriptTheme(useSettingsStore((store) => store.settings.sessionChatTheme));
}

/**
 * A style sheet built from the chat theme, created once per theme: `const useStyles =
 * themedStyles((t) => ({ ... }))` at module scope, then `const styles = useStyles()` in a component.
 */
export function themedStyles<T extends StyleSheet.NamedStyles<T>>(build: (theme: TranscriptTheme) => T): () => T {
  const sheets = new Map<TranscriptTheme, T>();
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
