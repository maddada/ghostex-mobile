/**
 * Whether a computer has the Beads view switched on: its Settings > Extensions > Beads switch
 * (`kanbanViewTabHidden`), which its session summary names in `builtInFeatures` (id `kanban`)
 * only while it is on. While it is off, or the computer is too old to say, the phone shows no
 * Beads row in the session or terminal menus, opens no Beads screen, and sends no Beads call
 * (`client.ts` refuses before anything leaves the phone), so no read, poll or sync runs for it.
 *
 * CDXC:ProjectBoard 2026-11-13 DECISION:
 * User: "don't show on phone if beads disabled on pc and skip this code, don't run it unless beads extension is enabled on that pc". Read from `builtInFeatures`, not `builtInFeaturesOff`, like Read aloud (`voice/readAloud.ts`): a computer whose gxserver predates the flag leaves it out and counts as off.
 * SEE-ALSO: server/src/ghostex_cli/sessions/mobile_summary.rs (`insert_built_in_features`), server/src/ghostex_cli/session_chat_rpc.rs (the SSH bridge refuses Beads calls while it is off).
 */

import { useInventoryStore } from '../inventory/store';

/** The Beads view's built-in extension id, as the computer lists it (the desktop's `kanban`). */
export const BEADS_FEATURE = 'kanban';

/** Whether Beads is on for a computer whose session summary is `summary` (none yet: off). */
export function beadsOnIn(summary: { builtInFeatures?: readonly string[] } | null | undefined): boolean {
  return summary?.builtInFeatures?.includes(BEADS_FEATURE) === true;
}

/** Whether Beads is on for computer `machineId`, from the summary the phone holds now. */
export function beadsOnFor(machineId: string): boolean {
  return beadsOnIn(useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary);
}

/** `beadsOnFor` as a hook, so a screen follows the switch while it is open. */
export function useBeadsOn(machineId: string | null | undefined): boolean {
  return useInventoryStore((state) =>
    machineId === null || machineId === undefined ? false : beadsOnIn(state.inventoriesByMachineId[machineId]?.summary),
  );
}
