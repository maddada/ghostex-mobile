/**
 * The computers a handoff can go to, from what the phone knows of each one (its inventory).
 * The rules are `contract/handoff/handoff.ts`'s.
 * SEE-ALSO: apps/desktop/src/app/gx_store/git/export_handoff_remote.rs (`git_export_handoff_computers`).
 */

import {
  handoffComputers,
  type HandoffComputer,
  type HandoffMachineInput,
} from '../../../contract/handoff/handoff';
import { useInventoryStore } from '../../../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../../../machines/store';

export function handoffComputersFor(machineId: string, projectId: string): HandoffComputer[] {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const inputs: HandoffMachineInput[] = [];
  for (const machine of enabledMachines(useMachinesStore.getState())) {
    const inventory = inventories[machine.id];
    const summary = inventory?.summary ?? null;
    if (summary === null) continue;
    inputs.push({
      machineId: machine.id,
      // The button says this, so a plain name: not Easy Connect's transport tag.
      label: machine.name.length > 0 ? machine.name : machineDisplayLabel(machine),
      connected: (inventory?.lastError ?? null) === null,
      projects: summary.projects.map((project) => ({
        projectId: project.projectId,
        title: project.name ?? project.projectId,
        path: project.path ?? null,
        originUrl: project.gitRemoteOriginUrl ?? null,
        isWorktree: project.worktree !== undefined,
      })),
    });
  }
  return handoffComputers(inputs, { machineId, projectId });
}
