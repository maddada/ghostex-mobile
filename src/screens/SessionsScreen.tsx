/**
 * Sessions drawer as the app's home page (docs/specs/sessions-drawer.md §§1-6):
 * header + status line + Recent Projects + flat drawer list built from
 * buildDrawerItems, with session/project context menus, creation flows,
 * recovery sheet, and focus-scoped 5s inventory polling.
 */

import { useCallback, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  FlatList,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { markManualDisconnect } from '../app/autoReconnect';
import { openTailscaleOrDownload } from '../app/tailscale';
import ActionSheet, { type ActionSheetItem } from '../components/common/ActionSheet';
import ConfirmDialog from '../components/common/ConfirmDialog';
import DetailsSheet from '../components/common/DetailsSheet';
import LogsSheet from '../components/common/LogsSheet';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import StateCard from '../components/common/StateCard';
import { createdSessionId, runGhostexCli } from '../components/sessions/cli';
import { useCollapseStore } from '../components/sessions/collapseStore';
import ContextMenu from '../components/sessions/ContextMenu';
import {
  buildDrawerList,
  drawerStatusLine,
  type DrawerBlock,
  type ProjectCardBlock,
} from '../components/sessions/drawerModel';
import {
  ExitGlyph,
  MachinesGlyph,
  SearchGlyph,
  RefreshGlyph,
  SettingsGlyph,
} from '../components/sessions/icons';
import { useLauncherStore, lastActionKey } from '../components/sessions/launcherStore';
import {
  CollectionHeaderRow,
  collectionHeaderTint,
  COLLECTION_BRANCH_WIDTH,
  expandedGroupBackground,
  GroupHeaderRow,
  MachineHeaderRow,
  ProjectBranch,
  ProjectEmptyRow,
  ProjectHeaderRow,
  projectRailColor,
  TOP_LEVEL_BRANCH_WIDTH,
  SectionLabelRow,
  SessionKindLabelRow,
  SessionListToggleRow,
} from '../components/sessions/rows';
import SessionRow from '../components/sessions/SessionRow';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import { WarningTriangleIcon } from '../components/terminal/icons';
import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createChatCommand,
  createSessionCommand,
  delayedSendCommand,
  killSessionCommand,
  renameSessionCommand,
  restoreRecentProjectCommand,
  runActionCommand,
} from '../commands/ghostexCli';
import { stateWithCollectionTitle } from '../contract/collectionsState';
import {
  CHATS_PROJECT_KEY,
  projectKeyForSession,
  type DrawerItem,
  type ProjectHeaderItem,
} from '../contract/grouping';
import {
  displayStatus,
  formatLastActive,
  type GhostexQuickAction,
  type GhostexSession,
} from '../contract/mobileSummary';
import { ProgressCopy, RenameCopy, StateCardCopy } from '../copy';
import type { OptimisticInventoryChange } from '../inventory/optimistic';
import {
  enqueueRemoteMutation,
  renameMutation,
  runSessionCommand as runSessionCommandOnMachine,
} from '../sessions/sessionCommands';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, selectedMachine, useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { colorWithOpacity, GhostexPalette } from '../theme/palette';
import { resolveSidebarAppearance } from '../theme/sidebarAppearance';
import {
  closeMutation,
  closeSessionAction,
  lifecycleSessionAction,
  NONE,
  quickActionDisplayName,
  sessionTitle,
  type BulkSessionAction,
  type Overlay,
  type ProjectContext,
  type SessionContext,
} from './sessions-screen/session-actions';
import { styles } from './sessions-screen/styles';
import { useSessionsScreenMenus } from './sessions-screen/use-sessions-screen-menus';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

