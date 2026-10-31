/**
 * The session list drawn as the desktop's Unified sidebar: every computer's sessions in one list
 * (contract/unified/), with its header (the search field, the filter, Add project, New session), its
 * cards, project groups and shelves, its swipe buttons, and the menus they open.
 *
 * CDXC:Sidebar 2026-10-30 DECISION:
 * User: the phone's session list shows what the desktop's Unified sidebar shows, following the
 * computer's own Settings › Sidebar & Sessions › Sidebar (`sidebarView`, sent in the mobile summary
 * like `newSessionAgentScope`). The selected machine tab's computer decides; the tabs stay, since on
 * the phone they are also each computer's connect control, while the Space and Workspace tiles give
 * way to the filter, which narrows by computer, Space and project as on the desktop. The Project list
 * is untouched.
 */

import { useEffect, useMemo, useReducer, useRef, useState, type ReactElement } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type FlatListProps, type ViewInstance } from 'react-native';

import { buildDrawerItems, projectKeyForSession, type ProjectHeaderItem, type SessionItem } from '../../contract/grouping';
import type { GhostexMobileSummary, GhostexProjectIcon, GhostexSession } from '../../contract/mobileSummary';
import {
  EMPTY_UNIFIED_FILTER,
  isUnifiedFilterEmpty,
  type UnifiedFilter,
  type UnifiedRow,
  type UnifiedShelf,
} from '../../contract/unified/build';
import { unifiedNewSessionTarget, unifiedProjectChoices, type UnifiedProjectChoice } from '../../contract/unified/choices';
import { toggleUnifiedFilter, unifiedFilterLabel, unifiedFilterMenu } from '../../contract/unified/filterMenu';
import {
  unifiedLayoutOf,
  unifiedListOf,
  unifiedMachineInput,
  unifiedSettingsOf,
  wantsUnifiedSidebar,
  type UnifiedComputer,
} from '../../contract/unified/fromSummary';
import { groupUnifiedList, unifiedGroupCount, type UnifiedGroup } from '../../contract/unified/grouping';
import { unifiedSwipeActions } from '../../contract/unified/strip';
import { SNOOZE_PRESETS, snoozeWakeAt } from '../../contract/unified/snooze';
import { chatMachineLink } from '../../chat/rust/machine-link';
import ContextMenu, { type ContextMenuItem, type MenuAnchor } from '../../components/sessions/ContextMenu';
import { ds, SIDEBAR_MUTED, SIDEBAR_TEXT } from '../../components/sessions/rows';
import { EditGlyph, FilterGlyph, FolderPlusGlyph, AlarmGlyph } from '../../components/sessions/unified/glyphs';
import { UnifiedCard, UnifiedGroupHeader, UnifiedShelfHeader, UnifiedSlimRow } from '../../components/sessions/unified/UnifiedCard';
import type { MachineInventory } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import { attachSessionKey } from '../../terminal/sessions';
import { resolveWorkspaceId } from '../../workspaces/workspaceFilter';
import { lifecycleSessionAction, parkSessionAction, type BulkSessionAction, type Overlay } from './session-actions';
import { shelfOpen, useUnifiedListStore } from './unified-list-store';

export { shelfOpen, useUnifiedListStore };

const SNOOZE_TIMEOUT_MS = 15_000;

/**
 * Snooze (a wake time) or Unsnooze (`null`) through gxserver, as the desktop's does
 * (gx-core sidebar_actions/snooze.rs): gxserver owns the wake time and refuses one in the past,
 * so nothing is patched ahead of it, and an accepted snooze is followed by an ordinary sleep.
 */
