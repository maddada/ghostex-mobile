/**
 * What a Machines card says (docs/2026-09-03/mobile-setup/mobile-07-machines.html):
 * which computer (name + status badge), how it is reached, and what is wrong,
 * all on one line each. Pure functions so the card component only renders.
 */

import { MachinesCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import {
  isMachineEnabled,
  machineDisplayLabel,
  machineTransportLabel,
  type MachineRecord,
} from '../../machines/store';
import { SetupPalette } from '../../theme/palette';

export type MachineCardStatus = 'connected' | 'failed' | 'hidden' | 'notConnected';

/**
 * Hidden wins over everything (a hidden machine is never connected to, so its
 * inventory is stale at best); then the inventory decides.
 */
export function machineCardStatus(
  machine: MachineRecord,
  inventory: MachineInventory | undefined,
): MachineCardStatus {
  if (!isMachineEnabled(machine)) return 'hidden';
  if (inventory === undefined || !inventory.hasLoaded) return 'notConnected';
  if (inventory.lastError !== null) return 'failed';
  if (inventory.summary !== null) return 'connected';
  return 'notConnected';
}

export const MACHINE_STATUS_BADGE_LABEL: Record<MachineCardStatus, string> = {
  connected: MachinesCopy.badge.connected,
  failed: MachinesCopy.badge.failed,
  hidden: MachinesCopy.badge.hidden,
  notConnected: MachinesCopy.badge.notConnected,
};

/** Badge and icon tint per status (`.badge.ok/.err` and `.mi.ok/.err/.dim`). */
export const MACHINE_STATUS_COLOR: Record<MachineCardStatus, string> = {
  connected: SetupPalette.OK,
  failed: SetupPalette.ERROR,
  hidden: SetupPalette.DIM,
  notConnected: SetupPalette.DIM,
};

/** "Sep 3" in the phone's locale; the year only once it differs from today's. */
export function formatPairedDate(iso: string, now: Date): string {
  const date = new Date(iso);
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The card's name: the saved name, or the transport-tagged label when unnamed. */
export function machineCardTitle(machine: MachineRecord): string {
  return machine.name.length > 0 ? machine.name : machineDisplayLabel(machine);
}

/**
 * "Easy Connect · madda · paired Sep 3" or "Tailscale · madda@100.101.4.20 ·
 * no route to host". The trailing part is the sanitized failure reason when
 * the connection failed, or the hidden note; a healthy machine has none.
 */
export function machineCardDetail(
  machine: MachineRecord,
  status: MachineCardStatus,
  inventory: MachineInventory | undefined,
  now: Date,
): string {
  const parts: string[] = [machineTransportLabel(machine)];
  if (machine.transport === 'tailcat') {
    parts.push(machine.username);
    if (machine.pairedAt !== undefined) {
      parts.push(MachinesCopy.detail.paired(formatPairedDate(machine.pairedAt, now)));
    }
  } else {
    const portSuffix = machine.port === 22 ? '' : `:${machine.port}`;
    parts.push(`${machine.username}@${machine.host}${portSuffix}`);
  }
  if (status === 'hidden') parts.push(MachinesCopy.detail.hidden);
  else if (status === 'failed' && inventory?.lastError) parts.push(inventory.lastError);
  return parts.join(' · ');
}
