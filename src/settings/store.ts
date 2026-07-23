/**
 * App settings store. Group/row order mirrors the legacy Android Settings page
 * (artifacts/001-mobile-settings-report/report.md): Terminal behavior, Extra
 * keys, Font size, Scrollback, Cursor, Alerts and hardware keys, then the
 * appended SSH connection group. Persisted to AsyncStorage under settings.v1
 * (new fields sanitize to their defaults for existing installs).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { CursorStyle } from '../../modules/ghostex-native/src/GhostexNative.types';

const SETTINGS_STORAGE_KEY = 'settings.v1';

export type BellBehavior = 'vibrate' | 'beep' | 'ignore';

export type GhostexSettings = {
  // Terminal behavior (legacy Android row order).
  autoScroll: boolean;
  extraKeysToolbarVisible: boolean;
  softKeyboardEnabled: boolean;
  keepScreenOn: boolean;
  refreshButtonVisible: boolean;
  fileUploadButtonVisible: boolean;
  keyboardButtonVisible: boolean;
  doneNotificationSound: boolean;
  hideKeyboardOnStartup: boolean;
  openUrlsOnTap: boolean;
  /** Terminal font size in pt (iOS) / sp (Android). Range 4-32. */
  fontSize: number;
  /** Scrollback rows for newly created terminal buffers. */
  scrollbackRows: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  bellBehavior: BellBehavior;
  // SSH connection (appended group).
  autoReconnect: boolean;
  keepAliveEnabled: boolean;
  /** Keep-alive interval in seconds, 10-120 in 10-second steps. */
  keepAliveIntervalSec: number;
};

export const TERMINAL_FONT_SIZE_MIN = 4;
export const TERMINAL_FONT_SIZE_MAX = 32;

export const SCROLLBACK_ROW_OPTIONS = [2_000, 10_000, 50_000] as const;
export const CURSOR_STYLE_OPTIONS: CursorStyle[] = ['block', 'underline', 'bar'];
export const BELL_BEHAVIOR_OPTIONS: BellBehavior[] = ['vibrate', 'beep', 'ignore'];

export const KEEP_ALIVE_INTERVAL_MIN_SEC = 10;
export const KEEP_ALIVE_INTERVAL_MAX_SEC = 120;
export const KEEP_ALIVE_INTERVAL_STEP_SEC = 10;

export function defaultFontSize(): number {
  return 13;
}

export function defaultSettings(): GhostexSettings {
  return {
    autoScroll: true,
    extraKeysToolbarVisible: true,
    softKeyboardEnabled: true,
    keepScreenOn: false,
    refreshButtonVisible: true,
    fileUploadButtonVisible: true,
    keyboardButtonVisible: true,
    doneNotificationSound: true,
    hideKeyboardOnStartup: true,
    openUrlsOnTap: true,
    fontSize: defaultFontSize(),
    scrollbackRows: 10_000,
    cursorStyle: 'block',
    cursorBlink: true,
    bellBehavior: 'vibrate',
    autoReconnect: true,
    keepAliveEnabled: true,
    keepAliveIntervalSec: 30,
  };
}

function clampKeepAliveInterval(value: number): number {
  const stepped =
    Math.round(value / KEEP_ALIVE_INTERVAL_STEP_SEC) * KEEP_ALIVE_INTERVAL_STEP_SEC;
  return Math.min(KEEP_ALIVE_INTERVAL_MAX_SEC, Math.max(KEEP_ALIVE_INTERVAL_MIN_SEC, stepped));
}

function sanitizeSettings(value: unknown): GhostexSettings {
  const defaults = defaultSettings();
  if (typeof value !== 'object' || value === null) return defaults;
  const record = value as Record<string, unknown>;
  const bool = (key: keyof GhostexSettings, fallback: boolean): boolean =>
    typeof record[key] === 'boolean' ? (record[key] as boolean) : fallback;
  const fontSize =
    typeof record.fontSize === 'number' && Number.isFinite(record.fontSize)
      ? Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(record.fontSize)))
      : defaults.fontSize;
  const scrollbackRows = (SCROLLBACK_ROW_OPTIONS as readonly number[]).includes(
    record.scrollbackRows as number,
  )
    ? (record.scrollbackRows as number)
    : defaults.scrollbackRows;
  const cursorStyle = CURSOR_STYLE_OPTIONS.includes(record.cursorStyle as CursorStyle)
    ? (record.cursorStyle as CursorStyle)
    : defaults.cursorStyle;
  const bellBehavior = BELL_BEHAVIOR_OPTIONS.includes(record.bellBehavior as BellBehavior)
    ? (record.bellBehavior as BellBehavior)
    : defaults.bellBehavior;
  const keepAliveIntervalSec =
    typeof record.keepAliveIntervalSec === 'number' && Number.isFinite(record.keepAliveIntervalSec)
      ? clampKeepAliveInterval(record.keepAliveIntervalSec)
      : defaults.keepAliveIntervalSec;
  return {
    autoScroll: bool('autoScroll', defaults.autoScroll),
    extraKeysToolbarVisible: bool('extraKeysToolbarVisible', defaults.extraKeysToolbarVisible),
    softKeyboardEnabled: bool('softKeyboardEnabled', defaults.softKeyboardEnabled),
    keepScreenOn: bool('keepScreenOn', defaults.keepScreenOn),
    refreshButtonVisible: bool('refreshButtonVisible', defaults.refreshButtonVisible),
    fileUploadButtonVisible: bool('fileUploadButtonVisible', defaults.fileUploadButtonVisible),
    keyboardButtonVisible: bool('keyboardButtonVisible', defaults.keyboardButtonVisible),
    doneNotificationSound: bool('doneNotificationSound', defaults.doneNotificationSound),
    hideKeyboardOnStartup: bool('hideKeyboardOnStartup', defaults.hideKeyboardOnStartup),
    openUrlsOnTap: bool('openUrlsOnTap', defaults.openUrlsOnTap),
    fontSize,
    scrollbackRows,
    cursorStyle,
    cursorBlink: bool('cursorBlink', defaults.cursorBlink),
    bellBehavior,
    autoReconnect: bool('autoReconnect', defaults.autoReconnect),
    keepAliveEnabled: bool('keepAliveEnabled', defaults.keepAliveEnabled),
    keepAliveIntervalSec,
  };
}

type SettingsState = {
  hydrated: boolean;
  settings: GhostexSettings;
  hydrate: () => Promise<void>;
  setSetting: <K extends keyof GhostexSettings>(key: K, value: GhostexSettings[K]) => void;
};

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  hydrated: false,
  settings: defaultSettings(),

  hydrate: async () => {
    if (get().hydrated) return;
    let settings = defaultSettings();
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_STORAGE_KEY);
      if (raw !== null) settings = sanitizeSettings(JSON.parse(raw));
    } catch {
      // Corrupt persisted settings fall back to defaults.
    }
    set({ hydrated: true, settings });
  },

  setSetting: (key, value) => {
    const settings = { ...get().settings, [key]: value };
    set({ settings });
    void AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  },
}));
