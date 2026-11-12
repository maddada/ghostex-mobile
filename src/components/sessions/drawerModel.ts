/**
 * Sessions drawer list assembly: turns the selected machine's
 * `buildDrawerItems` output into a list of render BLOCKS matching the desktop
 * layered-panel skin — plain rows (section labels and state cards), project
 * cards (header + child rows in one bordered card), and collection panels
 * (tinted panel containing member project cards).
 *
 * With Separate by machine on, the drawer shows ONE machine, the one its tab strip has selected, filtered to the
 * workspace that machine's workspace tile has selected, then to the Space its Space row has selected. Off (the
 * default), and always for Active projects, it is one list of every connected computer (`everyComputerList`,
 * contract/mergedComputers.ts), as the desktop's sidebar is.
 */

import {
  buildDrawerItems,
  stateCardItem,
  type CollectionHeaderItem,
  type DrawerItem,
  type ProjectHeaderItem,
} from '../../contract/grouping';
import { creatingCopy, mergeComputers, type MergedComputers } from '../../contract/mergedComputers';
import { matchesTagFilters } from '../../contract/sessionTagList';
import { effectiveSessionTag } from '../../contract/sessionTags';
import { gbotsSection, type GbotsSectionModel } from '../../contract/gbots';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { StateCardCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { ACTIVE_SPACE_ID } from '../../spaces/activeProjects';
import { filterSummaryForSpace } from '../../spaces/spaceFilter';
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
  /** Each other computer's resolved workspace id, for the one list of every computer (null: none). */
  workspaceIdOf?: (machineId: string) => string | null;
  /** The tag filter (./tagFilterStore.ts), already pruned to the tags the list offers; empty keeps every session. */
  tagFilters?: readonly string[];
  /** The tag filter's labels, for its empty card ("No sessions tagged Bug."). */
  tagFilterLabel?: string;
  collapse: DrawerCollapseInput;
};

/**
 * The tag filter (gx-core sidebar_view/tags.rs `matches_session_filters`, applied in groups.rs): only the sessions
 * carrying a picked tag (or no tag, for No tag), and no project the filter leaves empty, Main Hub included.
 */
function withTagFilter(summary: GhostexMobileSummary, filters: readonly string[] | undefined): GhostexMobileSummary {
  if (filters === undefined || filters.length === 0) return summary;
  const sessions = summary.sessions.filter((session) => matchesTagFilters(effectiveSessionTag(session), filters));
  const withSessions = new Set(sessions.map((session) => session.projectId));
  const parentOf = new Map(summary.projects.map((project) => [project.projectId, project.worktreeParentProjectId]));
  for (const projectId of [...withSessions]) {
    const parent = parentOf.get(projectId);
    if (parent !== undefined && parent.length > 0) withSessions.add(parent);
  }
  return {
    ...summary,
    sessions,
    projects: summary.projects.filter((project) => withSessions.has(project.projectId)),
  };
}

