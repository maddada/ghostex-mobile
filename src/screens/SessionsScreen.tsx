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
  StyleSheet,
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
import { AGENT_ICONS } from '../assets/agentIcons.generated';
import { createdSessionId, runGhostexCli } from '../components/sessions/cli';
import { useCollapseStore } from '../components/sessions/collapseStore';
import ContextMenu, {
  type ContextMenuItem,
  type MenuAnchor,
} from '../components/sessions/ContextMenu';
import {
  buildDrawerList,
  drawerStatusLine,
  type DrawerBlock,
  type ProjectCardBlock,
} from '../components/sessions/drawerModel';
import {
  ClockGlyph,
  CopyGlyph,
  ExitGlyph,
  GitForkGlyph,
  MachinesGlyph,
  PaletteGlyph,
  PencilGlyph,
  PinGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  SettingsGlyph,
  SleepGlyph,
  TagGlyph,
  TerminalGlyph,
  TrashGlyph,
  WorldGlyph,
  XGlyph,
} from '../components/sessions/icons';
import { useLauncherStore, lastActionKey } from '../components/sessions/launcherStore';
import {
  CollectionHeaderRow,
  collectionPanelBackground,
  collectionPanelBorder,
  ds,
  GroupHeaderRow,
  MachineHeaderRow,
  PROJECT_CARD_BACKGROUND,
  PROJECT_CARD_BORDER,
  ProjectEmptyRow,
  ProjectHeaderRow,
  SectionLabelRow,
  SessionListToggleRow,
  SIDEBAR_BACKGROUND,
} from '../components/sessions/rows';
import SessionRow from '../components/sessions/SessionRow';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import {
  addProjectCommand,
  attachCommand,
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createAgentCommand,
  createChatCommand,
  createSessionCommand,
  delayedSendCommand,
  forkSessionCommand,
  killSessionCommand,
  loginShellCommand,
  moveProjectCommand,
  pinSessionCommand,
  reloadSessionCommand,
  removeProjectCommand,
  renameSessionCommand,
  restoreRecentProjectCommand,
  runActionCommand,
  shellQuote,
  sleepSessionCommand,
  tagSessionCommand,
  updateProjectCollectionsCommand,
  wakeSessionCommand,
} from '../commands/ghostexCli';
import {
  COLLECTION_COLOR_OPTIONS,
  collectionIdForProject,
  stateWithCollectionColor,
  stateWithCollectionTitle,
  stateWithNewCollection,
  stateWithoutCollection,
  stateWithoutProject,
  stateWithProjectInCollection,
} from '../contract/collectionsState';
import {
  CHATS_PROJECT_KEY,
  projectKeyForSession,
  type CollectionHeaderItem,
  type DrawerItem,
  type GroupHeaderItem,
  type ProjectHeaderItem,
  type SessionItem,
} from '../contract/grouping';
import { SESSION_TAG_SECTIONS } from '../contract/sessionTags';
import {
  agentIconTint,
  displayStatus,
  formatLastActive,
  resolveAgentIconId,
  type GhostexAgentLauncher,
  type GhostexQuickAction,
  type GhostexSession,
} from '../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy, StateCardCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, selectedMachine, useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, GhostexRadii } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

type SessionContext = { machine: MachineRecord; item: SessionItem };
type ProjectContext = { machine: MachineRecord; header: ProjectHeaderItem };

type CollectionContext = { machine: MachineRecord; header: CollectionHeaderItem };
type GroupContext = { machine: MachineRecord; item: GroupHeaderItem };

type Overlay =
  | { kind: 'none' }
  | { kind: 'sessionMenu'; ctx: SessionContext; anchor: MenuAnchor; view: 'root' | 'tags' }
  | { kind: 'sessionDetails'; ctx: SessionContext }
  | { kind: 'rename'; ctx: SessionContext; error: string | null }
  | { kind: 'delayedSend'; ctx: SessionContext }
  | { kind: 'killConfirm'; ctx: SessionContext }
  | { kind: 'copyText'; title: string; text: string }
  | { kind: 'projectMenu'; ctx: ProjectContext; anchor: MenuAnchor; view: 'root' | 'collections' }
  | { kind: 'projectKillConfirm'; ctx: ProjectContext }
  | { kind: 'projectDetails'; ctx: ProjectContext }
  | { kind: 'agentMenu'; ctx: ProjectContext; anchor: MenuAnchor }
  | { kind: 'actionsMenu'; ctx: ProjectContext; anchor: MenuAnchor }
  | { kind: 'collectionMenu'; ctx: CollectionContext; anchor: MenuAnchor; view: 'root' | 'colors' }
  | { kind: 'collectionRename'; ctx: CollectionContext; error: string | null }
  | { kind: 'groupMenu'; ctx: GroupContext; anchor: MenuAnchor }
  | { kind: 'sectionMenu'; machine: MachineRecord; section: 'quick' | 'projects'; anchor: MenuAnchor }
  | { kind: 'addProject'; machine: MachineRecord; error: string | null }
  | {
      kind: 'confirmAction';
      title: string;
      body: string;
      confirmLabel: string;
      run: () => void;
    }
  | { kind: 'recentProjects'; machine: MachineRecord }
  | { kind: 'recovery'; machine: MachineRecord | null }
  | { kind: 'logs' };

const NONE: Overlay = { kind: 'none' };

/** `ssh -tt [-p port] user@host '<login-shell attach command>'` (§2 row 7). */
function attachSshCommand(machine: MachineRecord, session: GhostexSession): string {
  const portFlag = machine.port === 22 ? '' : ` -p ${machine.port}`;
  const remote = loginShellCommand(
    attachCommand(session.sessionId, session.projectId.length > 0 ? session.projectId : undefined),
  );
  return `ssh -tt${portFlag} ${machine.username}@${machine.host} ${shellQuote(remote)}`;
}

