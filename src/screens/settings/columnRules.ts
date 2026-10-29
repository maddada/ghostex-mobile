/**
 * Settings in two columns on the iPhone Duo's inner display in landscape, like the iPad's Settings: the Settings list on the left, the open page on the right.
 *
 * The stack stays the one source of where the user is: Settings, then the open page (a `SettingsPage`
 * route), then any page opened from it (Keyboard's editors, Chat's read-aloud voice). The two columns
 * only draw that stack side by side, so turning the phone keeps the user's place both ways: a page open
 * in portrait is the selected page in landscape, and the selected page is still open in portrait.
 * Kept free of React Native so its rules are testable under `bun test`.
 */

import type { SettingsPageId } from './pages';

/** The routes Settings is made of. */
const SETTINGS_ROUTES: ReadonlySet<string> = new Set([
  'Settings',
  'SettingsPage',
  'ExtraKeysEditor',
  'AgentHotkeysEditor',
]);

/** The page selected while none was opened yet: the first of the list (Theme). */
export const DEFAULT_SETTINGS_PAGE: SettingsPageId = 'theme';

export function isSettingsRoute(name: string): boolean {
  return SETTINGS_ROUTES.has(name);
}

/** A stack route as far as the columns care: its name and, for a `SettingsPage`, its page. */
export type ColumnRoute = { readonly name: string; readonly page?: SettingsPageId };

export type SettingsColumns = {
  /** Where Settings itself is in the stack. */
  readonly settingsIndex: number;
  /** The list's selected row: the first page opened after Settings, else the default. */
  readonly selected: SettingsPageId;
  /** The right column shows a page opened from the selected one, which goes back to it. */
  readonly subPage: boolean;
};

/**
 * The columns for the route at `index`, or null when it is not part of Settings opened from its list
 * (another screen above it, or a Settings page reached without the list under it).
 */
export function settingsColumnsFor(routes: readonly ColumnRoute[], index: number): SettingsColumns | null {
  let settingsIndex = -1;
  for (let at = index; at >= 0; at -= 1) {
    const name = routes[at]?.name;
    if (name === undefined || !isSettingsRoute(name)) return null;
    if (name === 'Settings') {
      settingsIndex = at;
      break;
    }
  }
  if (settingsIndex < 0) return null;
  const opened = routes.slice(settingsIndex + 1, index + 1).findIndex((route) => route.name === 'SettingsPage');
  if (opened < 0) return { settingsIndex, selected: DEFAULT_SETTINGS_PAGE, subPage: index > settingsIndex };
  const pageIndex = settingsIndex + 1 + opened;
  return {
    settingsIndex,
    selected: routes[pageIndex]?.page ?? DEFAULT_SETTINGS_PAGE,
    subPage: index > pageIndex,
  };
}
