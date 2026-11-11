/**
 * The `origin` remote of the chat's project, which the core turns into where the transcript's
 * `#123` links go (`Event::ProjectOriginChanged`, gx-chat-core `transcript/issue_links.rs`). The
 * phone reads it from the computer's inventory, the same probe the Unified list names projects by;
 * the core decides whether it is a GitHub repository and what the address is.
 */

import { useInventoryStore } from '../../inventory/store';

/** The project's `origin` as its computer probed it, or null without one. */
export function projectOrigin(machineId: string, projectId: string): string | null {
  const projects = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary?.projects ?? [];
  const origin = projects.find((project) => project.projectId === projectId)?.gitRemoteOriginUrl;
  return origin !== undefined && origin.length > 0 ? origin : null;
}

/** Calls `listener` whenever the project's `origin` changes. */
export function subscribeProjectOrigin(
  machineId: string,
  projectId: string,
  listener: (origin: string | null) => void,
): () => void {
  let last = projectOrigin(machineId, projectId);
  return useInventoryStore.subscribe((state, previous) => {
    if (state.inventoriesByMachineId[machineId] === previous.inventoriesByMachineId[machineId]) return;
    const next = projectOrigin(machineId, projectId);
    if (next === last) return;
    last = next;
    listener(next);
  });
}