export function makeSnoozeSession(deps: {
  runBulkSessionActions: (target: MachineRecord, actions: readonly BulkSessionAction[]) => Promise<void>;
  refreshMachine: (target: MachineRecord) => Promise<void>;
  setTransientStatus: (message: string | null) => void;
}) {
  return async (target: MachineRecord, session: GhostexSession, wakeAt: Date | null): Promise<void> => {
    const params = { projectId: session.projectId, sessionId: session.sessionId };
    const answer = await chatMachineLink(target).rpc(
      wakeAt === null ? 'unsnoozeSession' : 'snoozeSession',
      wakeAt === null ? params : { ...params, snoozedUntil: wakeAt.toISOString() },
      SNOOZE_TIMEOUT_MS,
    );
    if (answer.error !== null) {
      deps.setTransientStatus(
        wakeAt === null
          ? `Couldn't unsnooze: ${answer.error.message}`
          : `Couldn't snooze: ${answer.error.message}. The session may be working or waiting on you.`,
      );
      return;
    }
    if (wakeAt !== null) await deps.runBulkSessionActions(target, [lifecycleSessionAction(session, true)]);
    else await deps.refreshMachine(target);
  };
}

type UnifiedListItem =
  | { kind: 'group'; key: string; repoKey: string; label: string; count: number; open: boolean }
  | { kind: 'shelf'; key: string; shelf: UnifiedShelf; repoKey: string | null; count: number; open: boolean }
  | { kind: 'card'; key: string; row: UnifiedRow<GhostexSession>; inGroup?: boolean }
  | { kind: 'slim'; key: string; shelf: UnifiedShelf; row: UnifiedRow<GhostexSession> }
  | { kind: 'gap'; key: string }
  | { kind: 'empty'; key: string; text: string };

export type UnifiedListDeps = {
  machines: MachineRecord[];
  selectedMachine: MachineRecord | null;
  inventoriesByMachineId: Record<string, MachineInventory>;
  selectedWorkspaceIdByMachine: Record<string, string>;
  selectedSessionKey: string | null;
  sidebarBackground: string;
  setOverlay: (overlay: Overlay) => void;
  attach: (target: MachineRecord, session: GhostexSession) => Promise<void>;
  runBulkSessionActions: (target: MachineRecord, actions: readonly BulkSessionAction[]) => Promise<void>;
  snoozeSession: (target: MachineRecord, session: GhostexSession, wakeAt: Date | null) => Promise<void>;
  openAddProject: (machineId: string) => void;
};

/** A session's row as the long-press menu and the Project list know it. */
function sessionItemOf(machineId: string, session: GhostexSession, summary: GhostexMobileSummary | null): SessionItem {
  const project = summary?.projects.find((entry) => entry.projectId === session.projectId);
  const projectKey = projectKeyForSession(session);
  return {
    type: 'SESSION',
    key: `session:${projectKey}:${session.sessionId}`,
    machineId,
    projectKey,
    projectId: session.projectId,
    groupId: session.groupId,
    projectTitle: project?.name ?? session.projectName,
    projectPath: project?.path ?? session.projectPath,
    session,
  };
}

/** The project's header as its card in the Project list would carry it, for the agent picker. */
function projectHeaderOf(machineId: string, summary: GhostexMobileSummary, projectId: string): ProjectHeaderItem | null {
  const items = buildDrawerItems({
    machineId,
    summary,
    nowMs: Date.now(),
    expandedProjectKeys: new Set([`id:${projectId}`]),
    expandedCollectionIds: new Set(),
    expandedGroupKeys: new Set(),
    collapsedSessionKindKeys: new Set(),
  });
  for (const item of items) {
    if (item.type === 'PROJECT_HEADER' && item.projectId === projectId) return item;
  }
  return null;
}

function hasImage(icon: GhostexProjectIcon | undefined): icon is GhostexProjectIcon {
  return icon !== undefined && (icon.imageDataUrl.length > 0 || icon.discoveredIconDataUrl.length > 0);
}

/** Redraws once a second while a card counts a working agent's time, else every half minute for the ages. */
function useListClock(ticking: boolean): number {
  const [, wake] = useReducer((tick: number) => tick + 1, 0);
  useEffect(() => {
    const timer = setInterval(wake, ticking ? 1_000 : 30_000);
    return () => clearInterval(timer);
  }, [ticking]);
  return Date.now();
}

