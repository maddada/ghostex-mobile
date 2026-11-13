/**
 * Which phone screen a navigation route is, for the machine's usage analytics.
 *
 * The user asked which views are used the most (2026-10-27). The phone reports
 * a screen by one of these fixed names only: never a route parameter, a path,
 * a project or a session. gxserver accepts exactly this list (`SURFACES`,
 * `mobile_*`, in server/src/telemetry/taxonomy.rs) and drops anything else.
 * Kept free of native imports so `bun test` can check it.
 */

export type MobileView =
  | 'mobile_add_project'
  | 'mobile_browser'
  | 'mobile_changes'
  | 'mobile_beads'
  | 'mobile_files'
  | 'mobile_find'
  | 'mobile_machines'
  | 'mobile_sessions'
  | 'mobile_settings'
  | 'mobile_terminal'
  | 'mobile_voice';

const VIEW_BY_ROUTE: Record<string, MobileView> = {
  Sessions: 'mobile_sessions',
  Terminal: 'mobile_terminal',
  Docs: 'mobile_files',
  DocViewer: 'mobile_files',
  Changes: 'mobile_changes',
  Beads: 'mobile_beads',
  Bead: 'mobile_beads',
  FindPrompts: 'mobile_find',
  FindPrompt: 'mobile_find',
  WebPreviewPorts: 'mobile_browser',
  WebPreview: 'mobile_browser',
  Voice: 'mobile_voice',
  Machines: 'mobile_machines',
  MachineForm: 'mobile_machines',
  Settings: 'mobile_settings',
  SettingsPage: 'mobile_settings',
  ExtraKeysEditor: 'mobile_settings',
  AgentHotkeysEditor: 'mobile_settings',
  CommandPadKeysEditor: 'mobile_settings',
  LicenceNotice: 'mobile_settings',
  AddProjectSource: 'mobile_add_project',
  AddProjectLocal: 'mobile_add_project',
  AddProjectRepository: 'mobile_add_project',
  AddProjectDestination: 'mobile_add_project',
};

/** The view a route counts as, or null for setup and one-off screens (pairing, feedback). */
export function mobileViewForRoute(routeName: string | undefined): MobileView | null {
  if (routeName === undefined) return null;
  return Object.prototype.hasOwnProperty.call(VIEW_BY_ROUTE, routeName) ? VIEW_BY_ROUTE[routeName] : null;
}

/** The computer a route names in its `machineId` parameter, if any. */
export function machineIdForRoute(params: unknown): string | null {
  if (typeof params !== 'object' || params === null) return null;
  const machineId = (params as { machineId?: unknown }).machineId;
  return typeof machineId === 'string' && machineId.length > 0 ? machineId : null;
}

/** `ghostex client-view --client mobile --view <name> --json`; the name is one of the fixed members above. */
export function clientViewCommand(view: MobileView): string {
  return `ghostex client-view --client mobile --view ${view} --json`;
}
