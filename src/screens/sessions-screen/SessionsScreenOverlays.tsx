/**
 * The Sessions screen's overlays: the menus, sheets and dialogs its `overlay` state opens (a session's, a project's,
 * the app menu with Sort & Filter, the computer picker, the agent menu and the project sheet), the Unified list's own
 * and the Cloud Box start prompt. Moved from src/screens/SessionsScreen.tsx, which keeps the state and the handlers.
 */

import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { openTailscaleOrDownload } from '../../app/tailscale';
import SessionLinksSheet from '../../chat/native/SessionLinksSheet';
import { ProjectPickerSheet } from '../../chat/native/composer/ProjectPickerSheet';
import { cloudBoxRowMenu } from '../../cloudBoxes/rowMenu';
import { runPhoneBoxStart, type PhoneBoxStart } from '../../cloudBoxes/phoneStartFlow';
import { cloudWhereItems } from '../../cloudBoxes/whereMenu';
import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createAgentCommand,
  delayedSendCommand,
  relocateProjectCommand,
  removeProjectCommand,
} from '../../commands/ghostexCli';
import ActionSheet, { type ActionSheetItem } from '../../components/common/ActionSheet';
import ConfirmDialog from '../../components/common/ConfirmDialog';
import type { Notice } from '../../components/common/NoticeToast';
import DetailsSheet from '../../components/common/DetailsSheet';
import LogsSheet from '../../components/common/LogsSheet';
import PromptDialog from '../../components/common/PromptDialog';
import type { useLiveMenuAnchor } from '../../components/common/verticalBar/VerticalBarArea';
import ConnectionsSheet from '../../components/sessions/ConnectionsSheet';
import ContextMenu, { type ContextMenuItem } from '../../components/sessions/ContextMenu';
import DelayedSendDialog from '../../components/sessions/DelayedSendDialog';
import { FilterGlyph } from '../../components/sessions/icons';
import { useTagFilterStore } from '../../components/sessions/tagFilterStore';
import type { useConnectionEntries } from '../../components/sessions/useConnectionEntries';
import ExportTranscriptSheet from '../../components/terminal/ExportTranscriptSheet';
import { HOME_LABEL } from '../../contract/chief';
import { stateWithCollectionTitle } from '../../contract/collectionsState';
import { folderAskAiPrompt, folderFixedWords, type FolderProblemView } from '../../contract/folderProblem';
import type { recentProjectsWithoutGbots } from '../../contract/gbotsFilter';
import { machineSessionCounts, tileStatusLines, type TileStatusCounts } from '../../contract/grouping';
import { NO_SUMMARY_CAPABILITIES, type GhostexMobileSummary } from '../../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy, SessionGroupsCopy, SessionNoteCopy, StateCardCopy } from '../../copy';
import { useInventoryStore, type MachineInventory } from '../../inventory/store';
import LinksSheet from '../../links/LinksSheet';
import { machineDisplayLabel, machineName, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import { plural } from '../../plural';
import { renameInitialTitle, runSessionCommand as runSessionCommandOnMachine } from '../../sessions/sessionCommands';
import { setGroupSessionsByTags } from '../../settingsSync/groupingSwitch';
import { setSidebarSetting } from '../../settingsSync/settingsSync';
import type { Appearance } from '../../theme/useAppearance';
import { closeConfirmCopy } from './close-confirm';
import CoordinatorDetailsSheet from './CoordinatorDetailsSheet';
import CoordinatorPlaybookSheet from './CoordinatorPlaybookSheet';
import { projectChoicesNow } from './new-session-place';
import NewCoordinatorSheet from './NewCoordinatorSheet';
import {
  closePutsSessionToSleep,
  closeSessionAction,
  NONE,
  sessionTitle,
  type Overlay,
  type SessionContext,
} from './session-actions';
import type { useSessionsScreenActions } from './use-sessions-screen-actions';
import type { useSessionsScreenMenus } from './use-sessions-screen-menus';
import WorkLinkPicker from './work-link-picker';

/** A Space or computer tile's counts for its long-press menu's subtitle (grouping.ts `tileStatusLines`). */
export function tileCountsLine(counts: TileStatusCounts | undefined): string | undefined {
  const lines = counts === undefined ? [] : tileStatusLines(counts);
  return lines.length > 0 ? lines.join(' · ') : undefined;
}

/** The Close dialog's words: a coordinator or a busy agent names what closes (close-confirm.ts). */
function closeDialogCopy(ctx: SessionContext): { title: string; body: string } {
  const session = ctx.item.session;
  if (closePutsSessionToSleep(session)) return { title: 'Close session?', body: SessionCopy.claudeCloudCloseSleeps };
  const summary = useInventoryStore.getState().inventoriesByMachineId[ctx.machine.id]?.summary;
  const sessions = summary?.sessions ?? [];
  return (
    closeConfirmCopy(session, sessions, summary?.capabilities ?? NO_SUMMARY_CAPABILITIES) ?? {
      title: 'Close session?',
      body: 'This closes the selected Ghostex session on the connected machine.',
    }
  );
}

/** What the Sort & Filter menu reads: the selected computer's organized summary and the Project list's tag filter. */
export type SortFilterInputs = {
  summary: GhostexMobileSummary | null;
  hideProjects: boolean;
  offeredTagFilters: readonly string[];
  tagFilters: readonly string[];
  tagLabel: (tag: string) => string;
};

/**
 * The desktop's More › Sort & Filter (gx-core sidebar_menu/navigation.rs `more_menu`): the view switch, the list's
 * organization (synced with the computers through Sidebar organization sync) and, in the Project list, the tag
 * filter (this phone's own, as each desktop window keeps its own). The menu stays open so a pick shows at once.
 */
function sortFilterItems(
  { summary, hideProjects, offeredTagFilters, tagFilters, tagLabel }: SortFilterInputs,
  unifiedOn: boolean,
  setOverlay: (overlay: Overlay) => void,
): ContextMenuItem[] {
  const pinnedOrder = summary?.pinnedSessionOrder === 'recent' ? 'recent' : 'manual';
  const items: ContextMenuItem[] = [
    {
      kind: 'item',
      key: 'view',
      label: unifiedOn ? 'Switch to Project View' : 'Switch to Unified View',
      onPress: () => {
        setOverlay(NONE);
        setSidebarSetting('sidebarView', unifiedOn ? 'project' : 'unified');
      },
    },
    { kind: 'separator', key: 'sep-view' },
  ];
  if (unifiedOn) {
    const grouping = summary?.groupSessionsByTags === true;
    items.push(
      {
        kind: 'item',
        key: 'group-by-project',
        label: 'Group by Project',
        selected: summary?.unifiedGroupByProject === true,
        onPress: () => setSidebarSetting('unifiedGroupByProject', summary?.unifiedGroupByProject !== true),
      },
      {
        kind: 'item',
        key: 'group-by-tags',
        label: SessionGroupsCopy.switchLabel,
        selected: grouping,
        onPress: () => setGroupSessionsByTags(!grouping, summary),
      },
    );
    // No Moving section while the groups are on, so no row for it either; its setting is kept.
    if (!grouping) {
      items.push({
        kind: 'item',
        key: 'moving-section',
        label: 'Moving Section',
        selected: summary?.unifiedWorkingSection !== false,
        onPress: () => setSidebarSetting('unifiedWorkingSection', summary?.unifiedWorkingSection === false),
      });
    }
    // Session order, as the desktop's Sort & Filter lists it (CDXC:Sidebar 2026-11-17 in gx-core
    // unified_sidebar/build.rs `unified_session_cmp`).
    const sessionOrder = summary?.unifiedSessionOrder ?? 'recent';
    items.push({ kind: 'heading', key: 'session-order-heading', label: 'Session order' });
    for (const [value, label] of [
      ['recent', 'Recent activity'],
      ['alphabetical', 'Alphabetical'],
      ['created', 'Created'],
    ] as const) {
      items.push({
        kind: 'item',
        key: `session-order-${value}`,
        label,
        selected: sessionOrder === value,
        onPress: () => setSidebarSetting('unifiedSessionOrder', value),
      });
    }
  } else {
    items.push(
      {
        kind: 'item',
        key: 'group-working',
        label: 'Group Working Sessions',
        selected: summary?.groupWorkingSessions === true,
        onPress: () => setSidebarSetting('groupWorkingSessions', summary?.groupWorkingSessions !== true),
      },
      {
        kind: 'item',
        key: 'hide-empty',
        label: 'Hide Projects Without Sessions',
        selected: hideProjects,
        onPress: () => setSidebarSetting('sidebarHideProjectsWithoutSessions', !hideProjects),
      },
    );
  }
  items.push(
    { kind: 'heading', key: 'pinned-heading', label: 'Pinned order' },
    {
      kind: 'item',
      key: 'pinned-manual',
      label: 'Manual',
      selected: pinnedOrder === 'manual',
      onPress: () => setSidebarSetting('pinnedSessionOrder', 'manual'),
    },
    {
      kind: 'item',
      key: 'pinned-recent',
      label: 'Most recently updated',
      selected: pinnedOrder === 'recent',
      onPress: () => setSidebarSetting('pinnedSessionOrder', 'recent'),
    },
  );
  if (!unifiedOn && offeredTagFilters.length > 0) {
    items.push({ kind: 'heading', key: 'tags-heading', label: 'Show only sessions tagged' });
    for (const tag of offeredTagFilters) {
      items.push({
        kind: 'item',
        key: `tag:${tag}`,
        label: tagLabel(tag),
        selected: tagFilters.includes(tag),
        onPress: () => useTagFilterStore.getState().toggle(tag),
      });
    }
    if (tagFilters.length > 0) {
      items.push({
        kind: 'item',
        key: 'tags-clear',
        label: 'Clear filter',
        onPress: () => useTagFilterStore.getState().clear(),
      });
    }
  }
  return items;
}

export type SessionsScreenOverlaysProps = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  navigation: NativeStackScreenProps<RootStackParamList, 'Sessions'>['navigation'];
  actions: ReturnType<typeof useSessionsScreenActions>;
  menus: ReturnType<typeof useSessionsScreenMenus>;
  unified: { on: boolean; overlays: ReactNode };
  sortFilter: SortFilterInputs;
  machines: MachineRecord[];
  machine: MachineRecord | null;
  selectMachine: (machineId: string) => void;
  machineById: (machineId: string) => MachineRecord | null;
  machineConnectionLine: (machineId: string) => string | undefined;
  retryMachineWithStatus: (target: MachineRecord) => void;
  inventoriesByMachineId: Record<string, MachineInventory>;
  sidebarAppearance: Appearance;
  appMenuAnchor: ReturnType<typeof useLiveMenuAnchor>;
  /** The screen's toast: a message, or `null` to clear it, with its title and error mark. */
  setTransientStatus: (message: string | null, options?: Partial<Pick<Notice, 'title' | 'error'>>) => void;
  setProgress: (message: string | null) => void;
  phoneBoxStart: PhoneBoxStart | null;
  setPhoneBoxStart: (start: PhoneBoxStart | null) => void;
  /** What a pick in the project sheet opens once the sheet has gone. */
  afterProjectSheet: { current: (() => void) | null };
  recentProjects: ReturnType<typeof recentProjectsWithoutGbots>;
  sortedConnectionEntries: ReturnType<typeof useConnectionEntries>;
};