export function useUnifiedList(deps: UnifiedListDeps) {
  const {
    machines,
    selectedMachine,
    inventoriesByMachineId,
    selectedWorkspaceIdByMachine,
    selectedSessionKey,
    sidebarBackground,
    setOverlay,
    attach,
    runBulkSessionActions,
    snoozeSession,
    openAddProject,
  } = deps;
  const selectedSummary = selectedMachine === null ? null : (inventoriesByMachineId[selectedMachine.id]?.summary ?? null);
  const on = wantsUnifiedSidebar(selectedSummary);
  const filter = useUnifiedListStore((state) => state.filter);
  const setFilter = useUnifiedListStore((state) => state.setFilter);
  const toggledShelves = useUnifiedListStore((state) => state.toggledShelves);
  const toggleShelf = useUnifiedListStore((state) => state.toggleShelf);
  const foldedGroups = useUnifiedListStore((state) => state.foldedGroups);
  const toggleGroup = useUnifiedListStore((state) => state.toggleGroup);
  const lastMachines = useUnifiedListStore((state) => state.lastMachines);
  const setQuery = useUnifiedListStore((state) => state.setQuery);
  useEffect(() => useUnifiedListStore.getState().hydrate(), []);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [groupNewFor, setGroupNewFor] = useState<UnifiedProjectChoice | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<{ machine: MachineRecord; session: GhostexSession; anchor: MenuAnchor } | null>(
    null,
  );

  const computers = useMemo((): UnifiedComputer[] => {
    if (!on) return [];
    const list: UnifiedComputer[] = [];
    for (const machine of machines) {
      const summary = inventoriesByMachineId[machine.id]?.summary ?? null;
      if (summary === null) continue;
      list.push({
        machineId: machine.id,
        label: machineDisplayLabel(machine),
        summary,
        workspaceId:
          summary.workspaces === null
            ? null
            : resolveWorkspaceId(summary.workspaces, selectedWorkspaceIdByMachine[machine.id]),
      });
    }
    return list;
  }, [on, machines, inventoriesByMachineId, selectedWorkspaceIdByMachine]);

  const [clockTicking, setClockTicking] = useState(false);
  const nowMs = useListClock(on && clockTicking);
  const view = useMemo(
    () => unifiedListOf(computers, unifiedSettingsOf(selectedSummary), filter, nowMs),
    [computers, selectedSummary, filter, nowMs],
  );
  const working = view.working.length > 0 || view.active.some((row) => row.status === 'Working');
  const layout = unifiedLayoutOf(selectedSummary);
  const groups = useMemo(
    (): UnifiedGroup<GhostexSession>[] => (layout.groupByProject ? groupUnifiedList(view, layout.projectOrder) : []),
    // `projectOrder` is a new array per summary read, so its content is the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, layout.groupByProject, layout.projectOrder.join('\n')],
  );
  const choices = useMemo((): UnifiedProjectChoice[] => {
    if (!on) return [];
    return unifiedProjectChoices(
      computers.map((computer) => ({
        machine: computer.machineId,
        label: computer.label,
        connected: (inventoriesByMachineId[computer.machineId]?.lastError ?? null) === null,
        projects: unifiedMachineInput(computer, false).projects,
      })),
      lastMachines,
      selectedMachine?.id ?? '',
      selectedMachine?.id ?? '',
    );
  }, [on, computers, inventoriesByMachineId, lastMachines, selectedMachine]);
  useEffect(() => setClockTicking(working), [working]);

  /** One icon per repository: the first of its projects, on any computer, that has one. */
  const repoIcons = useMemo(() => {
    const icons = new Map<string, GhostexProjectIcon>();
    for (const row of [...view.drafts, ...view.pinned, ...view.active, ...view.working, ...view.snoozed, ...view.parked]) {
      if (icons.has(row.repo.key)) continue;
      const icon = inventoriesByMachineId[row.machine]?.summary?.projects.find(
        (project) => project.projectId === row.session.projectId,
      )?.icon;
      if (hasImage(icon)) icons.set(row.repo.key, icon);
    }
    return icons;
  }, [view, inventoriesByMachineId]);

  const items = useMemo((): UnifiedListItem[] => {
    const list: UnifiedListItem[] = [];
    if (view.drafts.length > 0) {
      const open = shelfOpen('drafts', toggledShelves);
      list.push({ kind: 'shelf', key: 'shelf:drafts', shelf: 'drafts', repoKey: null, count: view.drafts.length, open });
      if (open) for (const row of view.drafts) list.push({ kind: 'card', key: row.id, row });
      list.push({ kind: 'gap', key: 'gap:drafts' });
    }
    const pushShelf = (shelf: 'working' | 'snoozed' | 'parked', rows: UnifiedRow<GhostexSession>[], repoKey: string | null): void => {
      const open = shelfOpen(shelf, toggledShelves, repoKey);
      const scope = repoKey === null ? '' : `${repoKey}|`;
      list.push({ kind: 'shelf', key: `shelf:${scope}${shelf}`, shelf, repoKey, count: rows.length, open });
      if (!open) return;
      for (const row of rows) {
        list.push(shelf === 'working' ? { kind: 'card', key: row.id, row, inGroup: repoKey !== null } : { kind: 'slim', key: row.id, shelf, row });
      }
    };
    if (layout.groupByProject) {
      for (const group of groups) {
        const open = !foldedGroups.includes(group.repoKey);
        list.push({ kind: 'group', key: `group:${group.repoKey}`, repoKey: group.repoKey, label: group.label, count: unifiedGroupCount(group), open });
        if (!open) continue;
        for (const row of [...group.pinned, ...group.active]) list.push({ kind: 'card', key: row.id, row, inGroup: true });
        for (const shelf of ['working', 'snoozed', 'parked'] as const) {
          if (group[shelf].length > 0) pushShelf(shelf, group[shelf], group.repoKey);
        }
      }
    } else {
      for (const row of [...view.pinned, ...view.active]) list.push({ kind: 'card', key: row.id, row });
      const shelves = (['working', 'snoozed', 'parked'] as const).filter((shelf) => view[shelf].length > 0);
      if (shelves.length > 0) list.push({ kind: 'gap', key: 'gap:shelves' });
      for (const shelf of shelves) pushShelf(shelf, view[shelf], null);
    }
    if (list.length === 0) {
      const anyProjects = computers.some((computer) => computer.summary.projects.length > 0);
      list.push({
        kind: 'empty',
        key: 'empty',
        text: !anyProjects
          ? 'No projects yet'
          : (view.filter.query ?? '').trim().length > 0
            ? `No sessions match "${(view.filter.query ?? '').trim()}"`
            : view.total > 0
              ? 'No sessions match this filter'
              : 'No sessions yet',
      });
    }
    return list;
  }, [view, toggledShelves, computers, groups, foldedGroups, layout.groupByProject]);

  const machineById = (machineId: string): MachineRecord | null =>
    machines.find((machine) => machine.id === machineId) ?? null;
  const summaryOf = (machineId: string) => inventoriesByMachineId[machineId]?.summary ?? null;

  const openMenu = (row: UnifiedRow<GhostexSession>): void => {
    const target = machineById(row.machine);
    if (target === null) return;
    setOverlay({
      kind: 'sessionMenu',
      ctx: { machine: target, item: sessionItemOf(target.id, row.session.source!, summaryOf(target.id)), unified: true },
      menuPath: [],
    });
  };

  const swipeActions = unifiedSwipeActions(
    selectedSummary?.unifiedSessionCardHoverButtons,
    unifiedSettingsOf(selectedSummary).parking,
  );

  /** The agent picker in one project; nothing is opened first, so no default agent starts. */
  const openPickerIn = (machineId: string, projectId: string): void => {
    const target = machineById(machineId);
    const summary = summaryOf(machineId);
    if (target === null || summary === null) return;
    const projectHeader = projectHeaderOf(machineId, summary, projectId);
    if (projectHeader !== null) setOverlay({ kind: 'agentMenu', ctx: { machine: target, header: projectHeader } });
  };

  /** A group's "+": its one machine, or a menu of its machines. */
  const openGroupNewSession = (repoKey: string): void => {
    const choice = choices.find((entry) => entry.repoKey === repoKey);
    if (choice === undefined) return;
    const reachable = choice.machines.filter((machine) => machine.connected);
    const first = reachable[0];
    if (first === undefined) return;
    if (reachable.length === 1) openPickerIn(first.machineId, first.projectId);
    else setGroupNewFor(choice);
  };

  const renderItem: FlatListProps<UnifiedListItem>['renderItem'] = ({ item }) => {
    if (item.kind === 'gap') return <View style={styles.gap} />;
    if (item.kind === 'empty') return <Text style={styles.empty}>{item.text}</Text>;
    if (item.kind === 'shelf') {
      const shelfKey = item.repoKey === null ? item.shelf : `${item.repoKey}|${item.shelf}`;
      return <UnifiedShelfHeader shelf={item.shelf} count={item.count} open={item.open} onToggle={() => toggleShelf(shelfKey)} />;
    }
    if (item.kind === 'group') {
      return (
        <UnifiedGroupHeader
          label={item.label}
          icon={repoIcons.get(item.repoKey) ?? null}
          count={item.count}
          open={item.open}
          onToggle={() => toggleGroup(item.repoKey)}
          onNew={() => openGroupNewSession(item.repoKey)}
        />
      );
    }
    const { row } = item;
    const target = machineById(row.machine);
    const session = row.session.source!;
    const active = selectedSessionKey === attachSessionKey(row.machine, session.sessionId);
    const repoIcon = repoIcons.get(row.repo.key) ?? null;
    if (item.kind === 'slim') {
      return (
        <UnifiedSlimRow
          row={row}
          shelf={item.shelf}
          repoIcon={repoIcon}
          active={active}
          nowMs={nowMs}
          sidebarBackground={sidebarBackground}
          onPress={() => target !== null && void attach(target, session)}
          onMenu={() => openMenu(row)}
          onRestore={() => {
            if (target === null) return;
            if (item.shelf === 'snoozed') void snoozeSession(target, session, null);
            else void runBulkSessionActions(target, [parkSessionAction(session, false)]);
          }}
        />
      );
    }
    return (
      <UnifiedCard
        row={row}
        repoIcon={repoIcon}
        active={active}
        nowMs={nowMs}
        sidebarBackground={sidebarBackground}
        onPress={() => target !== null && void attach(target, session)}
        onMenu={() => openMenu(row)}
        onSnooze={(anchor) => target !== null && setSnoozeFor({ machine: target, session, anchor })}
        onPark={() => target !== null && void runBulkSessionActions(target, [parkSessionAction(session, true)])}
        onSleep={() => target !== null && void runBulkSessionActions(target, [lifecycleSessionAction(session, true)])}
        swipeActions={swipeActions}
        inGroup={item.inGroup === true}
      />
    );
  };

  /**
   * The New session button opens the agent picker in the project the filter narrows to when it is
   * one project (on the selected computer first), else the open session's project, else the top card's.
   */
  const openNewSession = (): void => {
    const all = [...view.drafts, ...view.pinned, ...view.active, ...view.working, ...view.snoozed, ...view.parked];
    const open = all.find((row) => selectedSessionKey === attachSessionKey(row.machine, row.session.sessionId));
    const aimed = unifiedNewSessionTarget(view.filter, choices, open?.session.projectId ?? null);
    let machineId: string | null = aimed?.machineId ?? null;
    let projectId: string | null = aimed?.projectId ?? null;
    if (projectId === null) {
      const fallback =
        all.find((row) => selectedSessionKey === attachSessionKey(row.machine, row.session.sessionId)) ?? all[0];
      if (fallback !== undefined) {
        machineId = fallback.machine;
        projectId = fallback.session.projectId;
      }
    }
    if (machineId === null || projectId === null) {
      if (selectedMachine !== null) openAddProject(selectedMachine.id);
      return;
    }
    openPickerIn(machineId, projectId);
  };

  const filtered = !isUnifiedFilterEmpty(view.filter);
  const filterButtonRef = useRef<ViewInstance | null>(null);
  const header: ReactElement | null = on ? (
    <View style={styles.header}>
      <TextInput
        accessibilityLabel="Search sessions"
        placeholder="Search sessions"
        placeholderTextColor={SIDEBAR_MUTED}
        value={filter.query ?? ''}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
        style={styles.search}
      />
      <Pressable
        ref={filterButtonRef}
        accessibilityRole="button"
        accessibilityLabel={`Filter sessions: ${unifiedFilterLabel(view.options, view.filter)}`}
        onPress={() => setFilterMenuOpen(true)}
        style={({ pressed }) => [styles.iconButton, filtered || pressed ? styles.filterOn : null]}
      >
        <FilterGlyph size={ds(15)} color={SIDEBAR_TEXT} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add project"
        style={styles.iconButton}
        onPress={() => selectedMachine !== null && openAddProject(selectedMachine.id)}
      >
        <FolderPlusGlyph size={ds(15)} color={SIDEBAR_TEXT} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="New session" style={styles.iconButton} onPress={openNewSession}>
        <EditGlyph size={ds(15)} color={SIDEBAR_TEXT} />
      </Pressable>
    </View>
  ) : null;

  const filterItems = (): ContextMenuItem[] =>
    unifiedFilterMenu(view.options, view.filter).map((row, index): ContextMenuItem => {
      switch (row.kind) {
        case 'all':
          return {
            kind: 'item',
            key: 'all',
            label: 'All sessions',
            selected: row.checked,
            onPress: () => {
              setFilter(EMPTY_UNIFIED_FILTER);
              setFilterMenuOpen(false);
            },
          };
        case 'separator':
          return { kind: 'separator', key: row.key };
        case 'heading':
          return { kind: 'heading', key: `heading-${index}`, label: row.label };
        case 'pick':
          return {
            kind: 'item',
            key: `${row.filterKind}:${row.key}`,
            label: row.label,
            suffix: row.detail ?? undefined,
            selected: row.checked,
            onPress: () => {
              setFilter(toggleUnifiedFilter(view.filter, row.filterKind, row.key));
              setFilterMenuOpen(false);
            },
          };
      }
    });

  const overlays = (
    <>
      {on && filterMenuOpen ? (
        <ContextMenu
          visible
          title="Filter sessions"
          items={filterItems()}
          maxHeight={420}
          onClose={() => setFilterMenuOpen(false)}
        />
      ) : null}
      {groupNewFor !== null ? (
        <ContextMenu
          visible
          title={groupNewFor.label}
          subtitle="New session on"
          items={groupNewFor.machines
            .filter((machine) => machine.connected)
            .map((machine) => ({
              kind: 'item' as const,
              key: machine.machineId,
              label: machine.label,
              onPress: () => {
                setGroupNewFor(null);
                openPickerIn(machine.machineId, machine.projectId);
              },
            }))}
          onClose={() => setGroupNewFor(null)}
        />
      ) : null}
      {snoozeFor !== null ? (
        <ContextMenu
          visible
          title={snoozeFor.session.displayTitle}
          subtitle="Snooze"
          items={SNOOZE_PRESETS.map(({ preset, label }) => ({
            kind: 'item' as const,
            key: preset,
            label,
            icon: <AlarmGlyph size={14} color={SIDEBAR_TEXT} />,
            onPress: () => {
              const { machine, session } = snoozeFor;
              setSnoozeFor(null);
              void snoozeSession(machine, session, snoozeWakeAt(preset, new Date()));
            },
          }))}
          onClose={() => setSnoozeFor(null)}
        />
      ) : null}
    </>
  );

  const keyExtractor = (item: UnifiedListItem): string => item.key;
  return { on, header, overlays, items, renderItem, keyExtractor, view };
}

const styles = StyleSheet.create({
  header: {
    height: ds(36),
    paddingHorizontal: ds(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: ds(2),
  },
  search: {
    flex: 1,
    minWidth: 0,
    height: ds(28),
    paddingHorizontal: ds(8),
    paddingVertical: 0,
    borderRadius: ds(6),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.12)',
    color: SIDEBAR_TEXT,
    fontSize: ds(13),
  },
  filterOn: { backgroundColor: 'rgba(255,255,255,0.07)' },
  iconButton: {
    width: ds(26),
    height: ds(26),
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: ds(5),
  },
  gap: { height: ds(10) },
  empty: {
    paddingVertical: ds(26),
    textAlign: 'center',
    color: SIDEBAR_MUTED,
    fontSize: ds(13),
  },
});
