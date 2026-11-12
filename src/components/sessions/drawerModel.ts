/**
 * Sessions drawer list assembly: turns the selected machine's
 * `buildDrawerItems` output into a list of render BLOCKS matching the desktop
 * layered-panel skin — plain rows (section labels and state cards), project
 * cards (header + child rows in one bordered card), and collection panels
 * (tinted panel containing member project cards).
 *
 * The drawer shows ONE machine, the one its tab strip has selected (desktop
 * parity: packages/core-ui/sidebar-app/machine-tabs.tsx), filtered to the
 * workspace that machine's workspace tile has selected, then to the Space its
 * Space row has selected.
 */

import {
  buildDrawerItems,
  stateCardItem,
  type CollectionHeaderItem,
  type DrawerItem,
  type ProjectHeaderItem,
} from '../../contract/grouping';
import { gbotsSection, type GbotsSectionModel } from '../../contract/gbots';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { ACTIVE_SPACE_ID, filterSummaryForActiveProjects, spaceRankOfProject } from '../../spaces/activeProjects';
import { collectionIdByProjectId, filterSummaryForSpace, orderedSpaces } from '../../spaces/spaceFilter';
import { filterSummaryForWorkspace } from '../../workspaces/workspaceFilter';

export type ProjectCardBlock = {
  header: ProjectHeaderItem;
  children: DrawerItem[];
  /** Main Hub's GBots section (contract/gbots.ts), on the home project's card only. */
  gbots?: GbotsSectionModel | null;
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
  collapsedSessionKindsByMachine: Record<string, string[]>;
  collapsedCoordinatorsByMachine?: Record<string, string[]>;
  expandedCoordinatorOlderByMachine?: Record<string, string[]>;
  expandedParkedSessionKeysByMachine?: Record<string, string[]>;
  expandedDraftSessionKeysByMachine?: Record<string, string[]>;
};

export type DrawerListInput = {
  nowMs?: number;
  /** The open session's attachSessionKey (`<machineId>:<sessionId>`), if any. */
  selectedSessionKey?: string | null;
  /** Enabled machines only; empty means the "no machines" state card. */
  machines: MachineRecord[];
  /** The machine whose content the drawer renders; null falls back to the first. */
  selectedMachineId: string | null;
  inventoriesByMachineId: Record<string, MachineInventory>;
  /** Resolved Space id for the selected machine (a Space id, or "other"). */
  selectedSpaceId: string;
  /** Resolved workspace id for the selected machine; null when it has no workspaces. */
  selectedWorkspaceId: string | null;
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
    item.type === 'COORDINATOR_OLDER'
  );
}

/**
 * The mobile Sessions page starts at the project list: the "Projects" header row is gone.
 *
 * CDXC:Sessions 2026-10-08 DECISION:
 * User: "Please remove the 'Projects' header in the sessions list and instead make holding on the machine itself at the top do what the 3 dots button next to Projects does." The list draws no section header rows; the machine menu (long press on the machine tab or the page title) carries the actions the header's ⋮ button had.
 */