export default function SessionsScreen({ navigation }: Props) {
  const machines = useMachinesStore((state) => state.machines);
  const machine = useMachinesStore((state) => selectedMachine(state));
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const refreshMachine = useInventoryStore((state) => state.refreshMachine);
  const refreshAll = useInventoryStore((state) => state.refreshAll);
  const startPolling = useInventoryStore((state) => state.startPolling);
  const stopPolling = useInventoryStore((state) => state.stopPolling);

  const collapse = useCollapseStore();
  const primaryAgentId = useLauncherStore((state) => state.primaryAgentId);
  const lastActionByProject = useLauncherStore((state) => state.lastActionByProject);
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  const surfacedSessionKeys = useTerminalStore((state) => state.warmOrder);
  const sidebarBackgroundContrast = useSettingsStore(
    (state) => state.settings.sidebarBackgroundContrast,
  );
  const sidebarBackgroundTint = useSettingsStore(
    (state) => state.settings.sidebarBackgroundTint,
  );
  const sidebarGroupsOpacityPercent = useSettingsStore(
    (state) => state.settings.sidebarGroupsOpacityPercent,
  );
  const sidebarProjectsOpacityPercent = useSettingsStore(
    (state) => state.settings.sidebarProjectsOpacityPercent,
  );
  const sidebarAppearance = useMemo(
    () => resolveSidebarAppearance(sidebarBackgroundTint, sidebarBackgroundContrast),
    [sidebarBackgroundContrast, sidebarBackgroundTint],
  );
  const neutralExpandedGroupSurface = useMemo(
    () => expandedGroupBackground(sidebarAppearance.background),
    [sidebarAppearance.background],
  );

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  const [progress, setProgress] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [tailscaleConnected, setTailscaleConnected] = useState<boolean | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last logged Tailscale state, so the 5s probe logs only transitions. */
  const tailscaleLogged = useRef<boolean | null>(null);

  const machineById = useCallback(
    (id: string): MachineRecord | null => machines.find((entry) => entry.id === id) ?? null,
    [machines],
  );

  const setTransientStatus = useCallback((message: string | null): void => {
    if (statusTimer.current !== null) {
      clearTimeout(statusTimer.current);
      statusTimer.current = null;
    }
    setStatusOverride(message);
    if (message !== null) {
      logAppEvent(message);
      statusTimer.current = setTimeout(() => setStatusOverride(null), 6000);
    }
  }, []);

  // Poll every 5s only while this screen is focused AND a machine is selected.
  useFocusEffect(
    useCallback(() => {
      void useCollapseStore.getState().hydrate();
      void useLauncherStore.getState().hydrate();
      if (machine !== null) startPolling();
      return () => stopPolling();
    }, [machine !== null, startPolling, stopPolling]),
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;
      const applyTailscaleState = (connected: boolean): void => {
        if (!active) return;
        setTailscaleConnected(connected);
        if (tailscaleLogged.current !== connected) {
          tailscaleLogged.current = connected;
          logAppEvent(connected ? 'Tailscale: connected' : 'Tailscale: not connected');
        }
      };
      const refreshTailscaleStatus = (): void => {
        void GhostexNative.isTailscaleConnected()
          .then(applyTailscaleState)
          .catch(() => applyTailscaleState(false));
      };

      refreshTailscaleStatus();
      const interval = setInterval(refreshTailscaleStatus, 5000);
      const appStateSubscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') refreshTailscaleStatus();
      });
      return () => {
        active = false;
        clearInterval(interval);
        appStateSubscription.remove();
      };
    }, []),
  );

  // Android Back alternates between sessions and the selected warm terminal.
  // When no terminal is open, consume Back so exiting remains an explicit action.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        const terminal = useTerminalStore.getState();
        const selectedTab =
          terminal.tabs.find((tab) => tab.sessionKey === terminal.selectedSessionKey) ??
          terminal.tabs[terminal.tabs.length - 1];
        if (selectedTab !== undefined) {
          terminal.selectTab(selectedTab.sessionKey);
          navigation.navigate('Terminal', {
            sessionKey: selectedTab.sessionKey,
            machineId: selectedTab.machineId,
            title: selectedTab.title,
          });
        }
        return true;
      });
      return () => subscription.remove();
    }, [navigation]),
  );

  const entries = useMemo(
    () =>
      buildDrawerList({
        machines,
        inventoriesByMachineId,
        collapse: {
          expandedProjectsByMachine: collapse.expandedProjectsByMachine,
          expandedCollectionsByMachine: collapse.expandedCollectionsByMachine,
          expandedGroupsByMachine: collapse.expandedGroupsByMachine,
          collapsedSessionListsByMachine: collapse.collapsedSessionListsByMachine,
          collapsedSectionsByMachine: collapse.collapsedSectionsByMachine,
          collapsedSessionKindsByMachine: collapse.collapsedSessionKindsByMachine,
          collapsedMachineIds: collapse.collapsedMachineIds,
        },
      }),
    [
      machines,
      inventoriesByMachineId,
      collapse.expandedProjectsByMachine,
      collapse.expandedCollectionsByMachine,
      collapse.expandedGroupsByMachine,
      collapse.collapsedSessionListsByMachine,
      collapse.collapsedSectionsByMachine,
      collapse.collapsedSessionKindsByMachine,
      collapse.collapsedMachineIds,
    ],
  );

  const selectedInventory = machine === null ? undefined : inventoriesByMachineId[machine.id];
  const statusLine = statusOverride ?? drawerStatusLine(machine, selectedInventory);
  const recentProjects = selectedInventory?.summary?.recentProjects ?? [];

  // -------------------------------------------------------------------------
  // Actions.
  // -------------------------------------------------------------------------

  const attach = useCallback(
    async (target: MachineRecord, session: GhostexSession): Promise<void> => {
      setOverlay(NONE);
      // Desktop parity: opening a session from the list acknowledges its
      // attention status.
      acknowledgeSessionAttention(target.id, session.sessionId);
      setTransientStatus(ProgressCopy.preparingAttach(session.alias));
      try {
        const sessionKey = await useTerminalStore.getState().attachSession(target, {
          sessionId: session.sessionId,
          projectId: session.projectId.length > 0 ? session.projectId : undefined,
          title: sessionTitle(session),
        });
        setTransientStatus(ProgressCopy.attached(session.alias, machineDisplayLabel(target)));
        navigation.navigate('Terminal', {
          sessionKey,
          machineId: target.id,
          title: sessionTitle(session),
        });
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [navigation, setTransientStatus],
  );

  /**
   * Open a session straight onto its Session Chat surface. The attach tab's
   * key is deterministic, so chat mode is armed BEFORE the tab opens and the
   * Terminal screen mounts the chat view without flashing the terminal first.
   */
  const attachInChatMode = useCallback(
    async (target: MachineRecord, session: GhostexSession): Promise<void> => {
      const sessionKey = attachSessionKey(target.id, session.sessionId);
      const terminal = useTerminalStore.getState();
      if (!terminal.chatModeSessionKeys.includes(sessionKey)) {
        terminal.toggleChatMode(sessionKey);
      }
      await attach(target, session);
    },
    [attach],
  );

  /** Attach a session that only exists as an id (creation flows, §6). */
  const attachCreated = useCallback(
    async (target: MachineRecord, sessionId: string): Promise<void> => {
      const created = useInventoryStore
        .getState()
        .inventoriesByMachineId[target.id]?.summary?.sessions.find(
          (session) => session.sessionId === sessionId,
        );
      const sessionKey = await useTerminalStore.getState().attachSession(target, {
        sessionId,
        projectId: created !== undefined && created.projectId.length > 0 ? created.projectId : undefined,
        title: created !== undefined ? sessionTitle(created) : undefined,
      });
      navigation.navigate('Terminal', {
        sessionKey,
        machineId: target.id,
        title: created !== undefined ? sessionTitle(created) : undefined,
      });
    },
    [navigation],
  );

  const runSessionCommand = useCallback(
    async (
      target: MachineRecord,
      command: string,
      options?: {
        closeWarmSessionId?: string;
        optimisticChange?: OptimisticInventoryChange;
      },
    ): Promise<void> => {
      setOverlay(NONE);
      await runSessionCommandOnMachine(target, command, {
        ...options,
        onError: setTransientStatus,
      });
    },
    [setTransientStatus],
  );

  /** Run a session batch sequentially, retaining per-session rollback. */
  const runBulkSessionActions = useCallback(
    async (target: MachineRecord, actions: readonly BulkSessionAction[]): Promise<void> => {
      setOverlay(NONE);
      const changes = actions.flatMap((action) =>
        action.optimisticChange === undefined ? [] : [action.optimisticChange],
      );
      const mutationIds = useInventoryStore
        .getState()
        .beginOptimisticMutations(target.id, changes);
      let mutationIndex = 0;
      const prepared = actions.map((action) => {
        const mutationId =
          action.optimisticChange === undefined ? null : mutationIds[mutationIndex++];
        return { action, mutationId };
      });
      const failures: string[] = [];
      let successCount = 0;

      for (const { action, mutationId } of prepared) {
        const actionMutationIds = mutationId === null ? [] : [mutationId];
        try {
          await enqueueRemoteMutation(
            target.id,
            `session:${action.sessionId}`,
            async (): Promise<void> => {
              if (action.closeWarmSession) {
                await useTerminalStore
                  .getState()
                  .closeWarmSessionFor(target.id, action.sessionId);
              }
              await runGhostexCli(target, action.command);
              if (actionMutationIds.length > 0) {
                useInventoryStore
                  .getState()
                  .commitOptimisticMutations(target.id, actionMutationIds);
              }
            },
          );
          successCount++;
        } catch (error) {
          if (actionMutationIds.length > 0) {
            useInventoryStore
              .getState()
              .rollbackOptimisticMutations(target.id, actionMutationIds);
          }
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (successCount > 0) {
        await useInventoryStore.getState().refreshMachineFresh(target);
      }
      if (failures.length > 0) {
        const prefix =
          failures.length === 1 ? '1 session action failed' : `${failures.length} session actions failed`;
        setTransientStatus(`${prefix}: ${failures[0]}`);
      }
    },
    [setTransientStatus],
  );

  /** Creation flow (§6): progress overlay → CLI → refresh → auto-attach. */
  const runCreationFlow = useCallback(
    async (target: MachineRecord, command: string, message: string): Promise<void> => {
      setOverlay(NONE);
      setProgress(message);
      try {
        const result = await runGhostexCli(target, command);
        await refreshMachine(target);
        setProgress(null);
        const sessionId = createdSessionId(result);
        if (sessionId !== null) {
          await attachCreated(target, sessionId);
        }
      } catch (error) {
        setProgress(null);
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [attachCreated, refreshMachine, setTransientStatus],
  );

  const fullReconnect = useCallback(async (): Promise<void> => {
    for (const target of machines) {
      try {
        markManualDisconnect(target.id);
        await GhostexNative.disconnect(target.id);
      } catch {
        // Not connected is fine; refresh reconnects below.
      }
    }
    await refreshAll();
  }, [machines, refreshAll]);

  const submitRename = useCallback(
    async (ctx: SessionContext, value: string): Promise<void> => {
      const title = value.trim();
      if (title.length === 0) {
        setOverlay({ kind: 'rename', ctx, error: RenameCopy.emptyTitleError });
        return;
      }
      const { session } = ctx.item;
      await runSessionCommand(
        ctx.machine,
        renameSessionCommand(
          session.sessionId,
          title,
          session.projectId.length > 0 ? session.projectId : undefined,
        ),
        { optimisticChange: renameMutation(session.sessionId, title) },
      );
    },
    [runSessionCommand],
  );

  const runQuickAction = useCallback(
    (target: MachineRecord, projectId: string, projectTitle: string, action: GhostexQuickAction): void => {
      const name = quickActionDisplayName(action);
      if (action.actionType === 'browser') {
        const url = action.url ?? '';
        if (url.length === 0) return;
        void Linking.openURL(url)
          .then(() => setTransientStatus(ProgressCopy.openedInBrowser(name)))
          .catch(() => setTransientStatus(ProgressCopy.openedInBrowser(name)));
        return;
      }
      const commandId = action.commandId ?? '';
      if (commandId.length === 0) return;
      void runCreationFlow(
        target,
        runActionCommand(commandId, projectId),
        ProgressCopy.startingAgent(name, projectTitle),
      );
    },
    [runCreationFlow, setTransientStatus],
  );

  const restoreRecentProject = useCallback(
    async (target: MachineRecord, projectId: string, title: string): Promise<void> => {
      setOverlay(NONE);
      setTransientStatus(ProgressCopy.restoringProject(title));
      try {
        await runGhostexCli(target, restoreRecentProjectCommand(projectId));
        await refreshMachine(target);
        setTransientStatus(ProgressCopy.restoredProject(title));
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
  );

  const sessionsForProject = useCallback(
    (target: MachineRecord, header: ProjectHeaderItem): GhostexSession[] => {
      const summary = useInventoryStore.getState().inventoriesByMachineId[target.id]?.summary;
      if (summary === null || summary === undefined) return [];
      return summary.sessions.filter((session) => {
        const project = summary.projects.find((entry) => entry.projectId === session.projectId);
        const key =
          project !== undefined && project.isChat === true
            ? CHATS_PROJECT_KEY
            : projectKeyForSession(session);
        return key === header.projectKey;
      });
    },
    [],
  );

  const runProjectSessionsAction = useCallback(
    async (ctx: ProjectContext, action: 'wake' | 'sleep' | 'kill'): Promise<void> => {
      const sessions = sessionsForProject(ctx.machine, ctx.header);
      await runBulkSessionActions(
        ctx.machine,
        sessions.map((session) =>
          action === 'kill'
            ? closeSessionAction(session)
            : lifecycleSessionAction(session, action === 'sleep'),
        ),
      );
    },
    [runBulkSessionActions, sessionsForProject],
  );

  // -------------------------------------------------------------------------
  // Menus.
  // -------------------------------------------------------------------------

  const {
    summaryFor,
    runCollectionsUpdate,
    sessionMenuRootItems,
    sessionTagItems,
    projectMenuRootItems,
    projectCollectionsItems,
    collectionMenuRootItems,
    collectionColorItems,
    groupMenuItems,
    sectionMenuItems,
    resolvePrimaryAgent,
    launchAgent,
    agentMenuItems,
    actionsMenuItems,
    recoveryItems,
  } = useSessionsScreenMenus({
    entries,
    collapse,
    lastActionByProject,
    navigation,
    primaryAgentId,
    attach,
    attachInChatMode,
    refreshAll,
    refreshMachine,
    runBulkSessionActions,
    runCreationFlow,
    runQuickAction,
    runSessionCommand,
    sessionsForProject,
    setOverlay,
    setTransientStatus,
  });

  // -------------------------------------------------------------------------
  // Rendering.
  // -------------------------------------------------------------------------

  /** Rows nested inside a project card (sessions, groups, empty, Show more). */
  const renderChildItem = (
    target: MachineRecord | null,
    machineId: string,
    child: DrawerItem,
    expandedGroupSurface: string,
  ): ReactElement | null => {
    switch (child.type) {
      case 'PROJECT_EMPTY':
        return <ProjectEmptyRow key={child.key} text={child.text} quick={false} />;
      case 'GROUP_HEADER':
        return (
          <GroupHeaderRow
            key={child.key}
            title={child.title}
            count={child.count}
            collapsed={child.collapsed}
            onPress={() => collapse.toggleGroup(machineId, child.groupCollapseKey)}
            onMenu={() => {
              if (target === null) return;
              setOverlay({ kind: 'groupMenu', ctx: { machine: target, item: child } });
            }}
          />
        );
      case 'SESSION': {
        const sessionKey = attachSessionKey(machineId, child.session.sessionId);
        const active = selectedSessionKey === sessionKey;
        return (
          <SessionRow
            key={child.key}
            session={child.session}
            active={active}
            surfaced={surfacedSessionKeys.includes(sessionKey)}
            expandedGroupSurface={expandedGroupSurface}
            sidebarBackground={sidebarAppearance.background}
            sidebarForeground={sidebarAppearance.foreground}
            inCard
            onPress={() => {
              if (target !== null) void attach(target, child.session);
            }}
            onMenu={() => {
              if (target === null) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setOverlay({
                kind: 'sessionMenu',
                ctx: { machine: target, item: child },
                view: 'root',
              });
            }}
          />
        );
      }
      case 'SESSION_KIND_LABEL':
        return (
          <SessionKindLabelRow
            key={child.key}
            label={child.label}
            collapsed={child.collapsed}
            onPress={() => collapse.toggleSessionKind(machineId, child.kindCollapseKey)}
          />
        );
      case 'SESSION_LIST_TOGGLE':
        return (
          <SessionListToggleRow
            key={child.key}
            label={child.label}
            quick={false}
            onPress={() => collapse.toggleSessionList(machineId, child.projectKey)}
          />
        );
      default:
        return null;
    }
  };

  /** One desktop-style project card: header row + child rows. */
  const renderProjectCard = (
    target: MachineRecord | null,
    machineId: string,
    card: ProjectCardBlock,
    inCollection: boolean,
    expandedGroupSurface: string,
  ): ReactElement => {
    const header = card.header;
    const primaryAgent = resolvePrimaryAgent(header.agents);
    const selectedActionId = lastActionByProject[lastActionKey(machineId, header.projectId)] ?? '';
    const selectedAction =
      header.quickActions.find((action) => (action.commandId ?? '') === selectedActionId) ??
      (header.quickActions.length > 0 ? header.quickActions[0] : null);
    /*
     * Branched project rails (desktop [data-project-group-style="branched"]):
     * the card itself carries no border or fill — its membership is drawn by a
     * short branch reaching in from the owning collection's rail, or, for a
     * top-level project, from its own workspace theme color.
     */
    const branchColor = inCollection
      ? colorWithOpacity(
          projectRailColor(header.collectionColor ?? 'transparent', sidebarAppearance.background),
          sidebarGroupsOpacityPercent,
        )
      : colorWithOpacity(
          projectRailColor(
            header.themeColor.length > 0 ? header.themeColor : 'transparent',
            sidebarAppearance.background,
          ),
          sidebarProjectsOpacityPercent,
        );
    return (
      <View
        key={`card:${header.key}`}
        style={[
          styles.projectCard,
          inCollection ? styles.projectCardInPanel : styles.projectCardTopLevel,
          inCollection && !header.collapsed ? styles.projectCardExpanded : null,
        ]}
      >
        <ProjectBranch
          color={branchColor}
          width={inCollection ? COLLECTION_BRANCH_WIDTH : TOP_LEVEL_BRANCH_WIDTH}
        />
        <View style={styles.projectCardBody}>
        <ProjectHeaderRow
          title={header.title}
          icon={header.icon}
          collapsed={header.collapsed}
          workingCount={header.workingCount}
          attentionCount={header.attentionCount}
          awakeCount={header.awakeCount}
          hasActions={header.quickActions.length > 0}
          selectedActionType={
            selectedAction === null
              ? null
              : selectedAction.actionType === 'browser'
                ? 'browser'
                : 'terminal'
          }
          primaryAgent={primaryAgent}
          showSessionListCollapse={header.sessionListClipped && !header.sessionListCollapsed}
          onToggle={() => collapse.toggleProject(machineId, header.projectKey)}
          onMenu={() => {
            if (target === null) return;
            setOverlay({ kind: 'projectMenu', ctx: { machine: target, header }, view: 'root' });
          }}
          onCreateTerminal={() => {
            if (target === null) return;
            void runCreationFlow(
              target,
              createSessionCommand({
                projectId: header.projectId.length > 0 ? header.projectId : undefined,
                groupId:
                  header.projectId.length === 0 && header.legacyGroupId.length > 0
                    ? header.legacyGroupId
                    : undefined,
              }),
              ProgressCopy.creatingTerminal(header.title),
            );
          }}
          onLaunchPrimary={() => {
            if (target === null || primaryAgent === null) return;
            launchAgent(target, header, primaryAgent);
          }}
          onOpenAgentMenu={() => {
            if (target === null) return;
            setOverlay({ kind: 'agentMenu', ctx: { machine: target, header } });
          }}
          onOpenActionsMenu={() => {
            if (target === null) return;
            setOverlay({ kind: 'actionsMenu', ctx: { machine: target, header } });
          }}
          onCollapseSessionList={() => collapse.toggleSessionList(machineId, header.projectKey)}
        />
        {!header.collapsed && card.children.length > 0 ? (
          <View style={styles.cardSessions}>
            {card.children.map((child) =>
              renderChildItem(target, machineId, child, expandedGroupSurface),
            )}
          </View>
        ) : null}
        </View>
      </View>
    );
  };

  const renderBlock = ({ item: block }: { item: DrawerBlock }) => {
    const target = machineById(block.machineId);
    if (block.kind === 'project') {
      return renderProjectCard(
        target,
        block.machineId,
        block.card,
        false,
        neutralExpandedGroupSurface,
      );
    }
    if (block.kind === 'collection') {
      const header = block.header;
      /*
       * The branched panel paints no fill of its own any more, so a surfaced
       * session row inside it sits on the same neutral expanded-group surface
       * as one in a top-level project. Mixing the collection tint in here would
       * describe a backing that is no longer drawn.
       */
      const expandedGroupSurface = neutralExpandedGroupSurface;
      const railColor = colorWithOpacity(
        projectRailColor(header.color, sidebarAppearance.background),
        sidebarGroupsOpacityPercent,
      );
      return (
        <View style={styles.collectionPanel}>
          {/*
            Desktop section.project-collection::after: a 2dp rail in the
            collection's own color running the height of the panel, replacing
            the bordered card the panel used to be.
          */}
          {!header.collapsed ? (
            <View
              pointerEvents="none"
              style={[styles.collectionRail, { backgroundColor: railColor }]}
            />
          ) : null}
          <View
            style={[
              styles.collectionHeaderChip,
              {
                backgroundColor: colorWithOpacity(
                  collectionHeaderTint(header.color, sidebarAppearance.background),
                  sidebarGroupsOpacityPercent,
                ),
              },
            ]}
          >
          <CollectionHeaderRow
            title={header.title}
            collapsed={header.collapsed}
            workingCount={header.workingCount}
            attentionCount={header.attentionCount}
            awakeCount={header.awakeCount}
            onPress={() => collapse.toggleCollection(block.machineId, header.collectionId)}
            onMenu={() => {
              if (target === null) return;
              setOverlay({
                kind: 'collectionMenu',
                ctx: { machine: target, header },
                view: 'root',
              });
            }}
          />
          </View>
          {!header.collapsed && block.projects.length > 0 ? (
            <View style={styles.collectionProjects}>
              {block.projects.map((card) =>
                renderProjectCard(target, block.machineId, card, true, expandedGroupSurface),
              )}
            </View>
          ) : null}
        </View>
      );
    }
    const { item } = block;
    switch (item.type) {
      case 'STATE_CARD':
        return (
          <StateCard
            title={item.title}
            body={item.body}
            actionHint={item.actionHint}
            onPress={() => setOverlay({ kind: 'recovery', machine: target })}
          />
        );
      case 'MACHINE_HEADER':
        return (
          <MachineHeaderRow
            title={item.title}
            collapsed={item.collapsed}
            workingCount={item.workingCount}
            attentionCount={item.attentionCount}
            awakeCount={item.awakeCount}
            onPress={() => collapse.toggleMachine(item.machineId)}
          />
        );
      case 'SECTION_LABEL':
        return (
          <SectionLabelRow
            title={item.title}
            collapsed={item.collapsed}
            workingCount={item.workingCount}
            attentionCount={item.attentionCount}
            awakeCount={item.awakeCount}
            first={item.section === 'quick'}
            onToggle={() => collapse.toggleSection(block.machineId, item.section)}
            onCreate={
              item.section === 'quick'
                ? () => {
                    if (target === null) return;
                    void runCreationFlow(
                      target,
                      createChatCommand(),
                      ProgressCopy.creatingQuickSession,
                    );
                  }
                : undefined
            }
            onMenu={() => {
              if (target === null) return;
              setOverlay({ kind: 'sectionMenu', machine: target, section: item.section });
            }}
          />
        );
      case 'PROJECT_EMPTY':
        return <ProjectEmptyRow text={item.text} quick />;
      case 'SESSION': {
        const sessionKey = attachSessionKey(block.machineId, item.session.sessionId);
        const active = selectedSessionKey === sessionKey;
        return (
          <SessionRow
            session={item.session}
            active={active}
            surfaced={surfacedSessionKeys.includes(sessionKey)}
            expandedGroupSurface={neutralExpandedGroupSurface}
            sidebarBackground={sidebarAppearance.background}
            sidebarForeground={sidebarAppearance.foreground}
            inCard={false}
            onPress={() => {
              if (target !== null) void attach(target, item.session);
            }}
            onMenu={() => {
              if (target === null) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setOverlay({
                kind: 'sessionMenu',
                ctx: { machine: target, item },
                view: 'root',
              });
            }}
          />
        );
      }
      case 'SESSION_LIST_TOGGLE':
        return (
          <SessionListToggleRow
            label={item.label}
            quick
            onPress={() => collapse.toggleSessionList(block.machineId, item.projectKey)}
          />
        );
      default:
        return null;
    }
  };

  const refreshing = selectedInventory?.refreshing === true;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: sidebarAppearance.background }]}
      edges={['top', 'bottom']}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.title, { color: sidebarAppearance.foreground }]}>Ghostex</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          style={styles.headerButton}
          onPress={() => void fullReconnect()}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={sidebarAppearance.foreground} />
          ) : (
            <RefreshGlyph size={22} color={sidebarAppearance.foreground} />
          )}
        </Pressable>
        {/*
          Find Prompts searches the selected machine's agent history — the same
          index `gx f` reads — so it is offered only while a machine is chosen.
        */}
        {machine !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Find Prompts"
            style={styles.headerButton}
            onPress={() => navigation.navigate('FindPrompts', { machineId: machine.id })}
          >
            <SearchGlyph size={22} color={sidebarAppearance.foreground} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Machines"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Machines')}
        >
          <MachinesGlyph size={22} color={sidebarAppearance.foreground} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <SettingsGlyph size={22} color={sidebarAppearance.foreground} />
        </Pressable>
        {Platform.OS === 'android' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Quit Ghostex"
            style={styles.headerButton}
            onPress={() =>
              setOverlay({
                kind: 'confirmAction',
                title: 'Quit Ghostex?',
                body: 'This fully closes Ghostex and all active mobile terminal connections.',
                confirmLabel: 'Quit',
                run: () => void GhostexNative.quitApp(),
              })
            }
          >
            <ExitGlyph size={22} color={sidebarAppearance.foreground} />
          </Pressable>
        ) : null}
      </View>
      {tailscaleConnected === false ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Tailscale is not connected. Open Tailscale"
          style={styles.tailscaleWarning}
          onPress={() => void openTailscaleOrDownload()}
        >
          <WarningTriangleIcon size={18} color={GhostexPalette.STATUS_WORKING} />
          <View style={styles.tailscaleWarningCopy}>
            <Text style={styles.tailscaleWarningTitle}>Tailscale isn’t connected</Text>
            <Text style={styles.tailscaleWarningBody}>Tap to open Tailscale and reconnect.</Text>
          </View>
        </Pressable>
      ) : null}
      <View style={styles.statusRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show logs"
          hitSlop={8}
          style={styles.statusPressable}
          onPress={() => setOverlay({ kind: 'logs' })}
        >
          <Text
            style={[styles.statusLine, { color: sidebarAppearance.muted }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {statusLine}
          </Text>
        </Pressable>
        {tailscaleConnected === true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tailscale connected"
            hitSlop={8}
            style={styles.tailscaleIndicator}
            onPress={() => void openTailscaleOrDownload()}
          >
            <Text
              style={[
                styles.tailscaleIndicatorLabel,
                { color: GhostexPalette.STATUS_CONNECTED },
              ]}
            >
              • Tailscale
            </Text>
          </Pressable>
        ) : null}
      </View>
      {recentProjects.length > 0 && machine !== null ? (
        <Pressable
          accessibilityRole="button"
          style={styles.recentButton}
          onPress={() => setOverlay({ kind: 'recentProjects', machine })}
        >
          <Text style={[styles.recentButtonLabel, { color: sidebarAppearance.foreground }]}>
            Recent Projects
          </Text>
        </Pressable>
      ) : null}
      <FlatList
        data={entries}
        keyExtractor={(entry) => entry.listKey}
        renderItem={renderBlock}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListFooterComponent={
          <Text style={styles.longPressHint}>
            Long press a section, group, project, or session for more options
          </Text>
        }
      />
      <ProgressOverlay visible={progress !== null} message={progress ?? ''} />

      {overlay.kind === 'sessionMenu' ? (
        <ContextMenu
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          subtitle={overlay.view === 'tags' ? 'Tags' : overlay.ctx.item.projectTitle}
          items={
            overlay.view === 'tags'
              ? sessionTagItems(overlay.ctx)
              : sessionMenuRootItems(overlay.ctx)
          }
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'sessionDetails' ? (
        <DetailsSheet
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          subtitle="Remote session metadata from the Ghostex CLI."
          entries={[
            { label: 'Machine', value: machineDisplayLabel(overlay.ctx.machine) },
            { label: 'Project', value: overlay.ctx.item.projectTitle },
            { label: 'Project path', value: overlay.ctx.item.projectPath },
            { label: 'Status', value: displayStatus(overlay.ctx.item.session) },
            { label: 'Focused on Mac', value: overlay.ctx.item.session.isFocused ? 'Yes' : 'No' },
            {
              label: 'Last active',
              value: formatLastActive(
                overlay.ctx.item.session.lastInteractionAt.length > 0
                  ? overlay.ctx.item.session.lastInteractionAt
                  : overlay.ctx.item.session.lastActiveAt,
                new Date(),
              ),
            },
            { label: 'Provider', value: 'zmx' },
            {
              label: 'ZMX session',
              value:
                overlay.ctx.item.session.zmxName.length > 0
                  ? overlay.ctx.item.session.zmxName
                  : overlay.ctx.item.session.providerSessionName,
            },
            {
              label: 'Agent',
              value:
                overlay.ctx.item.session.agentName.length > 0
                  ? overlay.ctx.item.session.agentName
                  : overlay.ctx.item.session.agent,
            },
            { label: 'Session id', value: overlay.ctx.item.session.sessionId },
          ]}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'rename' ? (
        <PromptDialog
          visible
          title={RenameCopy.title}
          body={RenameCopy.body}
          placeholder={RenameCopy.inputHint}
          initialValue={overlay.ctx.item.session.title}
          error={overlay.error}
          confirmLabel="Rename"
          onSubmit={(value) => void submitRename(overlay.ctx, value)}
          onCancel={() => setOverlay(NONE)}
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
          visible
          sessionTitle={sessionTitle(overlay.ctx.item.session)}
          remainingLabel={overlay.ctx.item.session.delayedSendRemainingLabel}
          sendWhenAllProjectSessionsStopActive={
            overlay.ctx.item.session.sendWhenAllProjectSessionsStopActive
          }
          sendWhenAgentStopsActive={overlay.ctx.item.session.sendWhenAgentStopsActive}
          onConfirm={async (trigger, delayMs) => {
            await runSessionCommand(
              overlay.ctx.machine,
              delayedSendCommand(overlay.ctx.item.session.sessionId, trigger, delayMs),
            );
          }}
          onCancelTimer={async () => {
            await runSessionCommand(
              overlay.ctx.machine,
              cancelDelayedSendCommand(overlay.ctx.item.session.sessionId),
            );
          }}
          onToggleCloseAfterDone={async () => {
            await runSessionCommand(
              overlay.ctx.machine,
              closeAfterDoneCommand(overlay.ctx.item.session.sessionId),
            );
          }}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'closeConfirm' ? (
        <ConfirmDialog
          visible
          title="Close session?"
          body="This closes the selected Ghostex session on the connected machine."
          targetLine={`${overlay.ctx.item.session.alias} · ${sessionTitle(overlay.ctx.item.session)}`}
          confirmLabel="Close Session"
          destructive
          onConfirm={() =>
            void runSessionCommand(
              overlay.ctx.machine,
              killSessionCommand(
                overlay.ctx.item.session.sessionId,
                overlay.ctx.item.session.projectId.length > 0
                  ? overlay.ctx.item.session.projectId
                  : undefined,
              ),
              {
                closeWarmSessionId: overlay.ctx.item.session.sessionId,
                optimisticChange: closeMutation(overlay.ctx.item.session.sessionId),
              },
            )
          }
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'copyText' ? (
        <ConfirmDialog
          visible
          title={overlay.title}
          body={overlay.text}
          selectableBody
          confirmLabel="Close"
          cancelLabel={null}
          onConfirm={() => setOverlay(NONE)}
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'projectMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle={overlay.view === 'collections' ? 'Move to group' : 'Project'}
          items={
            overlay.view === 'collections'
              ? projectCollectionsItems(overlay.ctx)
              : projectMenuRootItems(overlay.ctx)
          }
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'collectionMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle={overlay.view === 'colors' ? 'Group color' : 'Group'}
          items={
            overlay.view === 'colors'
              ? collectionColorItems(overlay.ctx)
              : collectionMenuRootItems(overlay.ctx)
          }
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

      {overlay.kind === 'sectionMenu' ? (
        <ContextMenu
          visible
          title={overlay.section === 'quick' ? 'Quick Actions' : 'Projects'}
          subtitle={machineDisplayLabel(overlay.machine)}
          items={sectionMenuItems(overlay.machine, overlay.section)}
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
              setOverlay({ kind: 'collectionRename', ctx: overlay.ctx, error: 'Enter a title.' });
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

      {overlay.kind === 'agentMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle="Start an agent session"
          items={agentMenuItems(overlay.ctx)}
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

      {overlay.kind === 'projectDetails' ? (
        <DetailsSheet
          visible
          title={overlay.ctx.header.title}
          subtitle="Project summary from the remote sidebar list."
          entries={[
            { label: 'Path', value: overlay.ctx.header.projectPath },
            { label: 'Sessions', value: String(overlay.ctx.header.sessionCount) },
            { label: 'Working', value: String(overlay.ctx.header.workingCount) },
            { label: 'Attention', value: String(overlay.ctx.header.attentionCount) },
            { label: 'Sleeping', value: String(overlay.ctx.header.sleepingCount) },
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
            const title =
              project.title !== undefined && project.title.length > 0
                ? project.title
                : project.projectId;
            return {
              key: project.projectId,
              label: title,
              detail: `${project.path ?? ''} · ${project.sessionCount ?? 0} session(s)`,
              onPress: () => void restoreRecentProject(overlay.machine, project.projectId, title),
            };
          })}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'logs' ? <LogsSheet visible onClose={() => setOverlay(NONE)} /> : null}

      {overlay.kind === 'recovery' ? (
        <ActionSheet
          visible
          title={
            overlay.machine !== null
              ? machineDisplayLabel(overlay.machine)
              : StateCardCopy.noMachines.title
          }
          items={recoveryItems(overlay.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
    </SafeAreaView>
  );
}

