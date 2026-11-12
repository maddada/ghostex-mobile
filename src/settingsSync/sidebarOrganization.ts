/**
 * Sidebar organization on the phone: the settings that change how the sessions list is organized, as Sidebar
 * organization sync carries them between computers (`spaces/setting/<key>`, gx-core settings_sync/settings_keys.rs
 * `SIDEBAR_ORGANIZATION_KEYS`). The phone applies the synced value of each, by laying it over every computer's
 * summary (`organizeSummary`, used by the inventory store), so every rule that reads the computer's setting (the
 * Project list in contract/grouping.ts, the Unified list in contract/unified/, Spaces, menus) reads the synced one.
 *
 * CDXC:SettingsSync 2026-11-12 DECISION:
 * User: "I want my phone sessions list to be just kind my macbook sessions list exactly pls add all the settings and stuff we need and add sync for this please". This reverses Q933 (the phone's Project/Unified switch phone-only): the phone follows the same synced Sidebar organization as the computers, a change made on a computer shows on the phone, and a change made on the phone goes to the computers, the newest edit of each key winning as between computers. What each value is, in order: the synced entry; else what this phone set before this change (its old Sessions list switches, for computers without Sidebar organization sync, which keep today's behaviour); else the computer's own setting from its summary; else the desktop's default. Looks (card details, sizes, animations, hover buttons) stay on each device, as on the desktop.
 * SEE-ALSO: packages/gx-core/src/settings_sync/settings_keys.rs, server/src/settings_sync/exchange.rs (a phone's edits merge there), settingsSync.ts (`editSyncedEntry`).
 */

import { EMPTY_SIDEBAR_SPACES } from '../contract/mobileSummary/model';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import { useSettingsStore, type GhostexSettings } from '../settings/store';
import { useSyncedEntriesStore } from './syncedEntries';

/** The prefix of a Sidebar organization setting's synced key. */
export const SIDEBAR_ORGANIZATION_PREFIX = 'spaces/setting/';

/** The synced settings, by their desktop settings key, with the value each holds. */
export type SidebarOrganization = {
  sidebarView: 'project' | 'unified';
  sidebarSeparateByMachine: boolean;
  sidebarMergeRepositoryCopies: boolean;
  worktreeSessionsInProject: boolean;
  sidebarSpacesEnabled: boolean;
  sidebarActiveProjects: boolean;
  chiefShowOnAllSpaces: boolean;
  sidebarHideProjectsWithoutSessions: boolean;
  groupWorkingSessions: boolean;
  enableSessionParking: boolean;
  pinnedSessionOrder: 'manual' | 'recent';
  unifiedWorkingSection: boolean;
  unifiedGroupByProject: boolean;
  unifiedProjectOrder: string[];
  sidebarSessionTagListItems: unknown[] | null;
};

export type SidebarOrganizationKey = keyof SidebarOrganization;

/** The desktop's defaults (packages/settings-catalog data/defaults.rs); the tag list's is the first-run list. */
export const SIDEBAR_ORGANIZATION_DEFAULTS: SidebarOrganization = {
  sidebarView: 'project',
  sidebarSeparateByMachine: false,
  sidebarMergeRepositoryCopies: true,
  worktreeSessionsInProject: true,
  sidebarSpacesEnabled: false,
  sidebarActiveProjects: true,
  chiefShowOnAllSpaces: false,
  sidebarHideProjectsWithoutSessions: false,
  groupWorkingSessions: false,
  enableSessionParking: true,
  pinnedSessionOrder: 'manual',
  unifiedWorkingSection: true,
  unifiedGroupByProject: false,
  unifiedProjectOrder: [],
  sidebarSessionTagListItems: null,
};

export const SIDEBAR_ORGANIZATION_KEYS = Object.keys(SIDEBAR_ORGANIZATION_DEFAULTS) as SidebarOrganizationKey[];

/** A synced value as the key's type, or `undefined` for one this phone cannot read. */
function readValue<K extends SidebarOrganizationKey>(key: K, value: unknown): SidebarOrganization[K] | undefined {
  switch (key) {
    case 'sidebarView':
      return (value === 'unified' || value === 'project' ? value : undefined) as SidebarOrganization[K] | undefined;
    case 'pinnedSessionOrder':
      return (value === 'recent' || value === 'manual' ? value : undefined) as SidebarOrganization[K] | undefined;
    case 'unifiedProjectOrder':
      return (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : undefined) as
        | SidebarOrganization[K]
        | undefined;
    case 'sidebarSessionTagListItems':
      return (Array.isArray(value) ? value : undefined) as SidebarOrganization[K] | undefined;
    default:
      return (typeof value === 'boolean' ? value : undefined) as SidebarOrganization[K] | undefined;
  }
}

/** The synced values the phone holds, by settings key. */
export function syncedSidebarValues(values: Record<string, unknown>): Partial<SidebarOrganization> {
  const result: Partial<Record<SidebarOrganizationKey, unknown>> = {};
  for (const key of SIDEBAR_ORGANIZATION_KEYS) {
    const value = readValue(key, values[`${SIDEBAR_ORGANIZATION_PREFIX}${key}`]);
    if (value !== undefined) result[key] = value;
  }
  return result as Partial<SidebarOrganization>;
}

/**
 * What the phone set itself before Sidebar organization sync reached it (its old Settings › Sessions list
 * switches), kept for computers without the sync.
 */