function withoutSectionLabels(items: DrawerItem[]): DrawerItem[] {
  return items.filter((item) => item.type !== 'SECTION_LABEL');
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
  selectedWorkspaceId: string | null,
  collapse: DrawerCollapseInput,
  nowMs: number,
  selectedSessionKey: string | null,
  /** Active projects (../../spaces/activeProjects.ts): the list to draw instead of the Space's, and no empty card. */
  active?: { summaryOf: (summary: GhostexMobileSummary) => GhostexMobileSummary },
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
  const items = withoutSectionLabels(
    buildDrawerItems({
      machineId: machine.id,
      nowMs,
      activeSessionId: selectedSessionKey?.startsWith(`${machine.id}:`)
        ? selectedSessionKey.slice(machine.id.length + 1)
        : null,
      expandedDraftSessionKeys: new Set(collapse.expandedDraftSessionKeysByMachine?.[machine.id] ?? []),
      summary: (
        active?.summaryOf ?? ((summary: GhostexMobileSummary) => filterSummaryForSpace(summary, selectedSpaceId))
      )(
        selectedWorkspaceId === null
          ? inventory.summary
          : filterSummaryForWorkspace(inventory.summary, selectedWorkspaceId),
      ),
      expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[machine.id] ?? []),
      expandedCollectionIds: new Set(collapse.expandedCollectionsByMachine[machine.id] ?? []),
      expandedGroupKeys: new Set(collapse.expandedGroupsByMachine[machine.id] ?? []),
      collapsedSessionKindKeys: new Set(collapse.collapsedSessionKindsByMachine[machine.id] ?? []),
      expandedParkedSessionKeys: new Set(collapse.expandedParkedSessionKeysByMachine?.[machine.id] ?? []),
      collapsedCoordinatorKeys: new Set(collapse.collapsedCoordinatorsByMachine?.[machine.id] ?? []),
      expandedCoordinatorOlderKeys: new Set(collapse.expandedCoordinatorOlderByMachine?.[machine.id] ?? []),
    }),
  );
  if (items.length === 0) {
    if (active !== undefined) return [];
    return [
      rowBlock(
        machine.id,
        stateCardItem('empty', StateCardCopy.empty.title, StateCardCopy.empty.body, StateCardCopy.empty.actionHint),
      ),
    ];
  }
  return withGbotsSection(
    blocksFromItems(machine.id, items),
    machine.id,
    inventory.summary,
    collapse,
    nowMs,
    selectedSessionKey,
  );
}

/**
 * The drawn home project's card carries Main Hub's GBots section, read from the computer's whole summary: a GBot
 * belongs to no Space or workspace and shows wherever Main Hub does (gx-core sidebar_view/gbots.rs).
 */
function withGbotsSection(
  blocks: DrawerBlock[],
  machineId: string,
  summary: GhostexMobileSummary,
  collapse: DrawerCollapseInput,
  nowMs: number,
  selectedSessionKey: string | null,
): DrawerBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'project' || block.card.header.isHome !== true) return block;
    const gbots = gbotsSection({
      machineId,
      summary,
      homeProjectId: block.card.header.projectId,
      fold: {
        expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[machineId] ?? []),
        collapsedSessionKindKeys: new Set(collapse.collapsedSessionKindsByMachine[machineId] ?? []),
      },
      activeSessionId: selectedSessionKey?.startsWith(`${machineId}:`)
        ? selectedSessionKey.slice(machineId.length + 1)
        : null,
      nowMs,
    });
    return gbots === null ? block : { ...block, card: { ...block.card, gbots } };
  });
}

export function buildDrawerList(input: DrawerListInput): DrawerBlock[] {
  const { machines, selectedMachineId, inventoriesByMachineId, selectedSpaceId, selectedWorkspaceId, collapse } = input;
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
  const machine = machines.find((entry) => entry.id === selectedMachineId) ?? machines[0];
  if (selectedSpaceId === ACTIVE_SPACE_ID) {
    return activeProjectsBlocks(input, machine);
  }
  return machineBlocks(
    machine,
    inventoriesByMachineId[machine.id],
    selectedSpaceId,
    selectedWorkspaceId,
    collapse,
    input.nowMs ?? Date.now(),
    input.selectedSessionKey ?? null,
  );
}

/**
 * Whether the Project list leaves out projects without sessions: the synced Hide projects without sessions, laid
 * over the computer's summary (settingsSync/sidebarOrganization.ts).
 */
export function hidesProjectsWithoutSessions(summary: GhostexMobileSummary | null | undefined): boolean {
  return summary?.sidebarHideProjectsWithoutSessions === true;
}

/**
 * Hide projects without sessions: the list without project cards that draw no session, and how many it left out,
 * for the Show all projects row (`sidebar_view/assemble.rs` on desktop).
 *
 * The card decides, not the session list: a card draws its own sessions plus those of its worktrees and of the
 * repository copies merged into it (`header.sessionCount`, in any state), so a project whose sessions all live
 * in a worktree or a merged copy stays. Main Hub's home card always stays, as on the desktop.
 *
 * CDXC:Sidebar 2026-10-31 DECISION:
 * User (Q851, "show all row"; Q856): the Project list has the same Show all projects row. With `showAll` they come back in their own places and the row stays, as the way back. Since 2026-11-09 the phone has its own switch for it (`sessionsListHideProjectsWithoutSessions`).
 */
