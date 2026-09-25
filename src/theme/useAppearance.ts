import { useMemo } from 'react';

import { useSettingsStore } from '../settings/store';
import { mixHexColors } from './palette';
import { resolveSidebarAppearance, type SidebarAppearance } from './sidebarAppearance';

/**
 * The sessions drawer's colors plus the few control tokens a form screen needs.
 * Every drawer token comes unchanged from `resolveSidebarAppearance`.
 */
export type Appearance = SidebarAppearance & {
  /** Text fields: one step above the page so the field edge reads. */
  input: string;
  /** Off-state switch tracks, radio rings and slider tracks. */
  control: string;
  /** Off-state switch thumb. */
  controlThumb: string;
};

let lastResolved: { tint: string; contrast: number; appearance: Appearance } | null = null;

/**
 * Resolves the phone's Background Tint and Background Contrast into page colors.
 * Equal inputs return the same object so per-appearance style caches stay warm.
 */
export function resolveAppearance(tint: string, contrast: number): Appearance {
  if (lastResolved !== null && lastResolved.tint === tint && lastResolved.contrast === contrast) {
    return lastResolved.appearance;
  }
  const sidebar = resolveSidebarAppearance(tint, contrast);
  const appearance: Appearance = {
    ...sidebar,
    input: mixHexColors(sidebar.foreground, sidebar.background, 3),
    control: mixHexColors(sidebar.foreground, sidebar.background, 22),
    controlThumb: mixHexColors(sidebar.foreground, sidebar.background, 75),
  };
  lastResolved = { tint, contrast, appearance };
  return appearance;
}

/**
 * CDXC:Theming 2026-09-25 DECISION: User (2026-09-25): "i want settings to be affected by selected colors". The Background Tint and Background Contrast chosen in Settings > Theme paint every Settings page, the Extra Keys and Agent Hotkeys editors, and their navigation headers with the same colors as the sessions drawer, and a change repaints the open page at once. The drawer keeps calling `resolveSidebarAppearance` itself, so its colors did not change.
 */
export function useAppearance(): Appearance {
  const tint = useSettingsStore((state) => state.settings.sidebarBackgroundTint);
  const contrast = useSettingsStore((state) => state.settings.sidebarBackgroundContrast);
  return useMemo(() => resolveAppearance(tint, contrast), [tint, contrast]);
}