/** The empty card while the tag filter leaves nothing (gx-core assemble.rs's "No sessions tagged X."). */
function tagFilterEmptyBlock(machineId: string, label: string | undefined): DrawerBlock {
  return rowBlock(
    machineId,
    stateCardItem('empty', `No sessions tagged ${label ?? 'that'}.`, 'Long-press a session › Tag As to tag it.', 'Tap to clear the filter.'),
  );
}

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
  tagFilters?: readonly string[],
  tagFilterLabel?: string,
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
      summary: withTagFilter(
        filterSummaryForSpace(
          selectedWorkspaceId === null
            ? inventory.summary
            : filterSummaryForWorkspace(inventory.summary, selectedWorkspaceId),
          selectedSpaceId,
        ),
        tagFilters,
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
    if ((tagFilters?.length ?? 0) > 0) return [tagFilterEmptyBlock(machine.id, tagFilterLabel)];
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
  const merged = everyComputerList(input, machine);
  if (merged !== null) return mergedBlocks(input, machine, merged);
  return machineBlocks(
    machine,
    inventoriesByMachineId[machine.id],
    selectedSpaceId,
    selectedWorkspaceId,
    collapse,
    input.nowMs ?? Date.now(),
    input.selectedSessionKey ?? null,
    input.tagFilters,
    input.tagFilterLabel,
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
 * Whether the Project list is one list of every connected computer (contract/mergedComputers.ts), and that list's
 * summary before any Space: while Separate by machine is off and another computer is connected, and always for
 * Active projects, which lists every computer's active projects (gx-core active_projects.rs
 * `project_list_merges_machines`). Each computer is read in its own shown workspace. `null`: the selected computer's
 * list alone.
 */
export function everyComputerList(
  input: Pick<DrawerListInput, 'machines' | 'inventoriesByMachineId' | 'selectedWorkspaceId' | 'workspaceIdOf' | 'selectedSpaceId'>,
  selected: MachineRecord,
): MergedComputers | null {
  const own = input.inventoriesByMachineId[selected.id]?.summary ?? null;
  if (own === null) return null;
  const others = input.machines.filter((machine) => {
    if (machine.id === selected.id) return false;
    const inventory = input.inventoriesByMachineId[machine.id];
    // A computer that is not connected gives no rows until it answers again, as on the desktop.
    return inventory?.summary != null && inventory.lastError === null;
  });
  const active = input.selectedSpaceId === ACTIVE_SPACE_ID;
  if (!active && (own.separateByMachine === true || others.length === 0)) return null;
  const inWorkspace = (summary: GhostexMobileSummary, workspaceId: string | null) =>
    workspaceId === null ? summary : filterSummaryForWorkspace(summary, workspaceId);
  return mergeComputers([
    { machineId: selected.id, summary: inWorkspace(own, input.selectedWorkspaceId) },
    ...others.map((machine) => ({
      machineId: machine.id,
      summary: inWorkspace(input.inventoriesByMachineId[machine.id]!.summary!, input.workspaceIdOf?.(machine.id) ?? null),
    })),
  ]);
}

/** Each drawn row of the one list given back its own computer, and each entry's header its creating copy. */
function withOrigins(items: DrawerItem[], merged: MergedComputers, listMachineId: string, summaryOf: (machineId: string) => GhostexMobileSummary | null): DrawerItem[] {
  return items.map((item): DrawerItem => {
    if (item.type === 'SESSION') {
      const origin = merged.origins.get(item.session);
      if (origin === undefined || origin.machineId === listMachineId) return item;
      return {
        ...item,
        machineId: origin.machineId,
        session: origin.session,
        capabilities: origin.capabilities,
        projectId: origin.session.projectId,
      };
    }
    if (item.type === 'PROJECT_HEADER') {
      // A project on several computers names them with their icons after its title (gx-core view.rs `MachineChip`).
      const machineIds = [...new Set((merged.copies.get(item.projectId) ?? []).map((copy) => copy.machineId))];
      const withMachines = machineIds.length > 1 ? { ...item, machineIds } : item;
      const copy = creatingCopy(merged, item.projectId);
      if (copy === null || (copy.machineId === listMachineId && copy.projectId === item.projectId)) return withMachines;
      const theirs = summaryOf(copy.machineId);
      return {
        ...withMachines,
        actionTarget: copy,
        agents: theirs?.agents ?? item.agents,
        quickActions: theirs?.quickActionsByProject[copy.projectId] ?? [],
      };
    }
    if (item.type === 'GROUP_HEADER') {
      const copy = merged.copies.get(item.projectId)?.[0];
      if (copy === undefined || (copy.machineId === listMachineId && copy.projectId === item.projectId)) return item;
      return { ...item, actionTarget: copy };
    }
    return item;
  });
}

/** The one list of every computer, drawn with the selected computer's folds. */
function mergedBlocks(input: DrawerListInput, selected: MachineRecord, merged: MergedComputers): DrawerBlock[] {
  const nowMs = input.nowMs ?? Date.now();
  const { collapse } = input;
  const focused = input.selectedSessionKey ?? null;
  const focusedSessionId = (() => {
    if (focused === null) return null;
    for (const [, origin] of merged.origins) {
      if (focused === `${origin.machineId}:${origin.session.sessionId}`) return origin.session.sessionId;
    }
    return null;
  })();
  const summary = withTagFilter(
    filterSummaryForSpace(merged.summary, input.selectedSpaceId, { nowMs, focusedSessionId }),
    input.tagFilters,
  );
  const items = withoutSectionLabels(
    buildDrawerItems({
      machineId: selected.id,
      nowMs,
      activeSessionId: focusedSessionId,
      expandedDraftSessionKeys: new Set(collapse.expandedDraftSessionKeysByMachine?.[selected.id] ?? []),
      summary,
      expandedProjectKeys: new Set(collapse.expandedProjectsByMachine[selected.id] ?? []),
      expandedCollectionIds: new Set(collapse.expandedCollectionsByMachine[selected.id] ?? []),
      expandedGroupKeys: new Set(collapse.expandedGroupsByMachine[selected.id] ?? []),
      collapsedSessionKindKeys: new Set(collapse.collapsedSessionKindsByMachine[selected.id] ?? []),
      expandedParkedSessionKeys: new Set(collapse.expandedParkedSessionKeysByMachine?.[selected.id] ?? []),
      collapsedCoordinatorKeys: new Set(collapse.collapsedCoordinatorsByMachine?.[selected.id] ?? []),
      expandedCoordinatorOlderKeys: new Set(collapse.expandedCoordinatorOlderByMachine?.[selected.id] ?? []),
    }),
  );
  if (items.length === 0) {
    if ((input.tagFilters?.length ?? 0) > 0) return [tagFilterEmptyBlock(selected.id, input.tagFilterLabel)];
    const copy = input.selectedSpaceId === ACTIVE_SPACE_ID ? StateCardCopy.activeProjectsEmpty : StateCardCopy.empty;
    return [rowBlock(selected.id, stateCardItem('empty', copy.title, copy.body, 'actionHint' in copy ? copy.actionHint : ''))];
  }
  const restored = withOrigins(
    items,
    merged,
    selected.id,
    (machineId) => input.inventoriesByMachineId[machineId]?.summary ?? null,
  );
  return withGbotsSection(
    blocksFromItems(selected.id, restored),
    selected.id,
    input.inventoriesByMachineId[selected.id]!.summary!,
    collapse,
    nowMs,
    focused,
  );
}