export function hideProjectsWithoutSessions(
  blocks: DrawerBlock[],
  hide: boolean,
  showAll: boolean,
): { blocks: DrawerBlock[]; emptyProjects: number } {
  if (!hide) return { blocks, emptyProjects: 0 };
  const hasSessions = (card: ProjectCardBlock): boolean => card.header.isHome === true || card.header.sessionCount > 0;
  let emptyProjects = 0;
  const kept: DrawerBlock[] = [];
  for (const block of blocks) {
    if (block.kind === 'project') {
      if (hasSessions(block.card)) kept.push(block);
      else emptyProjects += 1;
    } else if (block.kind === 'collection') {
      // A folded collection draws no cards, so its header knows which members are empty.
      const projects = block.projects.filter(hasSessions);
      const empty = block.header.projectsWithoutSessions;
      emptyProjects += empty;
      if (block.header.projectCount - empty > 0) kept.push({ ...block, projects });
    } else {
      kept.push(block);
    }
  }
  return { blocks: showAll ? blocks : kept, emptyProjects };
}

/**
 * Active projects (../../spaces/activeProjects.ts): one flat list of every connected computer's active projects, as
 * the desktop's one-list sidebar draws them. Each computer's cards come in its own Space order; the computers'
 * cards then interleave by the selected computer's Space names (Spaces sync between computers), this computer's
 * first within a Space. A computer that is away or has nothing active adds nothing.
 */
function activeProjectsBlocks(input: DrawerListInput, selected: MachineRecord): DrawerBlock[] {
  const nowMs = input.nowMs ?? Date.now();
  const selectedSummary = input.inventoriesByMachineId[selected.id]?.summary ?? null;
  const spaceNames =
    selectedSummary === null ? undefined : orderedSpaces(selectedSummary.sidebarSpaces).map((space) => space.name);
  const ordered = [selected, ...input.machines.filter((entry) => entry.id !== selected.id)];
  const ranked: Array<{ block: DrawerBlock; rank: number; machineIndex: number; index: number }> = [];
  for (const [machineIndex, machine] of ordered.entries()) {
    const inventory = input.inventoriesByMachineId[machine.id];
    if (inventory?.summary == null) continue;
    const focusedSessionId = input.selectedSessionKey?.startsWith(`${machine.id}:`)
      ? input.selectedSessionKey.slice(machine.id.length + 1)
      : null;
    const ranks = new Map<string, number>();
    const summaryOf = (summary: GhostexMobileSummary): GhostexMobileSummary => {
      const collections = collectionIdByProjectId(summary);
      const scoped = filterSummaryForActiveProjects(
        summary,
        { nowMs, focusedSessionId },
        (projectId) => collections.get(projectId),
        spaceNames,
      );
      for (const project of scoped.projects) {
        const parent = project.worktreeParentProjectId;
        ranks.set(
          project.projectId,
          spaceRankOfProject(
            scoped,
            project.projectId,
            collections.get(project.projectId),
            parent.length > 0 ? parent : undefined,
            spaceNames,
          ),
        );
      }
      return scoped;
    };
    const blocks = machineBlocks(
      machine,
      inventory,
      ACTIVE_SPACE_ID,
      machine.id === selected.id ? input.selectedWorkspaceId : null,
      input.collapse,
      nowMs,
      input.selectedSessionKey ?? null,
      { summaryOf },
    );
    let rank = 0;
    for (const [index, block] of blocks.entries()) {
      if (block.kind === 'project') rank = ranks.get(block.card.header.projectId) ?? rank;
      ranked.push({ block, rank, machineIndex, index });
    }
  }
  if (ranked.length === 0) {
    return [
      rowBlock(
        selected.id,
        stateCardItem('empty', StateCardCopy.activeProjectsEmpty.title, StateCardCopy.activeProjectsEmpty.body, ''),
      ),
    ];
  }
  return ranked
    .sort((left, right) => left.rank - right.rank || left.machineIndex - right.machineIndex || left.index - right.index)
    .map((entry) => entry.block);
}