export function SessionsScreenOverlays({
  overlay,
  setOverlay,
  navigation,
  actions,
  menus,
  unified,
  sortFilter,
  machines,
  machine,
  selectMachine,
  machineById,
  machineConnectionLine,
  retryMachineWithStatus,
  inventoriesByMachineId,
  sidebarAppearance,
  appMenuAnchor,
  setTransientStatus,
  setProgress,
  phoneBoxStart,
  setPhoneBoxStart,
  afterProjectSheet,
  recentProjects,
  sortedConnectionEntries,
}: SessionsScreenOverlaysProps) {
  const {
    attach,
    runSessionCommand,
    runCreationFlow,
    submitRename,
    submitSessionNote,
    restoreRecentProject,
    runProjectSessionsAction,
  } = actions;
  const {
    summaryFor,
    runCollectionsUpdate,
    sessionMenuView,
    projectMenuView,
    startTranscriptConversation,
    loadWorkLinkCandidates,
    saveWorkLinks,
    collectionMenuRootItems,
    collectionColorItems,
    groupMenuItems,
    parkedMenuItems,
    machineMenuItems,
    appMenuItems,
    agentMenuItems,
    placeItems,
    openAgentMenuAt,
    closeAgentMenuThen,
    onAgentMenuDismissed,
    openCoordinatorAgentStep,
    coordinatorAgentMenuItems,
    createCoordinatorOn,
    loadCoordinatorDetails,
    loadCoordinatorPlaybook,
    saveCoordinatorDetails,
    actionsMenuItems,
    recoveryItems,
    resolvePrimaryAgent,
  } = menus;
  const { tagFilters, tagLabel } = sortFilter;
  return (
    <>
      {overlay.kind === 'sessionMenu' ? (
        <ContextMenu
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          {...sessionMenuView(overlay.ctx, overlay.menuPath)}
          // A Cloud Box session's row holds the box's actions: the computer's session actions would
          // reach the computer, not the box (cloudBoxes/menu.tsx).
          {...cloudBoxRowMenu(
            overlay.ctx,
            () => void attach(overlay.ctx.machine, overlay.ctx.item.session),
            (message) => setTransientStatus(message),
            () => setOverlay(NONE),
          )}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'rename' ? (
        <PromptDialog
          visible
          title={RenameCopy.title}
          body={RenameCopy.body}
          placeholder={RenameCopy.inputHint}
          initialValue={renameInitialTitle(overlay.ctx.item.session)}
          error={overlay.error}
          confirmLabel="Rename"
          onSubmit={(value) => void submitRename(overlay.ctx, value)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'sessionNote' ? (
        <PromptDialog
          visible
          multiline
          title={SessionNoteCopy.title}
          body={SessionNoteCopy.body}
          placeholder={SessionNoteCopy.inputHint}
          initialValue={overlay.ctx.item.session.sessionNote}
          confirmLabel="Save"
          onSubmit={(value) => void submitSessionNote(overlay.ctx, value)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'sessionLinks' ? (
        <SessionLinksSheet
          visible
          onClose={() => setOverlay(NONE)}
          machine={overlay.ctx.machine}
          session={overlay.ctx.item.session}
          openTarget={inventoriesByMachineId[overlay.ctx.machine.id]?.summary?.sessionLinkOpenTarget ?? 'embedded'}
          openInApp={(url) => {
            const machineId = overlay.ctx.machine.id;
            setOverlay(NONE);
            navigation.navigate('WebPreview', { machineId, url });
          }}
        />
      ) : null}
      {overlay.kind === 'delayedSend' ? (
        <DelayedSendDialog
          agentIcon={overlay.ctx.item.session.agentIcon}
          agentName={
            overlay.ctx.item.session.agentName.length > 0
              ? overlay.ctx.item.session.agentName
              : overlay.ctx.item.session.agent
          }
          closeAfterDoneActive={overlay.ctx.item.session.closeAfterDone}
          supportsCloseAfterDone={!overlay.ctx.item.session.isCoordinator}
          visible
          sessionTitle={sessionTitle(overlay.ctx.item.session)}
          remainingLabel={overlay.ctx.item.session.delayedSendRemainingLabel}
          delayedSendDeadlineAt={overlay.ctx.item.session.delayedSendDeadlineAt}
          sendWhenAllProjectSessionsStopActive={overlay.ctx.item.session.sendWhenAllProjectSessionsStopActive}
          sendWhenAgentStopsActive={overlay.ctx.item.session.sendWhenAgentStopsActive}
          onConfirm={async (trigger, delayMs) => {
            await runSessionCommand(
              overlay.ctx.machine,
              delayedSendCommand(overlay.ctx.item.session.sessionId, trigger, delayMs),
            );
          }}
          onCancelTimer={async () => {
            await runSessionCommand(overlay.ctx.machine, cancelDelayedSendCommand(overlay.ctx.item.session.sessionId));
          }}
          onToggleCloseAfterDone={async () => {
            await runSessionCommand(overlay.ctx.machine, closeAfterDoneCommand(overlay.ctx.item.session.sessionId));
          }}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'closeConfirm' ? (
        <ConfirmDialog
          visible
          title={closeDialogCopy(overlay.ctx).title}
          body={closeDialogCopy(overlay.ctx).body}
          targetLine={`${overlay.ctx.item.session.alias} · ${sessionTitle(overlay.ctx.item.session)}`}
          confirmLabel="Close Session"
          destructive
          onConfirm={() => {
            const action = closeSessionAction(overlay.ctx.item.session, 'phone.sessionMenu');
            void runSessionCommand(overlay.ctx.machine, action.command, {
              closeWarmSessionId: action.sessionId,
              optimisticChange: action.optimisticChange,
            });
          }}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'exportedTranscript' ? (
        <ExportTranscriptSheet
          visible
          sessionTitle={overlay.exported.sessionTitle}
          path={overlay.exported.path}
          agentLabel={overlay.exported.agentId.length > 0 ? overlay.exported.agentLabel : ''}
          starting={false}
          error={null}
          onStartNewConversation={() => startTranscriptConversation(overlay.exported, overlay.projectTitle)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          {...projectMenuView(overlay.ctx, overlay.menuPath)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'collectionMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle={overlay.view === 'colors' ? 'Group color' : 'Group'}
          items={overlay.view === 'colors' ? collectionColorItems(overlay.ctx) : collectionMenuRootItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'groupMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.item.title}
          subtitle="Session group"
          items={groupMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'parkedMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.item.label}
          subtitle="Section"
          items={parkedMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'machineMenu' ? (
        <ContextMenu
          visible
          title={machineDisplayLabel(overlay.ctx.machine)}
          subtitle={
            [
              machineConnectionLine(overlay.ctx.machine.id),
              tileCountsLine(machineSessionCounts(inventoriesByMachineId[overlay.ctx.machine.id]?.summary ?? null)),
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          }
          items={machineMenuItems(overlay.ctx.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'appMenu' ? (
        <ContextMenu
          visible
          title="Ghostex"
          items={[
            ...(unified.on
              ? [
                  {
                    kind: 'item' as const,
                    key: 'computers',
                    label: 'Computers',
                    onPress: () => setOverlay({ kind: 'machinePicker', purpose: 'select' }),
                  },
                ]
              : []),
            {
              kind: 'item' as const,
              key: 'sort-filter',
              label: 'Sort & Filter',
              icon: <FilterGlyph size={14} color={sidebarAppearance.foreground} />,
              submenu: true,
              onPress: () => setOverlay({ kind: 'sortFilter' }),
            },
            ...appMenuItems(machine),
          ]}
          onClose={() => setOverlay(NONE)}
          anchor={appMenuAnchor}
        />
      ) : null}

      <LinksSheet
        visible={overlay.kind === 'links'}
        machine={machine}
        onClose={() => setOverlay(NONE)}
        onOpen={(url, machineId) => {
          setOverlay(NONE);
          navigation.navigate('WebPreview', { machineId, url });
        }}
      />

      {overlay.kind === 'sortFilter' ? (
        <ContextMenu
          visible
          title="Sort & Filter"
          subtitle={tagFilters.length > 0 ? `Showing ${tagFilters.map(tagLabel).join(' or ')}` : undefined}
          items={sortFilterItems(sortFilter, unified.on, setOverlay)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'machinePicker' ? (
        <ContextMenu
          visible
          title={overlay.purpose === 'addProject' ? 'Add project on' : 'Computers'}
          items={[
            ...machines.map((entry): ContextMenuItem => ({
              kind: 'item',
              key: entry.id,
              label: machineDisplayLabel(entry),
              suffix: machineConnectionLine(entry.id),
              selected: overlay.purpose === 'select' && machine?.id === entry.id,
              disabled: overlay.purpose === 'addProject' && inventoriesByMachineId[entry.id]?.summary == null,
              onPress: () => {
                setOverlay(NONE);
                if (overlay.purpose === 'addProject') navigation.navigate('AddProjectSource', { machineId: entry.id });
                else selectMachine(entry.id);
              },
            })),
            ...(overlay.purpose === 'select'
              ? [
                  { kind: 'separator' as const, key: 'computer-actions' },
                  {
                    kind: 'item' as const,
                    key: 'add-computer',
                    label: 'Add a computer',
                    onPress: () => {
                      setOverlay(NONE);
                      navigation.navigate('ConnectChoose');
                    },
                  },
                ]
              : []),
            {
              kind: 'item' as const,
              key: 'manage-computers',
              label: 'Manage computers',
              onPress: () => {
                setOverlay(NONE);
                navigation.navigate('Machines');
              },
            },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'collectionRename' ? (
        <PromptDialog
          visible
          title="Rename group"
          body="Update this project group's title."
          placeholder="Group title"
          initialValue={overlay.ctx.header.title}
          error={overlay.error}
          confirmLabel="Rename"
          onSubmit={(value) => {
            const title = value.trim();
            if (title.length === 0) {
              setOverlay({
                kind: 'collectionRename',
                ctx: overlay.ctx,
                error: 'Enter a title.',
              });
              return;
            }
            const state = summaryFor(overlay.ctx.machine.id)?.projectCollectionsState ?? null;
            runCollectionsUpdate(
              overlay.ctx.machine,
              stateWithCollectionTitle(state, overlay.ctx.header.collectionId, title),
            );
          }}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'confirmAction' ? (
        <ConfirmDialog
          visible
          title={overlay.title}
          body={overlay.body}
          confirmLabel={overlay.confirmLabel}
          destructive
          onConfirm={overlay.run}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {unified.overlays}

      {phoneBoxStart !== null ? (
        <PromptDialog
          visible
          multiline
          title={`${phoneBoxStart.agent.name} on a Cloud Box`}
          body={`Your computer is off. The phone starts a box for ${phoneBoxStart.projectTitle} from its Default snapshot and sends this first message.`}
          placeholder="What should the agent do?"
          confirmLabel="Start"
          onSubmit={(value) => {
            const start = phoneBoxStart;
            setPhoneBoxStart(null);
            if (value.trim().length === 0) return;
            void runPhoneBoxStart(start, value.trim(), {
              setProgress,
              setTransientStatus,
              navigate: (params) => navigation.navigate('Terminal', params),
            });
          }}
          onCancel={() => setPhoneBoxStart(null)}
        />
      ) : null}

      {/* Stays mounted while hidden so its dismissal reports back (`closeAgentMenuThen`). */}
      <ContextMenu
        visible={overlay.kind === 'agentMenu'}
        title={overlay.kind === 'agentMenu' ? overlay.ctx.header.title : ''}
        subtitle="Start an agent session"
        items={
          overlay.kind === 'agentMenu'
            ? [
                ...placeItems(overlay.ctx),
                ...cloudWhereItems(
                  overlay.ctx.machine.id,
                  overlay.ctx.header.projectId,
                  setTransientStatus,
                  (agent) => {
                    const ctx = overlay.ctx;
                    closeAgentMenuThen(() =>
                      setPhoneBoxStart({
                        machine: ctx.machine,
                        projectId: ctx.header.projectId,
                        projectTitle: ctx.header.title,
                        agent,
                      }),
                    );
                  },
                ),
                ...agentMenuItems(overlay.ctx),
              ]
            : []
        }
        onClose={() => setOverlay(NONE)}
        onDismissed={onAgentMenuDismissed}
      />

      {/*
        The agent menu's project row and the header's New session when its project can't open the menu:
        a pick opens the agent menu there once the sheet has gone (iOS).
      */}
      <ProjectPickerSheet
        visible={overlay.kind === 'newSessionProject'}
        title="Choose a project"
        choices={overlay.kind === 'newSessionProject' ? projectChoicesNow(overlay.currentMachineId) : []}
        onClose={() => setOverlay(NONE)}
        onDismissed={() => {
          const work = afterProjectSheet.current;
          afterProjectSheet.current = null;
          work?.();
        }}
        onPick={(choice, machineIndex) => {
          const machine = choice.machines[machineIndex];
          setOverlay(NONE);
          if (machine === undefined) return;
          const work = (): void => openAgentMenuAt(machine);
          if (Platform.OS === 'ios') afterProjectSheet.current = work;
          else work();
        }}
      />

      {overlay.kind === 'workLinkPicker' ? (
        <WorkLinkPicker
          kind={overlay.linkKind}
          sessionTitle={sessionTitle(overlay.ctx.item.session)}
          load={(query) => loadWorkLinkCandidates(overlay.ctx, overlay.linkKind, query)}
          onPick={(values) => saveWorkLinks(overlay.ctx, overlay.linkKind, values)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'newCoordinator' ? (
        <NewCoordinatorSheet
          key={overlay.ctx.header.key}
          projectTitle={overlay.ctx.header.title}
          copies={overlay.ctx.header.copies}
          defaultProjectId={overlay.ctx.header.defaultCopyProjectId}
          onNext={() => openCoordinatorAgentStep(overlay.ctx)}
          agentItems={(token, onPick, busy) => coordinatorAgentMenuItems(overlay.ctx, token, onPick, busy)}
          onCreate={(pick, agent, stillOpen) => createCoordinatorOn(overlay.ctx, pick, agent, stillOpen)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'coordinatorDetails' ? (
        <CoordinatorDetailsSheet
          mode={overlay.mode}
          load={() => loadCoordinatorDetails(overlay.ctx)}
          onSave={(edit) => saveCoordinatorDetails(overlay.ctx, edit)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'coordinatorPlaybook' ? (
        <CoordinatorPlaybookSheet
          load={() => loadCoordinatorPlaybook(overlay.ctx)}
          computer={machineName(overlay.ctx.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'actionsMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle="Quick actions"
          items={actionsMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectKillConfirm' ? (
        <ConfirmDialog
          visible
          title="Kill project sessions?"
          body={`This stops ${overlay.ctx.header.sessionCount} Ghostex sessions in this project on the connected machine.`}
          confirmLabel="Kill"
          destructive
          onConfirm={() => void runProjectSessionsAction(overlay.ctx, 'kill')}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'folderProblem' && overlay.ctx.header.folderProblem !== undefined
        ? (() => {
            // CDXC:Projects 2026-11-20 DECISION: the sheet of one project whose folder is missing (Q4244, contract/
            // folderProblem.ts): Use the folder the computer found, Ask AI to fix in Main Hub, Remove project, which
            // asks once. No Locate Folder…: it needs the computer's folder picker.
            const { machine, header } = overlay.ctx;
            const problem = header.folderProblem as FolderProblemView;
            const summary = inventoriesByMachineId[machine.id]?.summary ?? null;
            const homeProjectId = summary?.projects.find((project) => project.isHome === true)?.projectId;
            const agent = resolvePrimaryAgent(header);
            const items: ActionSheetItem[] = [];
            if (problem.useFolder !== undefined && problem.useLabel !== undefined) {
              const folder = problem.useFolder;
              items.push({
                key: 'use',
                label: overlay.busy ? 'Moving…' : problem.useLabel,
                detail: `Found: ${folder}`,
                disabled: overlay.busy,
                onPress: () => {
                  setOverlay({ ...overlay, busy: true });
                  void runSessionCommandOnMachine(machine, relocateProjectCommand(header.projectId, folder), {
                    onError: (message: string) =>
                      setTransientStatus(message, { title: "Couldn't move the project", error: true }),
                  }).then((result) => {
                    setOverlay(NONE);
                    if (result !== null) setTransientStatus(folderFixedWords(header.title, folder));
                  });
                },
              });
            }
            if (homeProjectId !== undefined && agent !== null) {
              items.push({
                key: 'ask-ai',
                label: 'Ask AI to fix',
                detail: `Starts a chat in ${HOME_LABEL} with what Ghostex found`,
                onPress: () => {
                  setOverlay(NONE);
                  const agentName = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
                  void runCreationFlow(
                    machine,
                    createAgentCommand(agent.agentId, homeProjectId, folderAskAiPrompt(header.title, problem)),
                    ProgressCopy.startingAgent(agentName, HOME_LABEL),
                  );
                },
              });
            }
            items.push({
              key: 'remove',
              label: overlay.confirmRemove ? `Remove ${header.title} from Ghostex` : 'Remove project',
              detail: overlay.confirmRemove ? 'Tap again to remove it. Its folder on disk is not touched.' : undefined,
              destructive: true,
              onPress: () => {
                if (!overlay.confirmRemove) {
                  setOverlay({ ...overlay, confirmRemove: true });
                  return;
                }
                setOverlay(NONE);
                void runSessionCommand(machine, removeProjectCommand(header.projectId));
              },
            });
            return (
              <ActionSheet
                visible
                title={problem.title}
                subtitle={problem.line}
                items={items}
                onClose={() => setOverlay(NONE)}
              />
            );
          })()
        : null}

      {overlay.kind === 'projectDetails' ? (
        <DetailsSheet
          visible
          title={overlay.ctx.header.title}
          subtitle="Project summary from the remote sidebar list."
          entries={[
            { label: 'Path', value: overlay.ctx.header.projectPath },
            {
              label: 'Sessions',
              value: String(overlay.ctx.header.sessionCount),
            },
            {
              label: 'Working',
              value: String(overlay.ctx.header.workingCount),
            },
            {
              label: 'Attention',
              value: String(overlay.ctx.header.attentionCount),
            },
            {
              label: 'Sleeping',
              value: String(overlay.ctx.header.sleepingCount),
            },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'recentProjects' ? (
        <ActionSheet
          visible
          title="Recent Projects"
          subtitle="Choose a parked project to restore to the active sidebar."
          items={recentProjects.map((project) => {
            const title = project.title !== undefined && project.title.length > 0 ? project.title : project.projectId;
            return {
              key: project.projectId,
              label: title,
              detail: `${project.path ?? ''} · ${plural(project.sessionCount ?? 0, 'session', 'sessions')}`,
              onPress: () => void restoreRecentProject(overlay.machine, project.projectId, title),
            };
          })}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'logs' ? (
        <LogsSheet visible exportNow={overlay.exportNow === true} onClose={() => setOverlay(NONE)} />
      ) : null}
      {overlay.kind === 'connections' ? (
        <ConnectionsSheet
          entries={sortedConnectionEntries}
          onClose={() => setOverlay(NONE)}
          onRetry={(machineId) => {
            const target = machineById(machineId);
            if (target !== null) retryMachineWithStatus(target);
          }}
          onOpenTailscale={() => void openTailscaleOrDownload()}
          onRemoteSettings={(machineId) => {
            setOverlay(NONE);
            navigation.navigate('MachineForm', { machineId });
          }}
          onLogs={(machineId) => setOverlay({ kind: 'logs', exportNow: machineId !== null })}
          onConnectionSettings={() => {
            setOverlay(NONE);
            navigation.navigate('SettingsPage', { page: 'connection' });
          }}
        />
      ) : null}

      {overlay.kind === 'recovery' ? (
        <ActionSheet
          visible
          title={overlay.machine !== null ? machineDisplayLabel(overlay.machine) : StateCardCopy.noMachines.title}
          items={recoveryItems(overlay.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
    </>
  );
}
