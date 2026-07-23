/**
 * Push settings into the native terminal engines.
 * - setTerminalSettings applies auto scroll, cursor style/blink, soft-keyboard
 *   policy, and URL-tap opening to every live/warm terminal immediately and to
 *   all future opens (both platforms).
 * - A global font-size change updates every open tab that has no per-session
 *   pinch-zoom override; overridden sessions keep their own size.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { TerminalRuntimeSettings } from '../../modules/ghostex-native/src/GhostexNative.types';
import { useTerminalStore } from '../terminal/sessions';
import { useSettingsStore, type GhostexSettings } from './store';

let installed = false;
let lastRuntimeJson = '';
let lastFontSize: number | null = null;

function runtimeSettings(settings: GhostexSettings): TerminalRuntimeSettings {
  return {
    autoScroll: settings.autoScroll,
    cursorStyle: settings.cursorStyle,
    cursorBlink: settings.cursorBlink,
    softKeyboardEnabled: settings.softKeyboardEnabled,
    openUrlsOnTap: settings.openUrlsOnTap,
  };
}

function syncRuntimeSettings(settings: GhostexSettings): void {
  const runtime = runtimeSettings(settings);
  const json = JSON.stringify(runtime);
  if (json === lastRuntimeJson) return;
  lastRuntimeJson = json;
  void GhostexNative.setTerminalSettings(runtime).catch(() => {
    // The module may not be ready during teardown; the next change re-syncs.
  });
}

function syncDefaultFontSize(settings: GhostexSettings): void {
  if (settings.fontSize === lastFontSize) return;
  const isFirstSync = lastFontSize === null;
  lastFontSize = settings.fontSize;
  // Native entries opened before this run already got their initial size from
  // openTerminal; only live changes need to be pushed.
  if (isFirstSync) return;
  const { tabs, fontSizeBySessionKey } = useTerminalStore.getState();
  for (const tab of tabs) {
    if (fontSizeBySessionKey[tab.sessionKey] !== undefined) continue;
    void GhostexNative.setFontSize(tab.sessionKey, settings.fontSize).catch(() => undefined);
  }
}

/** Install once at app startup; re-applies whenever settings change. */
export function initSettingsNativeSync(): void {
  if (installed) return;
  installed = true;
  const apply = (): void => {
    const state = useSettingsStore.getState();
    if (!state.hydrated) return;
    syncRuntimeSettings(state.settings);
    syncDefaultFontSize(state.settings);
  };
  useSettingsStore.subscribe(apply);
  apply();
}