function phoneOwnValues(settings: GhostexSettings): Partial<SidebarOrganization> {
  const own: Partial<SidebarOrganization> = {};
  if (settings.sessionsListLayout !== null) {
    own.sidebarView = settings.sessionsListLayout;
    own.unifiedGroupByProject = settings.sessionsListGroupByProject;
    own.unifiedWorkingSection = settings.sessionsListWorkingSection;
  }
  if (settings.sessionsListHideProjectsWithoutSessions !== null) {
    own.sidebarHideProjectsWithoutSessions = settings.sessionsListHideProjectsWithoutSessions;
  }
  return own;
}

/** The computer's own values, as its summary carries them (absent keys are the defaults). */
export function computerSidebarValues(summary: GhostexMobileSummary): Partial<SidebarOrganization> {
  return {
    sidebarView: summary.sidebarView ?? 'project',
    sidebarSeparateByMachine: summary.separateByMachine === true,
    sidebarMergeRepositoryCopies: summary.mergeRepositoryCopies !== false,
    worktreeSessionsInProject: summary.worktreeSessionsInProject !== false,
    sidebarActiveProjects: summary.sidebarActiveProjects !== false,
    chiefShowOnAllSpaces: summary.chiefShowOnAllSpaces === true,
    sidebarHideProjectsWithoutSessions: summary.sidebarHideProjectsWithoutSessions === true,
    enableSessionParking: summary.enableSessionParking !== false,
    pinnedSessionOrder: summary.pinnedSessionOrder === 'recent' ? 'recent' : 'manual',
    unifiedWorkingSection: summary.unifiedWorkingSection !== false,
    unifiedGroupByProject: summary.unifiedGroupByProject === true,
    unifiedProjectOrder: summary.unifiedProjectOrder ?? [],
  };
}

/** Each value the list follows, given the synced values, the phone's own and the computer's summary. */
export function sidebarOrganizationOf(
  summary: GhostexMobileSummary | null,
  synced: Partial<SidebarOrganization>,
  own: Partial<SidebarOrganization>,
): SidebarOrganization {
  return {
    ...SIDEBAR_ORGANIZATION_DEFAULTS,
    ...(summary === null ? {} : computerSidebarValues(summary)),
    ...own,
    ...synced,
  };
}

/** The current organization for `summary`'s computer (null: no computer, defaults and the phone's own values). */
export function currentSidebarOrganization(summary: GhostexMobileSummary | null): SidebarOrganization {
  return sidebarOrganizationOf(
    summary,
    syncedSidebarValues(useSyncedEntriesStore.getState().values),
    phoneOwnValues(useSettingsStore.getState().settings),
  );
}

/** The current organization, re-rendering when it changes. */
export function useSidebarOrganization(summary: GhostexMobileSummary | null): SidebarOrganization {
  const values = useSyncedEntriesStore((state) => state.values);
  const settings = useSettingsStore((state) => state.settings);
  return sidebarOrganizationOf(summary, syncedSidebarValues(values), phoneOwnValues(settings));
}

/**
 * `summary` with the organization laid over the computer's own settings. Spaces turned off leaves the Space row
 * out, as the desktop does; Spaces turned on can only show what the computer sends (a computer whose own switch is
 * off sends none, server/src/ghostex_cli/sessions/inventory.rs).
 */
export function organizeSummary(summary: GhostexMobileSummary): GhostexMobileSummary {
  const synced = syncedSidebarValues(useSyncedEntriesStore.getState().values);
  const own = phoneOwnValues(useSettingsStore.getState().settings);
  if (Object.keys(synced).length === 0 && Object.keys(own).length === 0) return summary;
  const organization = sidebarOrganizationOf(summary, synced, own);
  const spacesOff = synced.sidebarSpacesEnabled === false;
  return {
    ...summary,
    sidebarView: organization.sidebarView,
    separateByMachine: organization.sidebarSeparateByMachine,
    mergeRepositoryCopies: organization.sidebarMergeRepositoryCopies,
    worktreeSessionsInProject: organization.worktreeSessionsInProject,
    sidebarActiveProjects: organization.sidebarActiveProjects,
    chiefShowOnAllSpaces: organization.chiefShowOnAllSpaces,
    sidebarHideProjectsWithoutSessions: organization.sidebarHideProjectsWithoutSessions,
    groupWorkingSessions: organization.groupWorkingSessions,
    enableSessionParking: organization.enableSessionParking,
    pinnedSessionOrder: organization.pinnedSessionOrder,
    unifiedWorkingSection: organization.unifiedWorkingSection,
    unifiedGroupByProject: organization.unifiedGroupByProject,
    unifiedProjectOrder: organization.unifiedProjectOrder,
    sessionTagListItems: organization.sidebarSessionTagListItems ?? undefined,
    sidebarSpaces: spacesOff ? EMPTY_SIDEBAR_SPACES : summary.sidebarSpaces,
  };
}

/**
 * Whether a computer's summary shows a value other than the synced one while that computer syncs Sidebar
 * organization: the computer changed it since the last exchange (or has not taken the phone's edit yet), so an
 * exchange now brings the two together instead of on the next half-minute round.
 */
export function computerDiffersFromSynced(
  summary: GhostexMobileSummary,
  synced: Partial<SidebarOrganization>,
): string | null {
  const computer = computerSidebarValues(summary);
  const differing: string[] = [];
  for (const key of Object.keys(computer) as SidebarOrganizationKey[]) {
    if (!(key in synced)) continue;
    if (JSON.stringify(computer[key]) !== JSON.stringify(synced[key])) differing.push(`${key}=${JSON.stringify(computer[key])}`);
  }
  return differing.length === 0 ? null : differing.join('&');
}
