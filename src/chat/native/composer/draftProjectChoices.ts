/**
 * The tray's project chip: the choices it offers and the move a pick makes.
 *
 * CDXC:Worktrees 2026-10-31 DECISION:
 * User (Q847, Q856): the phone's tray picks the project and machine like the desktop's. A session row can't change project, so a pick starts the same agent as a draft there, with the composer's text, opens it, then gxserver closes this draft (`/api/draftWorktree {finish, moved}`), which only closes a session still a draft. If the start fails the draft stays open with its text.
 * SEE-ALSO: apps/desktop/src/app/gx_store/unified_new_session.rs.
 */

import {
  unifiedProjectChoices,
  type UnifiedChoiceMachineInput,
  type UnifiedProjectChoice,
} from '../../../contract/unified/choices';
import { unifiedMachineInput } from '../../../contract/unified/fromSummary';
import { useInventoryStore } from '../../../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../../../machines/store';
import { useUnifiedListStore } from '../../../screens/sessions-screen/unified-list-store';
import { sessionChatRpc } from '../../rust/transport';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { createAgentWithFirstInputDraft, machineAgents, openSessionTab } from '../sessionShell';

export function draftProjectChoices(currentMachineId: string): UnifiedProjectChoice[] {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const machines = enabledMachines(useMachinesStore.getState());
  const inputs: UnifiedChoiceMachineInput[] = [];
  for (const machine of machines) {
    const inventory = inventories[machine.id];
    const summary = inventory?.summary ?? null;
    if (summary === null) continue;
    const label = machineDisplayLabel(machine);
    const { projects } = unifiedMachineInput({ machineId: machine.id, label, summary, workspaceId: null }, false);
    inputs.push({ machine: machine.id, label, connected: (inventory?.lastError ?? null) === null, projects });
  }
  return unifiedProjectChoices(
    inputs,
    useUnifiedListStore.getState().lastMachines,
    currentMachineId,
    currentMachineId,
  );
}

export async function moveDraftToProject(input: {
  from: MachineConnectionTarget;
  fromProjectId: string;
  fromSessionId: string;
  agentId: string;
  text: string;
  repoKey: string;
  to: MachineConnectionTarget;
  toProjectId: string;
}): Promise<void> {
  const { from, to, agentId } = input;
  const agent = machineAgents(to.id).find((entry) => entry.agentId === agentId) ?? { agentId };
  const sessionId = await createAgentWithFirstInputDraft(to, {
    projectId: input.toProjectId,
    agent,
    draft: input.text,
  });
  useUnifiedListStore.getState().noteLastMachine(input.repoKey, to.id);
  await openSessionTab(to, sessionId, input.toProjectId);
  await sessionChatRpc(from, 'draftWorktree', {
    projectId: input.fromProjectId,
    sessionId: input.fromSessionId,
    finish: true,
    moved: true,
  });
}
