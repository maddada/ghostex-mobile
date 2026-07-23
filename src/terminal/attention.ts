/**
 * Session-attention acknowledgement (desktop parity): tapping a session row in
 * the sessions drawer or a terminal tab clears that session's attention
 * status, exactly like clicking a session in the desktop gpui sidebar. Runs
 * `ghostex acknowledge-session-attention` and optimistically clears the local
 * inventory dot; the poll loop restores server truth if the CLI call fails.
 */

import { acknowledgeAttentionCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import { displayStatus } from '../contract/mobileSummary';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';

/**
 * Fire-and-forget: no-op unless the session's current display status is
 * `attention` (matching the desktop's acknowledge guard, which never clears
 * working/done/error states on click).
 */
export function acknowledgeSessionAttention(machineId: string, sessionId: string): void {
  const session = useInventoryStore
    .getState()
    .inventoriesByMachineId[machineId]?.summary?.sessions.find(
      (entry) => entry.sessionId === sessionId,
    );
  if (session === undefined || displayStatus(session) !== 'attention') return;
  const machine = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
  if (machine === undefined) return;
  useInventoryStore.getState().acknowledgeAttentionLocally(machineId, sessionId);
  void runGhostexCli(machine, acknowledgeAttentionCommand(sessionId))
    .then(() => useInventoryStore.getState().refreshMachine(machine))
    .catch(() => {
      // Failed acknowledge: the cleared fingerprint makes the next poll
      // restore the server-side attention state.
    });
}
