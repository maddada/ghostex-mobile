/**
 * The transcript's tones and type, for the phone's two chat themes.
 *
 * Each value is desktop's `ChatAppearance` (apps/desktop/src/app/native_chat/appearance.rs) computed
 * over the phone chat's own backgrounds (`#0e0e0e` dark, `#fdfdfd` light, the WebView chat's
 * `CHAT_BACKGROUNDS`), so a row here reads like the same row in the GPUI chat and in the React chat
 * it replaces (packages/core-ui/styles/chat.css).
 */

import { Platform } from 'react-native';

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
  /** Link colours by reference kind (`reference-visual.json`, lightened toward white in dark). */
  link: { url: string; file: string; folder: string; image: string; skill: string };
  alert: { note: string; tip: string; important: string; warning: string; caution: string };
  diff: { added: string; removed: string; addedRow: string; removedRow: string; rail: string; border: string };
  /** A pressed row. */
  pressed: string;
  /** Search hits: every matched row, and the selected one. */
  searchHit: string;
  searchActive: string;
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
  link: { url: '#51a2ff', file: '#95a4b7', folder: '#b6a689', image: '#8cb59e', skill: '#91a99a' },
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
  link: { url: '#1447e6', file: '#6c819b', folder: '#9a835b', image: '#5f9878', skill: '#668773' },
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
};

export function transcriptTheme(theme: 'light' | 'dark'): TranscriptTheme {
  return theme === 'light' ? LIGHT : DARK;
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
