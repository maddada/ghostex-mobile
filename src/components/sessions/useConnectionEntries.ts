/**
 * Every shown computer's link as the Sessions screen's icons, the Connections sheet and Settings › Connection draw it:
 * its status, its live route, and for a problem the plain reason.
 */

import { useMemo } from 'react';

import { useInventoryStore } from '../../inventory/store';
import { useConnectionHealth } from '../../machines/connectionHealth';
import { computerIconDrawing, useComputerIconsStore } from '../../machines/computerIcons';
import { useMachineRoutes } from '../../machines/easyConnectRoute';
import { inventoryConnectionState, LINK_STATUS_ORDER, linkStatus, routeLine, type LinkStatus } from '../../machines/linkStatus';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import type { MachineHealth } from '../../machines/connectionHealthModel';
import { isDemoMachine } from '../../demo/identity';

export type ConnectionEntry = {
  machine: MachineRecord;
  name: string;
  /** The computer's icon (machines/computerIcons.ts); absent while unknown. */
  iconDrawing?: string;
  status: LinkStatus;
  route: string;
  /** Why it can't connect, as the list read summarized it; null otherwise. */
  reason: string | null;
  /** It can't connect over Tailscale, and Tailscale is off on this phone. */
  tailscaleOff: boolean;
  health?: MachineHealth;
  retrying: boolean;
};

/**
 * `machines` in their own order; `sorted` puts problems first. `tailscaleConnected` is the phone's Tailscale state
 * (null while unknown).
 */
export function useConnectionEntries(
  machines: readonly MachineRecord[],
  tailscaleConnected: boolean | null,
  sorted = false,
): ConnectionEntry[] {
  const inventories = useInventoryStore((state) => state.inventoriesByMachineId);
  const health = useConnectionHealth((state) => state.byId);
  const paths = useConnectionHealth((state) => state.paths);
  const routes = useMachineRoutes((state) => state.active);
  const iconFacts = useComputerIconsStore((state) => state.facts);
  return useMemo(() => {
    const entries = machines.map((machine): ConnectionEntry => {
      const inventory = inventories[machine.id];
      const machineHealth = health[machine.id];
      const status = linkStatus(inventoryConnectionState(inventory), machineHealth);
      const facts = iconFacts[machine.id];
      return {
        machine,
        name: machineDisplayLabel(machine),
        iconDrawing: facts !== undefined ? computerIconDrawing(facts) : undefined,
        status,
        route: routeLine(machine, routes[machine.id], paths[machine.id], machineHealth, status),
        reason: status === 'failed' ? (inventory?.lastError ?? null) : null,
        tailscaleOff:
          status === 'failed' &&
          tailscaleConnected === false &&
          machine.transport !== 'tailcat' &&
          !isDemoMachine(machine),
        health: machineHealth,
        retrying: inventory?.retrying === true,
      };
    });
    if (!sorted) return entries;
    return [...entries].sort((a, b) => LINK_STATUS_ORDER.indexOf(a.status) - LINK_STATUS_ORDER.indexOf(b.status));
  }, [machines, inventories, health, paths, routes, iconFacts, tailscaleConnected, sorted]);
}
