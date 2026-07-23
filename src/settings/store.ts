/**
 * App settings store with the Android defaults (docs/ARCHITECTURE.md):
 * autoScroll=true, doneNotificationSound=true, refresh/upload/keyboard buttons
 * visible=true, hideKeyboardOnStartup=true, and terminal font size 13.
 * Persisted to AsyncStorage.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SETTINGS_STORAGE_KEY = 'settings.v1';

export type GhostexSettings = {
  autoScroll: boolean;
  doneNotificationSound: boolean;
  refreshButtonVisible: boolean;
  fileUploadButtonVisible: boolean;
  keyboardButtonVisible: boolean;
  hideKeyboardOnStartup: boolean;
  /** Terminal font size in pt (iOS) / sp (Android). Range 4-32. */
  fontSize: number;
};

export const TERMINAL_FONT_SIZE_MIN = 4;
export const TERMINAL_FONT_SIZE_MAX = 32;

export function defaultFontSize(): number {
  return 13;
}

export function defaultSettings(): GhostexSettings {
  return {
    autoScroll: true,
    doneNotificationSound: true,
    refreshButtonVisible: true,
    fileUploadButtonVisible: true,
    keyboardButtonVisible: true,
    hideKeyboardOnStartup: true,
    fontSize: defaultFontSize(),
  };
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
  return {
    autoScroll: bool('autoScroll', defaults.autoScroll),
    doneNotificationSound: bool('doneNotificationSound', defaults.doneNotificationSound),
    refreshButtonVisible: bool('refreshButtonVisible', defaults.refreshButtonVisible),
    fileUploadButtonVisible: bool('fileUploadButtonVisible', defaults.fileUploadButtonVisible),
    keyboardButtonVisible: bool('keyboardButtonVisible', defaults.keyboardButtonVisible),
    hideKeyboardOnStartup: bool('hideKeyboardOnStartup', defaults.hideKeyboardOnStartup),
    fontSize,
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
