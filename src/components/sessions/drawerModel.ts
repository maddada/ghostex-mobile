/**
 * Sessions drawer list assembly: turns the selected machine's
 * `buildDrawerItems` output into a list of render BLOCKS matching the desktop
 * layered-panel skin — plain rows (section labels and state cards), project
 * cards (header + child rows in one bordered card), and collection panels
 * (tinted panel containing member project cards).
 *
 * The drawer shows ONE machine, the one its tab strip has selected (desktop
 * parity: packages/core-ui/sidebar-app/machine-tabs.tsx), filtered to the
 * Space that machine's Space row has selected.
 */

import {
  buildDrawerItems,
  stateCardItem,
  type CollectionHeaderItem,
  type DrawerItem,
  type ProjectHeaderItem,
} from '../../contract/grouping';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { filterSummaryForSpace } from '../../spaces/spaceFilter';

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
  collapsedSessionKindsByMachine: Record<string, string[]>;
  collapsedCoordinatorsByMachine?: Record<string, string[]>;
  expandedParkedSessionKeysByMachine?: Record<string, string[]>;
  expandedDraftSessionKeysByMachine?: Record<string, string[]>;
};

export type DrawerListInput = {
  nowMs?: number;
  /** Enabled machines only; empty means the "no machines" state card. */
  machines: MachineRecord[];
  /** The machine whose content the drawer renders; null falls back to the first. */
  selectedMachineId: string | null;
  inventoriesByMachineId: Record<string, MachineInventory>;
  /** Resolved Space id for the selected machine (a Space id, or "other"). */
  selectedSpaceId: string;
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
    item.type === 'SESSION_KIND_LABEL' ||
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
  selectedSpaceId: string,
  collapse: DrawerCollapseInput,
  nowMs: number,
): DrawerBlock[] {
  const label = machineDisplayLabel(machine);
  if (inventory === undefined || (inventory.summary === null && !inventory.hasLoaded)) {
    return [
      rowBlock(
        machine.id,
        stateCardItem(
          'connecting',
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
          'failure',
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
      nowMs,
      expandedDraftSessionKeys: new Set(collapse.expandedDraftSessionKeysByMachine?.[machine.id] ?? []),
      summary: filterSummaryForSpace(inventory.summary, selectedSpaceId),
      expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[machine.id] ?? []),
      expandedCollectionIds: new Set(collapse.expandedCollectionsByMachine[machine.id] ?? []),
      expandedGroupKeys: new Set(collapse.expandedGroupsByMachine[machine.id] ?? []),
      collapsedSessionListKeys: new Set(collapse.collapsedSessionListsByMachine[machine.id] ?? []),
      collapsedSectionKeys: new Set(collapse.collapsedSectionsByMachine[machine.id] ?? []),
      collapsedSessionKindKeys: new Set(
        collapse.collapsedSessionKindsByMachine[machine.id] ?? [],
      ),
      expandedParkedSessionKeys: new Set(collapse.expandedParkedSessionKeysByMachine?.[machine.id] ?? []),
      collapsedCoordinatorKeys: new Set(collapse.collapsedCoordinatorsByMachine?.[machine.id] ?? []),
    }),
  );
  if (items.length === 0) {
    return [
      rowBlock(
        machine.id,
        stateCardItem(
          'empty',
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
  const { machines, selectedMachineId, inventoriesByMachineId, selectedSpaceId, collapse } = input;
  if (machines.length === 0) {
    return [
      rowBlock(
        '',
        stateCardItem(
          'noMachines',
          StateCardCopy.noMachines.title,
          StateCardCopy.noMachines.body,
          StateCardCopy.noMachines.actionHint,
        ),
      ),
    ];
  }
  const machine =
    machines.find((entry) => entry.id === selectedMachineId) ?? machines[0];
  return machineBlocks(
    machine,
    inventoriesByMachineId[machine.id],
    selectedSpaceId,
    collapse,
    input.nowMs ?? Date.now(),
  );
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
