/**
 * The tray's project chip: the choices it offers and the move a pick makes.
 *
 * CDXC:Worktrees 2026-10-31 DECISION:
 * User (Q847, Q856): the phone's tray picks the project and machine like the desktop's. A session row can't change project, so a pick starts the same agent as a draft there, with the composer's text, opens it, then gxserver closes this draft (`/api/draftWorktree {finish, moved}`), which only closes a session still a draft. If the start fails the draft stays open with its text.
 *
 * CDXC:Worktrees 2026-11-03 DECISION:
 * User (Q1186 "split"): the tray has a project chip that lists projects only, and a machine chip beside it that changes the machine, the same model as the agent menu; both move the draft as above. This supersedes Q848's machine chips inside the project search.
 * SEE-ALSO: apps/desktop/src/app/gx_store/unified_new_session.rs.
 */

import type { UnifiedProjectChoice } from '../../../contract/unified/choices';
import { noteNewSessionIn, projectChoicesNow } from '../../../screens/sessions-screen/new-session-place';
import { sessionChatRpc } from '../../rust/transport';
import type { MachineConnectionTarget } from '../../../machines/credentials';
import { createAgentWithFirstInputDraft, machineAgents, openSessionTab } from '../sessionShell';

export function draftProjectChoices(currentMachineId: string): UnifiedProjectChoice[] {
  return projectChoicesNow(currentMachineId);
}

export async function moveDraftToProject(input: {
  from: MachineConnectionTarget;
  fromProjectId: string;
  fromSessionId: string;
  agentId: string;
  text: string;
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
  // As every start notes it: the repository merged across computers, a lone computer as `local`, and
  // the project's Space, so a Unified filter narrowed by computer or Space widens to show the draft.
  noteNewSessionIn(to.id, input.toProjectId);
  await openSessionTab(to, sessionId, input.toProjectId);
  await sessionChatRpc(from, 'draftWorktree', {
    projectId: input.fromProjectId,
    sessionId: input.fromSessionId,
    finish: true,
    moved: true,
  });
}
