/**
 * Path-submission rules shared by the local and destination screens
 * plus Ghostex's client-known duplicate check.
 */

import type { GhostexProject } from '../contract/mobileSummary';
import { useInventoryStore } from '../inventory/store';
import { hasTrailingPathSeparator, isAbsoluteRemotePath, remotePathIdentity } from './paths';
import type { DirectoryBrowseState } from './useDirectoryBrowse';

/** Every path screen starts at the machine's home directory. */
export const ADD_PROJECT_DEFAULT_PATH = '~/';

/**
 * Which path is actually submitted: a query ending in a separator submits the
 * SERVER-resolved absolute directory (already `~`-expanded), otherwise an
 * exact entry match wins, otherwise the raw text goes to the server as typed.
 */
export function resolveSubmittedPath(trimmedQuery: string, browse: DirectoryBrowseState): string {
  if (hasTrailingPathSeparator(trimmedQuery)) {
    return browse.result?.parentPath ?? trimmedQuery;
  }
  return browse.exactEntry?.fullPath ?? trimmedQuery;
}

/**
 * Whether submitting would create the folder. Unknown while a browse is in
 * flight or failed — the button then keeps its plain label and the server
 * stays the authority.
 */
export function willCreateSubmittedPath(query: string, browse: DirectoryBrowseState): boolean {
  const trimmed = query.trim();
  if (trimmed.length === 0 || browse.pending || browse.error !== null) return false;
  return hasTrailingPathSeparator(trimmed) ? browse.result === null : browse.exactEntry === null;
}

/**
 * A project already registered on this machine at the same path, from the
 * inventory the drawer already holds. Only absolute paths can be compared:
 * `~` expansion happens on the server, so a still-unexpanded query is left to
 * gxserver's own idempotent add.
 */
export function duplicateProjectFor(machineId: string, path: string): GhostexProject | null {
  if (!isAbsoluteRemotePath(path)) return null;
  const normalized = remotePathIdentity(path);
  const projects = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary?.projects ?? [];
  return (
    projects.find((project) => project.path !== undefined && remotePathIdentity(project.path) === normalized) ?? null
  );
}
