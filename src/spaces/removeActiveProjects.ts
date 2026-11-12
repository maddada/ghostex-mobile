/**
 * Turns Active projects off (`sidebarActiveProjects`), as the desktop star's Remove Active projects does: in Sidebar
 * organization sync, so the star leaves the phone at once and every syncing computer, and on this computer itself,
 * which also covers a computer without the sync. Settings > Sidebar & Sessions > Spaces turns it back on, on the phone
 * or a computer (./activeProjects.ts).
 */

import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';
import { setSidebarSetting } from '../settingsSync/settingsSync';

export async function removeActiveProjects(machine: MachineConnectionTarget): Promise<void> {
  setSidebarSetting('sidebarActiveProjects', false);
  const link = chatMachineLink(machine);
  await link.route();
  const answer = await link.rpc(
    'dispatchRendererCommand',
    { action: 'updateSettingsPatch', payload: { patch: { sidebarActiveProjects: false } } },
    15_000,
  );
  if (answer.error !== null) throw new Error(answer.error.message);
}