function sessionTitle(session: GhostexSession): string {
  return session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
}

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

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  const [progress, setProgress] = useState<string | null>(null);
  const [statusOverride, setStatusOverride] = useState<string | null>(null);
  const [tailscaleConnected, setTailscaleConnected] = useState(false);
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
      options?: { closeWarmSessionId?: string },
    ): Promise<void> => {
      setOverlay(NONE);
      try {
        if (options?.closeWarmSessionId !== undefined) {
          await useTerminalStore.getState().closeWarmSessionFor(target.id, options.closeWarmSessionId);
        }
        await runGhostexCli(target, command);
        await refreshMachine(target);
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
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
      );
    },
    [runSessionCommand],
  );

  const runQuickAction = useCallback(
    (target: MachineRecord, projectId: string, projectTitle: string, action: GhostexQuickAction): void => {
      const name = action.name !== undefined && action.name.length > 0 ? action.name : action.actionType;
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
      setOverlay(NONE);
      const sessions = sessionsForProject(ctx.machine, ctx.header);
      try {
        for (const session of sessions) {
          const projectId = session.projectId.length > 0 ? session.projectId : undefined;
          if (action === 'sleep' || action === 'kill') {
            await useTerminalStore.getState().closeWarmSessionFor(ctx.machine.id, session.sessionId);
          }
          const command =
            action === 'wake'
              ? wakeSessionCommand(session.sessionId, projectId)
              : action === 'sleep'
                ? sleepSessionCommand(session.sessionId, projectId)
                : killSessionCommand(session.sessionId, projectId);
          await runGhostexCli(ctx.machine, command);
        }
        await refreshMachine(ctx.machine);
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, sessionsForProject, setTransientStatus],
  );

  // -------------------------------------------------------------------------
  // Menus.
  // -------------------------------------------------------------------------

  // Desktop-parity context menus ---------------------------------------------

  const summaryFor = (machineId: string) =>
    useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary ?? null;

  const isBrowserSession = (session: GhostexSession): boolean =>
    session.kind === 'browser' || session.surface === 'browser';

  /** Sleepable-now sessions (awake, not working/attention) — "inactive". */
  const isInactiveAwake = (session: GhostexSession): boolean => {
    const status = displayStatus(session);
    return (
      !session.isSleeping &&
      status !== 'sleep' &&
      status !== 'sleeping' &&
      status !== 'working' &&
      status !== 'attention'
    );
  };

  const isSleepingSession = (session: GhostexSession): boolean => {
    const status = displayStatus(session);
    return session.isSleeping || status === 'sleep' || status === 'sleeping';
  };

  /** Run one command per session, then refresh (bulk menu actions). */
  const runBulkSessionCommands = useCallback(
    async (target: MachineRecord, commands: string[]): Promise<void> => {
      setOverlay(NONE);
      try {
        for (const command of commands) {
          await runGhostexCli(target, command);
        }
        await refreshMachine(target);
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
  );

  /** Write the FULL collections state back through the CLI, then refresh. */
  const runCollectionsUpdate = useCallback(
    (target: MachineRecord, state: unknown): void => {
      void runSessionCommand(target, updateProjectCollectionsCommand(state));
    },
    [runSessionCommand],
  );

  const collectionMemberSessions = (ctx: CollectionContext): GhostexSession[] => {
    const summary = summaryFor(ctx.machine.id);
    if (summary === null) return [];
    const collection = summary.projectCollections.find(
      (entry) => entry.collectionId === ctx.header.collectionId,
    );
    if (collection === undefined) return [];
    return summary.sessions.filter((session) => collection.projectIds.includes(session.projectId));
  };

  const groupMemberSessions = (ctx: GroupContext): GhostexSession[] => {
    const summary = summaryFor(ctx.machine.id);
    if (summary === null) return [];
    const groups = summary.workspaceGroups?.projects?.[ctx.item.projectId]?.groups ?? [];
    const group = groups.find((entry) => entry.groupId === ctx.item.groupId);
    const memberIds = new Set(group?.sessionIds ?? []);
    return summary.sessions.filter((session) => memberIds.has(session.sessionId));
  };

  const menuIconColor = GhostexPalette.FOREGROUND;
  const dangerIconColor = '#FF7B72';
  const FORK_AGENT_ICONS = ['codex', 'claude', 'pi'];

  /** SESSION context menu root — desktop sortable-session-card menu order. */
  const sessionMenuRootItems = (ctx: SessionContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const { session } = ctx.item;
    const projectId = session.projectId.length > 0 ? session.projectId : undefined;
    const browser = isBrowserSession(session);
    const sleeping = isSleepingSession(session);
    const agentKey = session.agentIcon.length > 0 ? session.agentIcon : session.agent;
    const items: ContextMenuItem[] = [];

    if (!browser) {
      items.push({
        kind: 'item',
        key: 'rename',
        label: 'Rename',
        icon: <PencilGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'rename', ctx, error: null }),
      });
    }
    items.push({
      kind: 'item',
      key: 'pin',
      label: session.isPinned ? 'Unpin' : 'Pin',
      icon: <PinGlyph size={14} color={menuIconColor} />,
      onPress: () =>
        void runSessionCommand(ctx.machine, pinSessionCommand(session.sessionId, !session.isPinned)),
    });
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'tag',
        label: 'Tag as',
        icon: <TagGlyph size={14} color={menuIconColor} />,
        submenu: true,
        onPress: () => setOverlay({ kind: 'sessionMenu', ctx, anchor, view: 'tags' }),
      });
    }
    items.push({
      kind: 'item',
      key: 'sleep',
      label: sleeping ? 'Wake' : 'Sleep',
      icon: sleeping ? (
        <PlayGlyph size={14} color={menuIconColor} />
      ) : (
        <SleepGlyph size={14} color={menuIconColor} />
      ),
      onPress: () =>
        sleeping
          ? void runSessionCommand(ctx.machine, wakeSessionCommand(session.sessionId, projectId))
          : void runSessionCommand(ctx.machine, sleepSessionCommand(session.sessionId, projectId), {
              closeWarmSessionId: session.sessionId,
            }),
    });

    items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'attach',
      label: 'Attach',
      icon: <TerminalGlyph size={14} color={menuIconColor} />,
      onPress: () => void attach(ctx.machine, session),
    });
    items.push({
      kind: 'item',
      key: 'copy-attach',
      label: 'Copy attach command',
      icon: <CopyGlyph size={14} color={menuIconColor} />,
      onPress: () =>
        setOverlay({
          kind: 'copyText',
          title: 'Copy attach command',
          text: attachSshCommand(ctx.machine, session),
        }),
    });
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'delayed-send',
        label: 'Delayed Send',
        icon: <ClockGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'delayedSend', ctx }),
      });
      items.push({
        kind: 'item',
        key: 'close-after-done',
        label: 'Close After Done',
        icon: <ClockGlyph size={14} color={menuIconColor} />,
        selected: session.closeAfterDone,
        onPress: () =>
          void runSessionCommand(ctx.machine, closeAfterDoneCommand(session.sessionId)),
      });
    }
    if (FORK_AGENT_ICONS.includes(agentKey)) {
      items.push({
        kind: 'item',
        key: 'fork',
        label: 'Fork',
        icon: <GitForkGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runCreationFlow(
            ctx.machine,
            forkSessionCommand(session.sessionId),
            ProgressCopy.creatingTerminal(ctx.item.projectTitle),
          ),
      });
    }
    if (!browser) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runSessionCommand(ctx.machine, reloadSessionCommand(session.sessionId)),
      });
    }
    items.push({
      kind: 'item',
      key: 'details',
      label: 'Details',
      onPress: () => setOverlay({ kind: 'sessionDetails', ctx }),
    });

    items.push({ kind: 'separator', key: 'sep-2' });
    items.push({
      kind: 'item',
      key: 'close',
      label: 'Close',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      onPress: () => setOverlay({ kind: 'killConfirm', ctx }),
    });
    return items;
  };

  /** SESSION "Tag as" submenu — grouped Priority/Progress/Type radio rows. */
  const sessionTagItems = (ctx: SessionContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const { session } = ctx.item;
    const current = session.sessionTag;
    const applyTag = (value: string): void =>
      void runSessionCommand(ctx.machine, tagSessionCommand(session.sessionId, value));
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: '‹ Back',
        onPress: () => setOverlay({ kind: 'sessionMenu', ctx, anchor, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
    ];
    if (current.length > 0) {
      items.push({
        kind: 'item',
        key: 'clear',
        label: 'Clear tag',
        icon: <XGlyph size={14} color={menuIconColor} />,
        onPress: () => applyTag('none'),
      });
    }
    SESSION_TAG_SECTIONS.forEach((section, index) => {
      if (index > 0 || current.length > 0) {
        items.push({ kind: 'separator', key: `sep-${section.label}` });
      }
      for (const option of section.options) {
        items.push({
          kind: 'item',
          key: option.value,
          label: option.label,
          icon: <TagGlyph size={14} color={option.color} />,
          selected: current === option.value,
          onPress: () => applyTag(current === option.value ? 'none' : option.value),
        });
      }
    });
    return items;
  };

  /** PROJECT context menu root — desktop project-header menu order + extras. */
  const projectMenuRootItems = (ctx: ProjectContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const { header } = ctx;
    const orderedHeaders: ProjectHeaderItem[] = [];
    for (const block of entries) {
      if (block.machineId !== ctx.machine.id) continue;
      if (block.kind === 'project') orderedHeaders.push(block.card.header);
      else if (block.kind === 'collection') {
        for (const projectBlock of block.projects) orderedHeaders.push(projectBlock.header);
      }
    }
    const index = orderedHeaders.findIndex((entry) => entry.projectKey === header.projectKey);
    const canMove = header.projectId.length > 0;
    const sessions = sessionsForProject(ctx.machine, header);
    const inactive = sessions.filter(isInactiveAwake);
    const sleeping = sessions.filter(isSleepingSession);
    const allSleeping = sessions.length > 0 && sleeping.length === sessions.length;
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));

    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'copy-path',
        label: 'Copy Path',
        icon: <CopyGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          setOverlay({ kind: 'copyText', title: 'Copy project path', text: header.projectPath }),
      },
    ];
    if (header.projectId.length > 0) {
      items.push({
        kind: 'item',
        key: 'add-to-group',
        label: 'Add to project group',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        submenu: true,
        onPress: () => setOverlay({ kind: 'projectMenu', ctx, anchor, view: 'collections' }),
      });
    }
    items.push({ kind: 'separator', key: 'sep-1' });
    if (allSleeping) {
      items.push({
        kind: 'item',
        key: 'wake',
        label: 'Wake',
        icon: <PlayGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            sleeping.map((session) =>
              wakeSessionCommand(
                session.sessionId,
                session.projectId.length > 0 ? session.projectId : undefined,
              ),
            ),
          ),
      });
    } else {
      items.push({
        kind: 'item',
        key: 'sleep-inactive',
        label: 'Sleep Inactive',
        icon: <SleepGlyph size={14} color={menuIconColor} />,
        disabled: inactive.length === 0,
        onPress: () => {
          for (const session of inactive) {
            void useTerminalStore.getState().closeWarmSessionFor(ctx.machine.id, session.sessionId);
          }
          void runBulkSessionCommands(
            ctx.machine,
            inactive.map((session) =>
              sleepSessionCommand(
                session.sessionId,
                session.projectId.length > 0 ? session.projectId : undefined,
              ),
            ),
          );
        },
      });
    }
    items.push({
      kind: 'item',
      key: 'full-reload',
      label: 'Full reload',
      icon: <RefreshGlyph size={14} color={menuIconColor} />,
      disabled: nonBrowser.length === 0,
      onPress: () =>
        void runBulkSessionCommands(
          ctx.machine,
          nonBrowser.map((session) => reloadSessionCommand(session.sessionId)),
        ),
    });
    items.push({ kind: 'separator', key: 'sep-2' });
    items.push({
      kind: 'item',
      key: 'close-inactive',
      label: 'Close inactive',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: inactive.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close inactive sessions?',
          body: `This stops ${inactive.length} inactive session(s) in ${header.title} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => {
            for (const session of inactive) {
              void useTerminalStore
                .getState()
                .closeWarmSessionFor(ctx.machine.id, session.sessionId);
            }
            void runBulkSessionCommands(
              ctx.machine,
              inactive.map((session) =>
                killSessionCommand(
                  session.sessionId,
                  session.projectId.length > 0 ? session.projectId : undefined,
                ),
              ),
            );
          },
        }),
    });
    items.push({
      kind: 'item',
      key: 'close-project',
      label: 'Close Project',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: header.projectId.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close project?',
          body: `This parks ${header.title} (and its ${sessions.length} session(s)) into Recent Projects on the Mac.`,
          confirmLabel: 'Close Project',
          run: () => void runSessionCommand(ctx.machine, removeProjectCommand(header.projectId)),
        }),
    });
    items.push({ kind: 'separator', key: 'sep-3' });
    items.push({
      kind: 'item',
      key: 'move-up',
      label: 'Move project up',
      disabled: !canMove || index <= 0,
      onPress: () => void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'up')),
    });
    items.push({
      kind: 'item',
      key: 'move-down',
      label: 'Move project down',
      disabled: !canMove || index < 0 || index >= orderedHeaders.length - 1,
      onPress: () =>
        void runSessionCommand(ctx.machine, moveProjectCommand(header.projectId, 'down')),
    });
    items.push({
      kind: 'item',
      key: 'refresh',
      label: 'Refresh sessions',
      icon: <RefreshGlyph size={14} color={menuIconColor} />,
      onPress: () => {
        setOverlay(NONE);
        void refreshMachine(ctx.machine);
      },
    });
    items.push({
      kind: 'item',
      key: 'details',
      label: 'Details',
      onPress: () => setOverlay({ kind: 'projectDetails', ctx }),
    });
    return items;
  };

  /** PROJECT "Add to project group" submenu — desktop collections subview. */
  const projectCollectionsItems = (ctx: ProjectContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const projectId = ctx.header.projectId;
    const currentId = collectionIdForProject(state, projectId);
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: '‹ Back',
        onPress: () => setOverlay({ kind: 'projectMenu', ctx, anchor, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
      {
        kind: 'item',
        key: 'new-group',
        label: 'New project group',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        onPress: () => runCollectionsUpdate(ctx.machine, stateWithNewCollection(state, projectId)),
      },
    ];
    for (const collection of summary?.projectCollections ?? []) {
      items.push({
        kind: 'item',
        key: `col:${collection.collectionId}`,
        label: collection.title,
        swatch: collection.color,
        selected: collection.collectionId === currentId,
        onPress: () =>
          runCollectionsUpdate(
            ctx.machine,
            stateWithProjectInCollection(state, collection.collectionId, projectId),
          ),
      });
    }
    if (currentId !== null) {
      items.push({ kind: 'separator', key: 'sep-remove' });
      items.push({
        kind: 'item',
        key: 'remove',
        label: 'Remove from group',
        icon: <XGlyph size={14} color={menuIconColor} />,
        onPress: () => runCollectionsUpdate(ctx.machine, stateWithoutProject(state, projectId)),
      });
    }
    return items;
  };

  /** COLLECTION header menu root — desktop project-collection menu. */
  const collectionMenuRootItems = (ctx: CollectionContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const sessions = collectionMemberSessions(ctx);
    const awake = sessions.filter((session) => !isSleepingSession(session));
    const sleeping = sessions.filter(isSleepingSession);
    const unpinned = sessions.filter((session) => !session.isPinned);
    const pinned = sessions.filter((session) => session.isPinned);
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));
    const items: ContextMenuItem[] = [];

    if (awake.length > 0) {
      items.push({
        kind: 'item',
        key: 'sleep',
        label: 'Sleep sessions',
        icon: <SleepGlyph size={14} color={menuIconColor} />,
        onPress: () => {
          for (const session of awake) {
            void useTerminalStore.getState().closeWarmSessionFor(ctx.machine.id, session.sessionId);
          }
          void runBulkSessionCommands(
            ctx.machine,
            awake.map((session) =>
              sleepSessionCommand(
                session.sessionId,
                session.projectId.length > 0 ? session.projectId : undefined,
              ),
            ),
          );
        },
      });
    }
    if (sleeping.length > 0) {
      items.push({
        kind: 'item',
        key: 'wake',
        label: 'Wake sessions',
        icon: <PlayGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            sleeping.map((session) =>
              wakeSessionCommand(
                session.sessionId,
                session.projectId.length > 0 ? session.projectId : undefined,
              ),
            ),
          ),
      });
    }
    if (unpinned.length > 0) {
      items.push({
        kind: 'item',
        key: 'pin',
        label: 'Pin sessions',
        icon: <PinGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            unpinned.map((session) => pinSessionCommand(session.sessionId, true)),
          ),
      });
    }
    if (pinned.length > 0) {
      items.push({
        kind: 'item',
        key: 'unpin',
        label: 'Unpin sessions',
        icon: <PinGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            pinned.map((session) => pinSessionCommand(session.sessionId, false)),
          ),
      });
    }
    if (nonBrowser.length > 0) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload sessions',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            nonBrowser.map((session) => reloadSessionCommand(session.sessionId)),
          ),
      });
    }
    if (items.length > 0) items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'rename',
      label: 'Rename group',
      icon: <PencilGlyph size={14} color={menuIconColor} />,
      onPress: () => setOverlay({ kind: 'collectionRename', ctx, error: null }),
    });
    items.push({
      kind: 'item',
      key: 'color',
      label: 'Group color',
      icon: <PaletteGlyph size={14} color={menuIconColor} />,
      submenu: true,
      onPress: () => setOverlay({ kind: 'collectionMenu', ctx, anchor, view: 'colors' }),
    });
    items.push({
      kind: 'item',
      key: 'delete',
      label: 'Delete group',
      icon: <TrashGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Delete group?',
          body: `This removes the ${ctx.header.title} group. Its projects stay in the sidebar.`,
          confirmLabel: 'Delete',
          run: () =>
            runCollectionsUpdate(ctx.machine, stateWithoutCollection(state, ctx.header.collectionId)),
        }),
    });
    items.push({
      kind: 'item',
      key: 'close-all',
      label: 'Close all sessions',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: sessions.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close all sessions?',
          body: `This stops ${sessions.length} session(s) in ${ctx.header.title} on the connected machine.`,
          confirmLabel: 'Close',
          run: () => {
            for (const session of sessions) {
              void useTerminalStore
                .getState()
                .closeWarmSessionFor(ctx.machine.id, session.sessionId);
            }
            void runBulkSessionCommands(
              ctx.machine,
              sessions.map((session) =>
                killSessionCommand(
                  session.sessionId,
                  session.projectId.length > 0 ? session.projectId : undefined,
                ),
              ),
            );
          },
        }),
    });
    return items;
  };

  /** COLLECTION "Group color" submenu — desktop 9-color swatch radio list. */
  const collectionColorItems = (ctx: CollectionContext, anchor: MenuAnchor): ContextMenuItem[] => {
    const summary = summaryFor(ctx.machine.id);
    const state = summary?.projectCollectionsState ?? null;
    const items: ContextMenuItem[] = [
      {
        kind: 'item',
        key: 'back',
        label: '‹ Back',
        onPress: () => setOverlay({ kind: 'collectionMenu', ctx, anchor, view: 'root' }),
      },
      { kind: 'separator', key: 'sep-back' },
    ];
    for (const option of COLLECTION_COLOR_OPTIONS) {
      items.push({
        kind: 'item',
        key: option.value,
        label: option.label,
        swatch: option.value,
        selected: ctx.header.color === option.value,
        onPress: () =>
          runCollectionsUpdate(
            ctx.machine,
            stateWithCollectionColor(state, ctx.header.collectionId, option.value),
          ),
      });
    }
    return items;
  };

  /** Named session-group header menu — desktop group-head menu. */
  const groupMenuItems = (ctx: GroupContext): ContextMenuItem[] => {
    const sessions = groupMemberSessions(ctx);
    const sleeping = sessions.filter(isSleepingSession);
    const allSleeping = sessions.length > 0 && sleeping.length === sessions.length;
    const nonBrowser = sessions.filter((session) => !isBrowserSession(session));
    const items: ContextMenuItem[] = [];
    if (nonBrowser.length > 0) {
      items.push({
        kind: 'item',
        key: 'full-reload',
        label: 'Full reload',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () =>
          void runBulkSessionCommands(
            ctx.machine,
            nonBrowser.map((session) => reloadSessionCommand(session.sessionId)),
          ),
      });
    }
    items.push({
      kind: 'item',
      key: 'sleep',
      label: allSleeping ? 'Wake' : 'Sleep',
      icon: allSleeping ? (
        <PlayGlyph size={14} color={menuIconColor} />
      ) : (
        <SleepGlyph size={14} color={menuIconColor} />
      ),
      disabled: sessions.length === 0,
      onPress: () => {
        const targets = allSleeping ? sleeping : sessions.filter((s) => !isSleepingSession(s));
        if (!allSleeping) {
          for (const session of targets) {
            void useTerminalStore.getState().closeWarmSessionFor(ctx.machine.id, session.sessionId);
          }
        }
        void runBulkSessionCommands(
          ctx.machine,
          targets.map((session) =>
            allSleeping
              ? wakeSessionCommand(
                  session.sessionId,
                  session.projectId.length > 0 ? session.projectId : undefined,
                )
              : sleepSessionCommand(
                  session.sessionId,
                  session.projectId.length > 0 ? session.projectId : undefined,
                ),
          ),
        );
      },
    });
    items.push({ kind: 'separator', key: 'sep-1' });
    items.push({
      kind: 'item',
      key: 'close',
      label: 'Close',
      icon: <XGlyph size={14} color={dangerIconColor} />,
      destructive: true,
      disabled: sessions.length === 0,
      onPress: () =>
        setOverlay({
          kind: 'confirmAction',
          title: 'Close group?',
          body: `This stops ${sessions.length} session(s) in ${ctx.item.title} on the connected machine.`,
          confirmLabel: 'Close Group',
          run: () => {
            for (const session of sessions) {
              void useTerminalStore
                .getState()
                .closeWarmSessionFor(ctx.machine.id, session.sessionId);
            }
            void runBulkSessionCommands(
              ctx.machine,
              sessions.map((session) =>
                killSessionCommand(
                  session.sessionId,
                  session.projectId.length > 0 ? session.projectId : undefined,
                ),
              ),
            );
          },
        }),
    });
    return items;
  };

  /** Quick/Projects section-label menus — desktop section hover actions. */
  const sectionMenuItems = (
    target: MachineRecord,
    section: 'quick' | 'projects',
  ): ContextMenuItem[] => {
    if (section === 'quick') {
      return [
        {
          kind: 'item',
          key: 'new-terminal',
          label: 'Quick Terminal',
          icon: <TerminalGlyph size={14} color={menuIconColor} />,
          onPress: () =>
            void runCreationFlow(target, createChatCommand(), ProgressCopy.creatingQuickSession),
        },
      ];
    }
    const summary = summaryFor(target.id);
    const projectKeys: string[] = [];
    for (const project of summary?.projects ?? []) {
      if (project.isChat !== true) projectKeys.push(`id:${project.projectId}`);
    }
    const collectionIds = (summary?.projectCollections ?? []).map((entry) => entry.collectionId);
    return [
      {
        kind: 'item',
        key: 'add-project',
        label: 'Add Project',
        icon: <PlusGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'addProject', machine: target, error: null }),
      },
      {
        kind: 'item',
        key: 'recent',
        label: 'Recent Projects',
        icon: <RefreshGlyph size={14} color={menuIconColor} />,
        onPress: () => setOverlay({ kind: 'recentProjects', machine: target }),
      },
      { kind: 'separator', key: 'sep-1' },
      {
        kind: 'item',
        key: 'collapse-all',
        label: 'Collapse All',
        onPress: () => {
          setOverlay(NONE);
          collapse.collapseAllProjects(target.id);
        },
      },
      {
        kind: 'item',
        key: 'expand-all',
        label: 'Expand All',
        onPress: () => {
          setOverlay(NONE);
          collapse.expandAllProjects(target.id, projectKeys, collectionIds);
        },
      },
    ];
  };

  // Desktop agent split-button + actions button menus -----------------------

  const resolvePrimaryAgent = useCallback(
    (agents: GhostexAgentLauncher[]): GhostexAgentLauncher | null => {
      if (agents.length === 0) return null;
      return agents.find((agent) => agent.agentId === primaryAgentId) ?? agents[0];
    },
    [primaryAgentId],
  );

  const launchAgent = useCallback(
    (target: MachineRecord, header: ProjectHeaderItem, agent: GhostexAgentLauncher): void => {
      if (header.projectId.length === 0) {
        setTransientStatus(ProgressCopy.noStableProjectId);
        return;
      }
      const agentName = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      void runCreationFlow(
        target,
        createAgentCommand(agent.agentId, header.projectId),
        ProgressCopy.startingAgent(agentName, header.title),
      );
    },
    [runCreationFlow, setTransientStatus],
  );

  /** Agent menu (desktop .group-agent-menu): brand icon + name + check. */
  const agentMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selected = resolvePrimaryAgent(ctx.header.agents);
    return ctx.header.agents.map((agent) => {
      const name = agent.name !== undefined && agent.name.length > 0 ? agent.name : agent.agentId;
      const iconId = resolveAgentIconId(agent.icon, name);
      const Icon = AGENT_ICONS[iconId] ?? AGENT_ICONS.terminal;
      return {
        kind: 'item' as const,
        key: agent.agentId,
        label: name,
        icon: <Icon size={14} color={agentIconTint(iconId)} />,
        selected: selected !== null && selected.agentId === agent.agentId,
        onPress: () => {
          setOverlay(NONE);
          useLauncherStore.getState().setPrimaryAgent(agent.agentId);
          launchAgent(ctx.machine, ctx.header, agent);
        },
      };
    });
  };

  /** Actions menu: one row per project quick action, check on the last run. */
  const actionsMenuItems = (ctx: ProjectContext): ContextMenuItem[] => {
    const selectedCommandId =
      lastActionByProject[lastActionKey(ctx.machine.id, ctx.header.projectId)] ?? '';
    return ctx.header.quickActions.map((action, index) => {
      const name =
        action.name !== undefined && action.name.length > 0 ? action.name : action.actionType;
      const commandId = action.commandId ?? '';
      const iconId = resolveAgentIconId(
        action.icon,
        action.actionType === 'browser' ? 'browser' : name,
      );
      const Icon = AGENT_ICONS[iconId];
      return {
        kind: 'item' as const,
        key: commandId.length > 0 ? commandId : `action-${index}`,
        label: name,
        icon:
          Icon !== undefined ? (
            <Icon size={14} color={agentIconTint(iconId)} />
          ) : (
            <WorldGlyph size={14} color={agentIconTint('browser')} />
          ),
        selected: commandId.length > 0 && commandId === selectedCommandId,
        onPress: () => {
          setOverlay(NONE);
          if (commandId.length > 0) {
            useLauncherStore.getState().setLastAction(ctx.machine.id, ctx.header.projectId, commandId);
          }
          runQuickAction(ctx.machine, ctx.header.projectId, ctx.header.title, action);
        },
      };
    });
  };

  const recoveryItems = (target: MachineRecord | null): ActionSheetItem[] => [
    {
      key: 'retry',
      label: 'Retry connection',
      onPress: () => {
        setOverlay(NONE);
        if (target !== null) void refreshMachine(target);
        else void refreshAll();
      },
    },
    {
      key: 'tailscale',
      label: 'Open Tailscale',
      onPress: () => {
        setOverlay(NONE);
        void openTailscaleOrDownload();
      },
    },
    {
      key: 'setup',
      label: 'Setup',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
    {
      key: 'add',
      label: 'Add SSH machine',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('MachineForm');
      },
    },
    {
      key: 'manage',
      label: 'Manage machines',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
    {
      key: 'tutorial',
      label: 'Tutorial',
      onPress: () => {
        setOverlay(NONE);
        navigation.navigate('Machines');
      },
    },
  ];

  // -------------------------------------------------------------------------
  // Rendering.
  // -------------------------------------------------------------------------

  /** Rows nested inside a project card (sessions, groups, empty, Show more). */
  const renderChildItem = (
    target: MachineRecord | null,
    machineId: string,
    child: DrawerItem,
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
            onMenu={(anchor) => {
              if (target === null) return;
              setOverlay({ kind: 'groupMenu', ctx: { machine: target, item: child }, anchor });
            }}
          />
        );
      case 'SESSION': {
        const active = selectedSessionKey === attachSessionKey(machineId, child.session.sessionId);
        return (
          <SessionRow
            key={child.key}
            session={child.session}
            active={active}
            inCard
            onPress={() => {
              if (target !== null) void attach(target, child.session);
            }}
            onMenu={(anchor) => {
              if (target === null) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setOverlay({
                kind: 'sessionMenu',
                ctx: { machine: target, item: child },
                anchor,
                view: 'root',
              });
            }}
          />
        );
      }
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
  ): ReactElement => {
    const header = card.header;
    const primaryAgent = resolvePrimaryAgent(header.agents);
    const selectedActionId = lastActionByProject[lastActionKey(machineId, header.projectId)] ?? '';
    const selectedAction =
      header.quickActions.find((action) => (action.commandId ?? '') === selectedActionId) ??
      (header.quickActions.length > 0 ? header.quickActions[0] : null);
    return (
      <View
        key={`card:${header.key}`}
        style={[
          styles.projectCard,
          inCollection ? styles.projectCardInPanel : styles.projectCardTopLevel,
          !header.collapsed ? styles.projectCardExpanded : null,
        ]}
      >
        <ProjectHeaderRow
          title={header.title}
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
          onMenu={(anchor) => {
            if (target === null) return;
            setOverlay({ kind: 'projectMenu', ctx: { machine: target, header }, anchor, view: 'root' });
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
          onOpenAgentMenu={(anchor) => {
            if (target === null) return;
            setOverlay({ kind: 'agentMenu', ctx: { machine: target, header }, anchor });
          }}
          onOpenActionsMenu={(anchor) => {
            if (target === null) return;
            setOverlay({ kind: 'actionsMenu', ctx: { machine: target, header }, anchor });
          }}
          onCollapseSessionList={() => collapse.toggleSessionList(machineId, header.projectKey)}
        />
        {!header.collapsed && card.children.length > 0 ? (
          <View style={styles.cardSessions}>
            {card.children.map((child) => renderChildItem(target, machineId, child))}
          </View>
        ) : null}
      </View>
    );
  };

  const renderBlock = ({ item: block }: { item: DrawerBlock }) => {
    const target = machineById(block.machineId);
    if (block.kind === 'project') {
      return renderProjectCard(target, block.machineId, block.card, false);
    }
    if (block.kind === 'collection') {
      const header = block.header;
      return (
        <View
          style={[
            styles.collectionPanel,
            {
              backgroundColor: collectionPanelBackground(header.color),
              borderColor: collectionPanelBorder(header.color),
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
            onMenu={(anchor) => {
              if (target === null) return;
              setOverlay({
                kind: 'collectionMenu',
                ctx: { machine: target, header },
                anchor,
                view: 'root',
              });
            }}
          />
          {!header.collapsed && block.projects.length > 0 ? (
            <View style={styles.collectionProjects}>
              {block.projects.map((card) => renderProjectCard(target, block.machineId, card, true))}
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
            onPress={() => collapse.toggleMachine(item.machineId)}
          />
        );
      case 'SECTION_LABEL':
        return (
          <SectionLabelRow
            title={item.title}
            collapsed={item.collapsed}
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
            onMenu={(anchor) => {
              if (target === null) return;
              setOverlay({ kind: 'sectionMenu', machine: target, section: item.section, anchor });
            }}
          />
        );
      case 'PROJECT_EMPTY':
        return <ProjectEmptyRow text={item.text} quick />;
      case 'SESSION': {
        const active =
          selectedSessionKey === attachSessionKey(block.machineId, item.session.sessionId);
        return (
          <SessionRow
            session={item.session}
            active={active}
            inCard={false}
            onPress={() => {
              if (target !== null) void attach(target, item.session);
            }}
            onMenu={(anchor) => {
              if (target === null) return;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              setOverlay({
                kind: 'sessionMenu',
                ctx: { machine: target, item },
                anchor,
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
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Ghostex</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh"
          style={styles.headerButton}
          onPress={() => void fullReconnect()}
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={GhostexPalette.FOREGROUND} />
          ) : (
            <RefreshGlyph size={22} color={GhostexPalette.FOREGROUND} />
          )}
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Machines"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Machines')}
        >
          <MachinesGlyph size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <SettingsGlyph size={22} color={GhostexPalette.FOREGROUND} />
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
            <ExitGlyph size={22} color={GhostexPalette.FOREGROUND} />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.statusRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show logs"
          hitSlop={8}
          style={styles.statusPressable}
          onPress={() => setOverlay({ kind: 'logs' })}
        >
          <Text style={styles.statusLine} numberOfLines={1} ellipsizeMode="tail">
            {statusLine}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tailscale ${tailscaleConnected ? 'connected' : 'not connected'}`}
          hitSlop={8}
          style={styles.tailscaleIndicator}
          onPress={() => void openTailscaleOrDownload()}
        >
          <Text
            style={[
              styles.tailscaleIndicatorLabel,
              {
                color: tailscaleConnected
                  ? GhostexPalette.STATUS_CONNECTED
                  : GhostexPalette.STATUS_SLEEPING,
              },
            ]}
          >
            • Tailscale
          </Text>
        </Pressable>
      </View>
      {recentProjects.length > 0 && machine !== null ? (
        <Pressable
          accessibilityRole="button"
          style={styles.recentButton}
          onPress={() => setOverlay({ kind: 'recentProjects', machine })}
        >
          <Text style={styles.recentButtonLabel}>Recent Projects</Text>
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
          anchor={overlay.anchor}
          items={
            overlay.view === 'tags'
              ? sessionTagItems(overlay.ctx, overlay.anchor)
              : sessionMenuRootItems(overlay.ctx, overlay.anchor)
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
          visible
          sessionTitle={sessionTitle(overlay.ctx.item.session)}
          remainingLabel={overlay.ctx.item.session.delayedSendRemainingLabel}
          onConfirm={(delayMs) =>
            void runSessionCommand(
              overlay.ctx.machine,
              delayedSendCommand(overlay.ctx.item.session.sessionId, delayMs),
            )
          }
          onCancelTimer={() =>
            void runSessionCommand(
              overlay.ctx.machine,
              cancelDelayedSendCommand(overlay.ctx.item.session.sessionId),
            )
          }
          onCancel={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'killConfirm' ? (
        <ConfirmDialog
          visible
          title="Kill remote session?"
          body="This stops the selected Ghostex session on the connected machine."
          targetLine={`${overlay.ctx.item.session.alias} · ${sessionTitle(overlay.ctx.item.session)}`}
          confirmLabel="Kill"
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
              { closeWarmSessionId: overlay.ctx.item.session.sessionId },
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
          anchor={overlay.anchor}
          items={
            overlay.view === 'collections'
              ? projectCollectionsItems(overlay.ctx, overlay.anchor)
              : projectMenuRootItems(overlay.ctx, overlay.anchor)
          }
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'collectionMenu' ? (
        <ContextMenu
          visible
          anchor={overlay.anchor}
          items={
            overlay.view === 'colors'
              ? collectionColorItems(overlay.ctx, overlay.anchor)
              : collectionMenuRootItems(overlay.ctx, overlay.anchor)
          }
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'groupMenu' ? (
        <ContextMenu
          visible
          anchor={overlay.anchor}
          items={groupMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'sectionMenu' ? (
        <ContextMenu
          visible
          anchor={overlay.anchor}
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

      {overlay.kind === 'addProject' ? (
        <PromptDialog
          visible
          title="Add Project"
          body="Absolute path of the repository on the Mac."
          placeholder="/Users/you/dev/project"
          initialValue=""
          error={overlay.error}
          confirmLabel="Add"
          onSubmit={(value) => {
            const path = value.trim();
            if (path.length === 0) {
              setOverlay({ kind: 'addProject', machine: overlay.machine, error: 'Enter a path.' });
              return;
            }
            void runSessionCommand(overlay.machine, addProjectCommand(path));
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
          anchor={overlay.anchor}
          items={agentMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'actionsMenu' ? (
        <ContextMenu
          visible
          anchor={overlay.anchor}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SIDEBAR_BACKGROUND,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerButton: {
    width: 48,
    height: 48,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  statusPressable: {
    flex: 1,
    minWidth: 0,
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
  recentButton: {
    marginTop: 8,
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentButtonLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  list: {
    marginTop: 12,
  },
  listContent: {
    paddingBottom: 24,
  },
  longPressHint: {
    color: GhostexPalette.MUTED,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 12,
    opacity: 0.72,
  },
  tailscaleIndicator: {
    minHeight: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tailscaleIndicatorLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
  /** Desktop project card (hierarchy-panels.css .group[data-project-group]). */
  projectCard: {
    backgroundColor: PROJECT_CARD_BACKGROUND,
    borderWidth: 1,
    borderColor: PROJECT_CARD_BORDER,
    borderRadius: ds(5),
  },
  projectCardTopLevel: {
    marginLeft: ds(3),
    marginRight: ds(5),
    marginBottom: ds(5),
  },
  projectCardInPanel: {
    marginHorizontal: ds(3),
    marginBottom: ds(5),
  },
  projectCardExpanded: {
    marginBottom: ds(7),
  },
  /** Card session area (.group-sessions): 3dp inner inset. */
  cardSessions: {
    paddingHorizontal: ds(3),
    paddingBottom: ds(3),
  },
  /** Desktop collection panel (section.project-collection). */
  collectionPanel: {
    borderWidth: 1,
    borderRadius: ds(5),
    marginLeft: ds(3),
    marginRight: ds(5),
    marginBottom: ds(8),
  },
  /** Panel member area (.project-collection-projects). */
  collectionProjects: {
    paddingHorizontal: ds(3),
    paddingTop: ds(2),
    paddingBottom: ds(3),
  },
});
