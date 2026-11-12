/**
 * Turns the computer's Active projects off (`sidebarActiveProjects`), as the desktop star's Remove Active projects
 * does; Settings > Sidebar & Sessions > Spaces on the computer turns it back on (./activeProjects.ts).
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';

export async function removeActiveProjects(machine: MachineConnectionTarget): Promise<void> {
  const link = chatMachineLink(machine);
  await link.route();
  const answer = await link.rpc(
    'dispatchRendererCommand',
    { action: 'updateSettingsPatch', payload: { patch: { sidebarActiveProjects: false } } },
    15_000,
  );
  if (answer.error !== null) throw new Error(answer.error.message);
}
