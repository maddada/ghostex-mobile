/**
 * Sessions drawer list assembly (sessions-drawer.md §§1-3,5): stitches the
 * per-machine `buildDrawerItems` output into one flat multi-machine list.
 * Mirrors the Android reference: with a single saved machine the drawer keeps
 * a headerless layout; with two or more, each machine gets a collapsible
 * MACHINE_HEADER followed by its items (or a per-machine state card).
 */

import {
  buildDrawerItems,
  machineHeaderItem,
  stateCardItem,
  type DrawerItem,
} from '../../contract/grouping';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';

export type DrawerListEntry = {
  /** FlatList key, machine-scoped to avoid cross-machine collisions. */
  listKey: string;
  machineId: string;
  item: DrawerItem;
};

export type DrawerCollapseInput = {
  collapsedProjectsByMachine: Record<string, string[]>;
  collapsedSessionListsByMachine: Record<string, string[]>;
  collapsedGroupsByMachine: Record<string, string[]>;
  collapsedMachineIds: string[];
};

export type DrawerListInput = {
  machines: MachineRecord[];
  inventoriesByMachineId: Record<string, MachineInventory>;
  collapse: DrawerCollapseInput;
};

function entry(machineId: string, item: DrawerItem): DrawerListEntry {
  return { listKey: `${machineId}:${item.key}`, machineId, item };
}

function machineEntries(
  machine: MachineRecord,
  inventory: MachineInventory | undefined,
  collapse: DrawerCollapseInput,
): DrawerListEntry[] {
  const label = machineDisplayLabel(machine);
  if (inventory === undefined || (inventory.summary === null && !inventory.hasLoaded)) {
    return [
      entry(
        machine.id,
        stateCardItem(
          StateCardCopy.connecting.title,
          StateCardCopy.connecting.body(label),
          StateCardCopy.connecting.actionHint,
        ),
      ),
    ];
  }
  if (inventory.summary === null) {
    return [
      entry(
        machine.id,
        stateCardItem(
          StateCardCopy.failure.title,
          inventory.lastError ?? StateCardCopy.failure.fallbackBody,
          StateCardCopy.failure.actionHint,
        ),
      ),
    ];
  }
  const items = buildDrawerItems({
    machineId: machine.id,
    summary: inventory.summary,
    collapsedProjectKeys: new Set(collapse.collapsedProjectsByMachine[machine.id] ?? []),
    collapsedSessionListKeys: new Set(collapse.collapsedSessionListsByMachine[machine.id] ?? []),
    collapsedGroupKeys: new Set(collapse.collapsedGroupsByMachine[machine.id] ?? []),
  });
  if (items.length === 0) {
    return [
      entry(
        machine.id,
        stateCardItem(
          StateCardCopy.empty.title,
          StateCardCopy.empty.body,
          StateCardCopy.empty.actionHint,
        ),
      ),
    ];
  }
  return items.map((item) => entry(machine.id, item));
}

export function buildDrawerList(input: DrawerListInput): DrawerListEntry[] {
  const { machines, inventoriesByMachineId, collapse } = input;
  if (machines.length === 0) {
    return [
      entry(
        '',
        stateCardItem(
          StateCardCopy.noMachines.title,
          StateCardCopy.noMachines.body,
          StateCardCopy.noMachines.actionHint,
        ),
      ),
    ];
  }
  if (machines.length === 1) {
    const machine = machines[0];
    return machineEntries(machine, inventoriesByMachineId[machine.id], collapse);
  }
  const entries: DrawerListEntry[] = [];
  for (const machine of machines) {
    const collapsed = collapse.collapsedMachineIds.includes(machine.id);
    entries.push(entry(machine.id, machineHeaderItem(machine.id, machineDisplayLabel(machine), collapsed)));
    if (collapsed) continue;
    entries.push(...machineEntries(machine, inventoriesByMachineId[machine.id], collapse));
  }
  return entries;
}

/** Status line per sessions-drawer.md §5 for the selected machine. */
export function drawerStatusLine(
  machine: MachineRecord | null,
  inventory: MachineInventory | undefined,
): string {
  if (machine === null) return StateCardCopy.noMachines.status;
  const label = machineDisplayLabel(machine);
  if (inventory === undefined || (!inventory.hasLoaded && inventory.summary === null)) {
    return StateCardCopy.connecting.status(label);
  }
  if (inventory.refreshing && inventory.summary !== null) {
    return StateCardCopy.connecting.refreshingStatus(label);
  }
  if (inventory.lastError !== null) {
    return StateCardCopy.failure.refreshFailedStatus(inventory.lastError);
  }
  if (inventory.summary !== null) {
    if (inventory.summary.sessions.length === 0 && inventory.summary.projects.length > 0) {
      return StateCardCopy.success.emptyProjectsStatus;
    }
    return StateCardCopy.success.status(label);
  }
  return StateCardCopy.initialStatus;
}
