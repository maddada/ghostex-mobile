/**
 * Sessions drawer list assembly: stitches per-machine `buildDrawerItems`
 * output into a flat multi-machine list of render BLOCKS matching the desktop
 * layered-panel skin — plain rows (section labels and state cards), project
 * cards (header + child rows in one bordered card), and
 * collection panels (tinted panel containing member project cards). With a
 * single saved machine the drawer keeps a headerless layout; with two or
 * more, each machine gets a collapsible MACHINE_HEADER.
 */

import {
  buildDrawerItems,
  countSessions,
  machineHeaderItem,
  stateCardItem,
  type CollectionHeaderItem,
  type DrawerItem,
  type ProjectHeaderItem,
} from '../../contract/grouping';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';

export type ProjectCardBlock = {
  header: ProjectHeaderItem;
  children: DrawerItem[];
};

export type DrawerBlock =
  | { kind: 'row'; listKey: string; machineId: string; item: DrawerItem }
  | { kind: 'project'; listKey: string; machineId: string; card: ProjectCardBlock }
  | {
      kind: 'collection';
      listKey: string;
      machineId: string;
      header: CollectionHeaderItem;
      projects: ProjectCardBlock[];
    };

export type DrawerCollapseInput = {
  expandedProjectsByMachine: Record<string, string[]>;
  expandedCollectionsByMachine: Record<string, string[]>;
  expandedGroupsByMachine: Record<string, string[]>;
  collapsedSessionListsByMachine: Record<string, string[]>;
  collapsedSectionsByMachine: Record<string, string[]>;
  collapsedMachineIds: string[];
};

export type DrawerListInput = {
  machines: MachineRecord[];
  inventoriesByMachineId: Record<string, MachineInventory>;
  collapse: DrawerCollapseInput;
};

function rowBlock(machineId: string, item: DrawerItem): DrawerBlock {
  return { kind: 'row', listKey: `${machineId}:${item.key}`, machineId, item };
}

function isProjectChild(item: DrawerItem): boolean {
  return (
    item.type === 'PROJECT_EMPTY' ||
    item.type === 'GROUP_HEADER' ||
    item.type === 'SESSION' ||
    item.type === 'SESSION_LIST_TOGGLE'
  );
}

/** The mobile Sessions page starts at Projects; Quick sessions live in Chat. */
function withoutQuickSection(items: DrawerItem[]): DrawerItem[] {
  let insideQuickSection = false;
  return items.filter((item) => {
    if (item.type === 'SECTION_LABEL') {
      insideQuickSection = item.section === 'quick';
    }
    return !insideQuickSection;
  });
}

/** Group the flat builder output into card/panel blocks. */
export function blocksFromItems(machineId: string, items: DrawerItem[]): DrawerBlock[] {
  const blocks: DrawerBlock[] = [];
  let index = 0;

  const collectCard = (header: ProjectHeaderItem): ProjectCardBlock => {
    const children: DrawerItem[] = [];
    while (index < items.length && isProjectChild(items[index])) {
      children.push(items[index]);
      index++;
    }
    return { header, children };
  };

  while (index < items.length) {
    const item = items[index];
    if (item.type === 'COLLECTION_HEADER') {
      index++;
      const projects: ProjectCardBlock[] = [];
      while (index < items.length) {
        const member = items[index];
        if (member.type !== 'PROJECT_HEADER' || member.collectionColor === undefined) break;
        index++;
        projects.push(collectCard(member));
      }
      blocks.push({
        kind: 'collection',
        listKey: `${machineId}:${item.key}`,
        machineId,
        header: item,
        projects,
      });
      continue;
    }
    if (item.type === 'PROJECT_HEADER') {
      index++;
      blocks.push({
        kind: 'project',
        listKey: `${machineId}:${item.key}`,
        machineId,
        card: collectCard(item),
      });
      continue;
    }
    blocks.push(rowBlock(machineId, item));
    index++;
  }
  return blocks;
}

function machineBlocks(
  machine: MachineRecord,
  inventory: MachineInventory | undefined,
  collapse: DrawerCollapseInput,
): DrawerBlock[] {
  const label = machineDisplayLabel(machine);
  if (inventory === undefined || (inventory.summary === null && !inventory.hasLoaded)) {
    return [
      rowBlock(
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
      rowBlock(
        machine.id,
        stateCardItem(
          StateCardCopy.failure.title,
          inventory.lastError ?? StateCardCopy.failure.fallbackBody,
          StateCardCopy.failure.actionHint,
        ),
      ),
    ];
  }
  const items = withoutQuickSection(
    buildDrawerItems({
      machineId: machine.id,
      summary: inventory.summary,
      expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[machine.id] ?? []),
      expandedCollectionIds: new Set(collapse.expandedCollectionsByMachine[machine.id] ?? []),
      expandedGroupKeys: new Set(collapse.expandedGroupsByMachine[machine.id] ?? []),
      collapsedSessionListKeys: new Set(collapse.collapsedSessionListsByMachine[machine.id] ?? []),
      collapsedSectionKeys: new Set(collapse.collapsedSectionsByMachine[machine.id] ?? []),
    }),
  );
  if (items.length === 0) {
    return [
      rowBlock(
        machine.id,
        stateCardItem(
          StateCardCopy.empty.title,
          StateCardCopy.empty.body,
          StateCardCopy.empty.actionHint,
        ),
      ),
    ];
  }
  return blocksFromItems(machine.id, items);
}

export function buildDrawerList(input: DrawerListInput): DrawerBlock[] {
  const { machines, inventoriesByMachineId, collapse } = input;
  if (machines.length === 0) {
    return [
      rowBlock(
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
    return machineBlocks(machine, inventoriesByMachineId[machine.id], collapse);
  }
  const blocks: DrawerBlock[] = [];
  for (const machine of machines) {
    const collapsed = collapse.collapsedMachineIds.includes(machine.id);
    const counts = countSessions(inventoriesByMachineId[machine.id]?.summary?.sessions ?? []);
    blocks.push(
      rowBlock(
        machine.id,
        machineHeaderItem(machine.id, machineDisplayLabel(machine), collapsed, counts),
      ),
    );
    if (collapsed) continue;
    blocks.push(...machineBlocks(machine, inventoriesByMachineId[machine.id], collapse));
  }
  return blocks;
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
