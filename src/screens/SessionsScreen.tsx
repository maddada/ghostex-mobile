/**
 * Sessions drawer as the app's home page (docs/specs/sessions-drawer.md §§1-6):
 * header + status line + flat drawer list built from
 * buildDrawerItems, with session/project context menus, creation flows,
 * recovery sheet, and focus-scoped 5s inventory polling.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  Text,
  View,
  type ViewInstance,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { openTailscaleOrDownload } from '../app/tailscale';
import ActionSheet from '../components/common/ActionSheet';
import ConfirmDialog from '../components/common/ConfirmDialog';
import DetailsSheet from '../components/common/DetailsSheet';
import LogsSheet from '../components/common/LogsSheet';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import { measureInWindow } from '../components/common/measureInWindow';
import { bandRowFrame } from '../components/common/verticalBar/layout';
import {
  useContentTop,
  useHeaderPlacement,
  useLiveMenuAnchor,
  useRailButtons,
  useScrollToBarEdges,
  type RailButtons,
  type RailEntry,
} from '../components/common/verticalBar/VerticalBarArea';
import { useCollapseStore } from '../components/sessions/collapseStore';
import { useSessionListClock } from '../components/sessions/useSessionListClock';
import ContextMenu from '../components/sessions/ContextMenu';
import SessionLinksSheet from '../chat/native/SessionLinksSheet';
import { buildDrawerList, type DrawerBlock } from '../components/sessions/drawerModel';
import { drawerStatusLine } from '../components/sessions/drawerStatusLine';
import { MachinesGlyph, MenuGlyph, SearchGlyph, WorldGlyph } from '../components/sessions/icons';
import { VoiceButton } from '../voice/VoiceButton';
import { useVoiceStore, voiceActive } from '../voice/conversation';
import MachineTabs, {
  MACHINE_TAB_ADD,
  type MachineTabItem,
  type MachineTabStripItem,
} from '../components/sessions/MachineTabs';
import SpaceTabs from '../components/sessions/SpaceTabs';
import WorkspaceTile, { workspaceMenuItems } from '../components/sessions/WorkspaceTile';
import { agentChoicePlace, parseAgentChoiceScope, type AgentChoiceContext } from '../components/sessions/agentChoice';
import { useLauncherStore } from '../components/sessions/launcherStore';
import { expandedGroupBackground } from '../components/sessions/rows';
import SessionSearchSheet from '../components/sessions/SessionSearchSheet';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import NewCoordinatorSheet from './sessions-screen/NewCoordinatorSheet';
import CoordinatorDetailsSheet from './sessions-screen/CoordinatorDetailsSheet';
import WorkLinkPicker from './sessions-screen/work-link-picker';
import DrawerBlockView, { type DrawerBlockActions } from './sessions-screen/DrawerBlockView';
import ExportTranscriptSheet from '../components/terminal/ExportTranscriptSheet';
import { WarningTriangleIcon } from '../components/terminal/icons';
import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createSessionInGroupCommand,
  delayedSendCommand,
} from '../commands/ghostexCli';
import { stateWithCollectionTitle } from '../contract/collectionsState';
import { machineSessionCounts, tabStatusCounts } from '../contract/grouping';
import { coordinatorRowKey } from '../contract/coordinatorTree';
import { EMPTY_SIDEBAR_SPACES, type GhostexSession } from '../contract/mobileSummary';
import {
  DuoChromeCopy,
  ProgressCopy,
  RenameCopy,
  SessionCopy,
  SessionNoteCopy,
  SessionSearchCopy,
  StateCardCopy,
  StripCopy,
  WebPreviewCopy,
} from '../copy';
import MachineNotice from './sessions-screen/MachineNotice';
import { machineNotice } from '../components/sessions/machineNotice';
import type { FailureReasonCode } from '../inventory/client';
import { renameInitialTitle } from '../sessions/sessionCommands';
import { useInventoryStore } from '../inventory/store';
import {
  isMachineEnabled,
  machineDisplayLabel,
  selectedMachine,
  useMachinesStore,
  type MachineRecord,
} from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { resolveSelectedSpaceId, spaceRowItems, spaceSessionCounts } from '../spaces/spaceFilter';
import { useSpacesStore } from '../spaces/store';
import { revealSessionWorkspace, useWorkspacesStore } from '../workspaces/store';
import { restoreClosedSession } from '../sessions/closedSessions';
import { filterSummaryForWorkspace, resolveWorkspaceId, workspaceSwitchTarget } from '../workspaces/workspaceFilter';
import { useSettingsStore } from '../settings/store';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { GhostexPalette } from '../theme/palette';
import { resolveSidebarAppearance } from '../theme/sidebarAppearance';
import {
  closePutsSessionToSleep,
  closeSessionAction,
  NONE,
  sessionTitle,
  type Overlay,
} from './sessions-screen/session-actions';
import { SessionsBottomBar } from './sessions-screen/BottomBar';
import { SESSIONS_HEADER_HEIGHT, styles } from './sessions-screen/styles';
import { useSessionsScreenActions } from './sessions-screen/use-sessions-screen-actions';
import { useSessionsScreenMenus } from './sessions-screen/use-sessions-screen-menus';
import { makeSnoozeSession, useUnifiedList } from './sessions-screen/use-unified-list';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

export default function SessionsScreen({ navigation }: Props) {
  const headerPlacement = useHeaderPlacement();
  const isFocused = useIsFocused();
  const savedMachines = useMachinesStore((state) => state.machines);
  // Only machines the user keeps visible reach the tab strip, the drawer, and
  // the polling loop; hidden ones stay in Machines and are never connected to.
  const machines = useMemo(() => savedMachines.filter(isMachineEnabled), [savedMachines]);
  const machine = useMachinesStore((state) => selectedMachine(state));
  const selectMachine = useMachinesStore((state) => state.selectMachine);
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const refreshMachine = useInventoryStore((state) => state.refreshMachine);
  const refreshMachineFresh = useInventoryStore((state) => state.refreshMachineFresh);
  const retryMachine = useInventoryStore((state) => state.retryMachine);
  const refreshAll = useInventoryStore((state) => state.refreshAll);
  const startPolling = useInventoryStore((state) => state.startPolling);
  const stopPolling = useInventoryStore((state) => state.stopPolling);
  const selectedSpaceIdByMachine = useSpacesStore((state) => state.selectedSpaceIdByMachine);
  const selectSpace = useSpacesStore((state) => state.selectSpace);
  const selectedWorkspaceIdByMachine = useWorkspacesStore((state) => state.selectedWorkspaceIdByMachine);
  const recentWorkspaceIdsByMachine = useWorkspacesStore((state) => state.recentWorkspaceIdsByMachine);
  const selectWorkspace = useWorkspacesStore((state) => state.selectWorkspace);

  const collapse = useCollapseStore();
  const primaryAgentId = useLauncherStore((state) => state.primaryAgentId);
  const agentByProject = useLauncherStore((state) => state.agentByProject);
  const agentBySpace = useLauncherStore((state) => state.agentBySpace);
  const agentChoices = useMemo(
    () => ({ last: primaryAgentId, byProject: agentByProject, bySpace: agentBySpace }),
    [primaryAgentId, agentByProject, agentBySpace],
  );
  const lastActionByProject = useLauncherStore((state) => state.lastActionByProject);
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  const sidebarBackgroundContrast = useSettingsStore((state) => state.settings.sidebarBackgroundContrast);
  const sidebarBackgroundTint = useSettingsStore((state) => state.settings.sidebarBackgroundTint);
  const sidebarGroupsOpacityPercent = useSettingsStore((state) => state.settings.sidebarGroupsOpacityPercent);
  const sidebarAppearance = useMemo(
    () => resolveSidebarAppearance(sidebarBackgroundTint, sidebarBackgroundContrast),
    [sidebarBackgroundContrast, sidebarBackgroundTint],
  );
  const neutralExpandedGroupSurface = useMemo(
    () => expandedGroupBackground(sidebarAppearance.background),
    [sidebarAppearance.background],
  );

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  /*
   * Pull-to-refresh replaces the old header Refresh button, and owns its own
   * spinner state: the 5s poll flips the inventory's `refreshing` flag on every
   * tick, so driving the control from that would blink it forever.
   */
  const [pullRefreshing, setPullRefreshing] = useState(false);
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
      void useSpacesStore.getState().hydrate();
      void useWorkspacesStore.getState().hydrate();
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

  const selectedInventory = machine === null ? undefined : inventoriesByMachineId[machine.id];
  const machineWorkspaces = selectedInventory?.summary?.workspaces ?? null;
  /*
   * The workspace the machine's list shows (null while it has no workspaces, which is also every
   * computer with the Workspaces extension off): the stored pick, or the default workspace.
   */
  const selectedWorkspaceId =
    machineWorkspaces === null
      ? null
      : resolveWorkspaceId(machineWorkspaces, machine === null ? undefined : selectedWorkspaceIdByMachine[machine.id]);
  const selectedWorkspace =
    machineWorkspaces === null || selectedWorkspaceId === null
      ? null
      : (machineWorkspaces.workspaces[selectedWorkspaceId] ?? null);
  const workspaceSwitchTo =
    machineWorkspaces === null || selectedWorkspaceId === null
      ? null
      : workspaceSwitchTarget(
          machineWorkspaces,
          selectedWorkspaceId,
          machine === null ? [] : (recentWorkspaceIdsByMachine[machine.id] ?? []),
        );
  /** The machine's summary as the shown workspace sees it: its projects, sessions and Spaces. */
  const selectedSummary = useMemo(() => {
    const summary = selectedInventory?.summary ?? null;
    return summary === null || selectedWorkspaceId === null
      ? summary
      : filterSummaryForWorkspace(summary, selectedWorkspaceId);
  }, [selectedInventory?.summary, selectedWorkspaceId]);
  const machineSpaces = selectedSummary?.sidebarSpaces ?? EMPTY_SIDEBAR_SPACES;
  /*
   * The tile shows whenever the computer has Spaces, and on its own once there is more than one
   * workspace (desktop `native_sidebar_shows_workspace_tile`).
   */
  const showWorkspaceTile =
    selectedWorkspace !== null &&
    machineWorkspaces !== null &&
    ((selectedInventory?.summary?.sidebarSpaces.order.length ?? 0) > 0 || machineWorkspaces.order.length > 1);
  /*
   * A Space id is only ever resolved against the machine that owns it, so a
   * stored id from another machine — or one this daemon has since deleted —
   * falls back to the first Space, then to the built-in Other.
   */
  const selectedSpaceId = resolveSelectedSpaceId(
    machineSpaces,
    machine === null ? undefined : selectedSpaceIdByMachine[machine.id],
  );
  const spaceItems = useMemo(() => spaceRowItems(machineSpaces), [machineSpaces]);
  /**
   * Where a project's agent pick is remembered and which pick it starts (./agentChoice.ts): the
   * computer's "Remember the agent you pick", the project (a worktree counts as its parent) and the
   * Space the drawer shows it in, since the drawer lists only the selected Space's projects.
   */
  const agentChoiceContext = useCallback(
    (machineId: string, projectId: string): AgentChoiceContext => {
      const summary = machineId === machine?.id ? selectedSummary : (inventoriesByMachineId[machineId]?.summary ?? null);
      const spaces = machineId === machine?.id ? machineSpaces : (summary?.sidebarSpaces ?? EMPTY_SIDEBAR_SPACES);
      const spaceId =
        spaces.order.length === 0
          ? null
          : machineId === machine?.id
            ? selectedSpaceId
            : resolveSelectedSpaceId(spaces, selectedSpaceIdByMachine[machineId]);
      const worktreeParent =
        summary?.projects.find((project) => project.projectId === projectId)?.worktreeParentProjectId ?? '';
      return {
        scope: parseAgentChoiceScope(summary?.newSessionAgentScope),
        place: agentChoicePlace(machineId, projectId, worktreeParent, spaceId),
      };
    },
    [machine?.id, selectedSummary, inventoriesByMachineId, machineSpaces, selectedSpaceId, selectedSpaceIdByMachine],
  );
  const spaceCounts = useMemo(
    () =>
      spaceSessionCounts(
        selectedSummary,
        spaceItems.map((item) => item.spaceId),
      ),
    [selectedSummary, spaceItems],
  );

  const clockSessions = useMemo(
    () => Object.values(inventoriesByMachineId).flatMap((inventory) => inventory.summary?.sessions ?? []),
    [inventoriesByMachineId],
  );
  const sessionListNowMs = useSessionListClock(clockSessions);
  const entries = useMemo(
    () =>
      buildDrawerList({
        nowMs: sessionListNowMs,
        selectedSessionKey,
        machines,
        selectedMachineId: machine === null ? null : machine.id,
        inventoriesByMachineId,
        selectedSpaceId,
        selectedWorkspaceId,
        collapse: {
          expandedProjectsByMachine: collapse.expandedProjectsByMachine,
          expandedCollectionsByMachine: collapse.expandedCollectionsByMachine,
          expandedGroupsByMachine: collapse.expandedGroupsByMachine,
          collapsedSessionKindsByMachine: collapse.collapsedSessionKindsByMachine,
          collapsedCoordinatorsByMachine: collapse.collapsedCoordinatorsByMachine,
          expandedCoordinatorOlderByMachine: collapse.expandedCoordinatorOlderByMachine,
          expandedParkedSessionKeysByMachine: collapse.expandedParkedSessionKeysByMachine,
          expandedDraftSessionKeysByMachine: collapse.expandedDraftSessionKeysByMachine,
        },
      }),
    [
      machines,
      machine,
      inventoriesByMachineId,
      selectedSpaceId,
      selectedWorkspaceId,
      collapse.expandedProjectsByMachine,
      collapse.expandedCollectionsByMachine,
      collapse.expandedGroupsByMachine,
      collapse.collapsedSessionKindsByMachine,
      collapse.collapsedCoordinatorsByMachine,
      collapse.expandedCoordinatorOlderByMachine,
      collapse.expandedParkedSessionKeysByMachine,
      collapse.expandedDraftSessionKeysByMachine,
      sessionListNowMs,
      selectedSessionKey,
    ],
  );

  const pullRefresh = useCallback((): void => {
    if (machine === null) return;
    setPullRefreshing(true);
    const done = (): void => setPullRefreshing(false);
    void refreshMachineFresh(machine).then(done, done);
  }, [machine, refreshMachineFresh]);

  /*
   * Glyph / failed-card retry. The store flips `retrying` synchronously before
   * its first await, so the tab spins for as long as the attempt really takes;
   * the status line says the same thing in words for the same span, then goes
   * back to the truthful connection line the moment the attempt settles.
   */
  const retryMachineWithStatus = useCallback(
    (target: MachineRecord): void => {
      setTransientStatus(StripCopy.retryingStatus(machineDisplayLabel(target)));
      void retryMachine(target.id).finally(() => setTransientStatus(null));
    },
    [retryMachine, setTransientStatus],
  );

  /*
   * One tab per visible machine, in saved order, then the "+" tab. The strip
   * shows whenever a machine exists (the "+" and the connection glyph are
   * useful even with one). The glyph's retry goes through the inventory store
   * by id and never touches the selection, so retrying an unselected machine
   * leaves the drawer on the machine it was showing.
   */
  const machineTabs = useMemo((): MachineTabStripItem[] => {
    const tabs = machines.map((entry): MachineTabItem => {
      const inventory = inventoriesByMachineId[entry.id];
      const connectionState =
        inventory === undefined ||
        !inventory.hasLoaded ||
        inventory.retrying ||
        (inventory.refreshing && inventory.summary === null)
          ? 'busy'
          : inventory.lastError !== null
            ? 'failed'
            : inventory.summary === null
              ? 'disconnected'
              : 'connected';
      const counts = tabStatusCounts(machineSessionCounts(inventory?.summary ?? null));
      const retryable = connectionState === 'failed' || connectionState === 'disconnected';
      return {
        id: entry.id,
        label: machineDisplayLabel(entry),
        connectionState,
        connectionLabel:
          connectionState === 'failed' && inventory?.lastError
            ? inventory.lastError
            : StripCopy.connection[connectionState],
        onConnect: retryable ? () => retryMachineWithStatus(entry) : undefined,
        workingCount: counts.workingCount,
        attentionCount: counts.attentionCount,
        backgroundWorkCount: counts.backgroundWorkCount,
        questionCount: counts.questionCount,
        approvalCount: counts.approvalCount,
      };
    });
    return [...tabs, MACHINE_TAB_ADD];
  }, [machines, inventoriesByMachineId, retryMachineWithStatus]);

  /** The tab's connection line (the failure reason when failed): the long-press menu subtitle. */
  const machineConnectionLine = useCallback(
    (machineId: string): string | undefined => {
      const tab = machineTabs.find((item): item is MachineTabItem => !('kind' in item) && item.id === machineId);
      return tab?.connectionLabel;
    },
    [machineTabs],
  );

  /** Per machine, the failure the user shrank to its pill with the card's ×. */
  const [shrunkNotices, setShrunkNotices] = useState<Readonly<Record<string, FailureReasonCode>>>({});
  // A shrink holds for that failure only: once the machine loads again or fails for another
  // reason, the next failure opens the full card (gx-core `retain_machine_notice_collapses`).
  useEffect(() => {
    setShrunkNotices((current) => {
      const kept = Object.entries(current).filter(
        ([machineId, failureKey]) =>
          inventoriesByMachineId[machineId]?.lastError != null &&
          (inventoriesByMachineId[machineId]?.lastErrorCode ?? 'unknown') === failureKey,
      );
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
  }, [inventoriesByMachineId]);
  const selectedNotice = useMemo(() => {
    if (machine === null) return null;
    const tab = machineTabs.find((item): item is MachineTabItem => !('kind' in item) && item.id === machine.id);
    return machineNotice(machineDisplayLabel(machine), selectedInventory, tab?.connectionState ?? 'disconnected');
  }, [machine, machineTabs, selectedInventory]);

  const statusLine = statusOverride ?? drawerStatusLine(
    machine === null ? null : machineDisplayLabel(machine),
    selectedInventory,
    selectedNotice,
  );
  const recentProjects = selectedInventory?.summary?.recentProjects ?? [];

  // -------------------------------------------------------------------------
  // Actions.
  // -------------------------------------------------------------------------

  const {
    attach,
    attachCreated,
    runSessionCommand,
    workChipActions,
    runBulkSessionActions,
    runCreationFlow,
    reconnectMachine,
    submitRename,
    submitSessionNote,
    runQuickAction,
    restoreRecentProject,
    sessionsForProject,
    runProjectSessionsAction,
  } = useSessionsScreenActions({
    navigation,
    setOverlay,
    setProgress,
    setTransientStatus,
    refreshMachine,
    retryMachine,
  });

  // -------------------------------------------------------------------------
  // Menus.
  // -------------------------------------------------------------------------

  const openSessionTerminal = useCallback(
    (target: MachineRecord, session: GhostexSession): Promise<void> => attach(target, session, { terminal: true }),
    [attach],
  );
  // The Unified list's Snooze and Unsnooze (./sessions-screen/use-unified-list.tsx).
  const snoozeSession = useMemo(
    () => makeSnoozeSession({ runBulkSessionActions, refreshMachine, setTransientStatus }),
    [runBulkSessionActions, refreshMachine, setTransientStatus],
  );
  const unified = useUnifiedList({
    machines,
    selectedMachine: machine,
    inventoriesByMachineId,
    selectedWorkspaceIdByMachine,
    selectedSessionKey,
    sidebarBackground: sidebarAppearance.background,
    setOverlay,
    attach: (target, session) => attach(target, session),
    runBulkSessionActions,
    snoozeSession,
    openAddProject: (machineId) => navigation.navigate('AddProjectSource', { machineId }),
  });

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
    sectionMenuItems,
    resolvePrimaryAgent,
    launchAgent,
    createProjectTerminal,
    agentMenuItems,
    createCoordinator,
    loadCoordinatorOptions,
    loadCoordinatorDetails,
    saveCoordinatorDetails,
    actionsMenuItems,
    recoveryItems,
  } = useSessionsScreenMenus({
    snoozeSession,
    entries,
    collapse,
    lastActionByProject,
    navigation,
    openSessionTerminal,
    agentChoices,
    agentChoiceContext,
    setProgress,
    reconnectMachine,
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

  /** A long press or a button on a list row: haptics, then the overlay, for a machine that is still saved. */
  const withMachine = useCallback(
    (machineId: string, open: (target: MachineRecord) => void, haptic = false): void => {
      const target = machineById(machineId);
      if (target === null) return;
      if (haptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      open(target);
    },
    [machineById],
  );

  /** The session a voice call on the phone is about, as an attachSessionKey (the row's green headset). */
  const voiceCallSessionKey = useVoiceStore((state) =>
    voiceActive(state.phase) && state.machineId !== null && (state.focus ?? state.requestedFocus) !== null
      ? attachSessionKey(state.machineId, (state.focus ?? state.requestedFocus)!.sessionId)
      : null,
  );

  const blockActions: DrawerBlockActions = {
    toggleProject: (machineId, header) => collapse.toggleProject(machineId, header.projectKey),
    toggleCollection: (machineId, header) => collapse.toggleCollection(machineId, header.collectionId),
    toggleGroup: (machineId, item) => collapse.toggleGroup(machineId, item.groupCollapseKey),
    toggleSessionKind: (machineId, item) => collapse.toggleSessionKind(machineId, item.kindCollapseKey),
    toggleCoordinator: (machineId, item) => collapse.toggleCoordinator(machineId, coordinatorRowKey(item.session)),
    toggleCoordinatorOlder: (machineId, coordinatorKey) => collapse.toggleCoordinatorOlder(machineId, coordinatorKey),
    openSession: (machineId, item) => withMachine(machineId, (target) => void attach(target, item.session)),
    sessionMenu: (machineId, item) =>
      withMachine(
        machineId,
        (target) => setOverlay({ kind: 'sessionMenu', ctx: { machine: target, item }, menuPath: [] }),
        true,
      ),
    projectMenu: (machineId, header) =>
      withMachine(machineId, (target) =>
        setOverlay({ kind: 'projectMenu', ctx: { machine: target, header }, menuPath: [] }),
      ),
    collectionMenu: (machineId, header) =>
      withMachine(machineId, (target) =>
        setOverlay({ kind: 'collectionMenu', ctx: { machine: target, header }, view: 'root' }),
      ),
    groupMenu: (machineId, item) =>
      withMachine(machineId, (target) => setOverlay({ kind: 'groupMenu', ctx: { machine: target, item } })),
    parkedMenu: (machineId, item) =>
      withMachine(machineId, (target) => setOverlay({ kind: 'parkedMenu', ctx: { machine: target, item } }), true),
    launchPrimary: (machineId, header, agent) => withMachine(machineId, (target) => launchAgent(target, header, agent)),
    createProjectTerminal: (machineId, header) =>
      withMachine(machineId, (target) => createProjectTerminal({ machine: target, header })),
    createGroupTerminal: (machineId, item) =>
      withMachine(machineId, (target) => {
        if (item.projectId.length === 0) return;
        void runCreationFlow(
          target,
          createSessionInGroupCommand(item.projectId, item.groupId),
          ProgressCopy.creatingTerminal(item.title),
        );
      }),
    agentMenu: (machineId, header) =>
      withMachine(machineId, (target) => setOverlay({ kind: 'agentMenu', ctx: { machine: target, header } })),
    stateCard: (machineId) => setOverlay({ kind: 'recovery', machine: machineById(machineId) }),
    workChipActions: (machineId, item) => workChipActions(machineById(machineId), item.session),
  };

  const listRefreshControl = (
    <RefreshControl
      colors={[GhostexPalette.ACCENT]}
      tintColor={sidebarAppearance.muted}
      progressBackgroundColor={sidebarAppearance.background}
      refreshing={pullRefreshing}
      onRefresh={pullRefresh}
    />
  );
  const listFooter = (
    <Text style={styles.longPressHint} numberOfLines={1}>
      Long-press any item for more options.
    </Text>
  );

  const renderBlock = ({ item: block }: { item: DrawerBlock }) => (
    <DrawerBlockView
      block={block}
      selectedSessionKey={selectedSessionKey}
      appearance={sidebarAppearance}
      rowSurface={neutralExpandedGroupSurface}
      groupsOpacityPercent={sidebarGroupsOpacityPercent}
      summary={inventoriesByMachineId[block.machineId]?.summary ?? null}
      voiceCallSessionKey={voiceCallSessionKey}
      primaryAgent={resolvePrimaryAgent}
      // The floating MachineNotice over the list says these two.
      hideStateCard={(item) =>
        (item.variant === 'failure' || item.variant === 'connecting') && machineById(block.machineId) !== null
      }
      actions={blockActions}
    />
  );

  /**
   * Tailcat machines reach the computer through the in-app bridge, so the
   * Tailscale app's VPN state says nothing about whether they can connect.
   * Only plain-SSH machines (and the not-yet-added case, whose SSH host is
   * normally a tailnet name) depend on it.
   */
  const tailscaleApplies = machine === null || machine.transport !== 'tailcat';

  const moreButtonRef = useRef<ViewInstance | null>(null);
  const contentTop = useContentTop();
  // The session list reaches under the iPhone Duo's side bar, its rows keep clear of it.
  const listEdges = useScrollToBarEdges(styles.listContent);
  // The app menu stays at its More options button while it is open, wherever that moves.
  const appMenuAnchor = useLiveMenuAnchor(
    overlay.kind === 'appMenu' ? { key: 'more', pressed: overlay.anchor } : null,
    moreButtonRef,
  );
  const inRail = headerPlacement.kind === 'rail';
  // The header keeps only the title and this menu button (Voice, Search, Web and Machines stand in the
  // bottom bar, CDXC:Sessions 2026-10-27). On the iPhone Duo the status band holds the same row. In the
  // side bar (a system that stands one) the button stands there as the rail's one entry.
  const moreButton = (
    <Pressable
      ref={moreButtonRef}
      accessibilityRole="button"
      accessibilityLabel={DuoChromeCopy.more}
      style={styles.headerButton}
      // In the iPhone Duo's status band the menu opens below this button.
      onPress={() =>
        headerPlacement.kind === 'top'
          ? setOverlay({ kind: 'appMenu' })
          : measureInWindow(moreButtonRef, (anchor) => setOverlay({ kind: 'appMenu', anchor }))
      }
    >
      <MenuGlyph size={20} color={sidebarAppearance.foreground} />
    </Pressable>
  );
  // Memoized on the header's inputs, so unrelated list updates do not republish the side bar.
  const railButtons = useMemo<RailButtons>(() => {
    const color = sidebarAppearance.foreground;
    const entries: RailEntry[] = [
      {
        key: 'more',
        label: DuoChromeCopy.more,
        icon: (size) => <MenuGlyph size={size} color={color} />,
        onPress: (anchor) => setOverlay({ kind: 'appMenu', anchor }),
      },
    ];
    // The session search sheet and the rename and note dialogs take the keyboard.
    return { entries, pinned: 0, moreMenu: 'always', reserveKeyboard: true };
  }, [sidebarAppearance.foreground]);
  useRailButtons(railButtons, sidebarAppearance.background, inRail && isFocused);

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: sidebarAppearance.background },
        // In the side bar's poses the title row starts below the system's top margin.
        inRail ? { paddingTop: contentTop } : null,
      ]}
      // iOS leaves the bottom safe area to the bottom bar, whose background runs to the screen edge; Android
      // keeps it here as before, so its navigation bar area shows the screen's background, not the bar's.
      edges={inRail ? [] : Platform.OS === 'ios' ? ['top'] : ['top', 'bottom']}
    >
      <View
        style={[
          styles.headerRow,
          headerPlacement.kind === 'band'
            ? [styles.bandRow, bandRowFrame(headerPlacement.frame, SESSIONS_HEADER_HEIGHT)]
            : null,
        ]}
      >
        {/*
          Manual refresh is pull-to-refresh on the list below, so the title has
          the header row's leading space to itself. Long-pressing it opens the
          selected machine's menu, the same menu a long press on its tab opens.
        */}
        <Pressable
          accessibilityRole="header"
          accessibilityHint="Touch and hold for the machine menu"
          onLongPress={() => {
            if (machine === null) return;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setOverlay({ kind: 'machineMenu', ctx: { machine } });
          }}
          style={styles.titlePressable}
        >
          <Text style={[styles.title, { color: sidebarAppearance.foreground }]}>Ghostex</Text>
        </Pressable>
        {inRail ? null : moreButton}
      </View>
      {machines.length > 0 ? (
        <MachineTabs
          items={machineTabs}
          selectedMachineId={machine === null ? null : machine.id}
          onSelect={(machineId) => selectMachine(machineId)}
          onLongPress={(machineId) => {
            const target = machineById(machineId);
            if (target === null) return;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            setOverlay({ kind: 'machineMenu', ctx: { machine: target } });
          }}
          onAdd={() => navigation.navigate('ConnectChoose')}
        />
      ) : null}
      {tailscaleApplies && tailscaleConnected === false ? (
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
          <Text style={[styles.statusLine, { color: sidebarAppearance.muted }]} numberOfLines={1} ellipsizeMode="tail">
            {statusLine}
          </Text>
        </Pressable>
        {tailscaleApplies && tailscaleConnected === true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tailscale connected"
            hitSlop={8}
            style={styles.tailscaleIndicator}
            onPress={() => void openTailscaleOrDownload()}
          >
            <Text style={[styles.tailscaleIndicatorLabel, { color: GhostexPalette.STATUS_CONNECTED }]}>
              • Tailscale
            </Text>
          </Pressable>
        ) : null}
      </View>
      {/*
        A machine with no Spaces has nothing to switch between — Other alone
        would be every project — so the row appears only once it has one.
      */}
      {unified.on ? (
        // The Unified list's header stands where the Workspace and Space tiles stand: its filter narrows by them.
        unified.header
      ) : machine !== null && showWorkspaceTile && selectedWorkspace !== null ? (
        <View style={styles.workspaceRow}>
          <WorkspaceTile
            workspace={selectedWorkspace}
            switchTo={workspaceSwitchTo}
            onSwitch={(workspaceId) => selectWorkspace(machine.id, workspaceId)}
            onOpenMenu={() => setWorkspaceMenuOpen(true)}
          />
          {spaceItems.length > 0 ? (
            <SpaceTabs
              spaces={spaceItems}
              selectedSpaceId={selectedSpaceId}
              countsBySpaceId={spaceCounts}
              onSelect={(spaceId) => selectSpace(machine.id, spaceId)}
              style={styles.workspaceRowSpaces}
            />
          ) : null}
        </View>
      ) : machine !== null && spaceItems.length > 0 ? (
        <SpaceTabs
          spaces={spaceItems}
          selectedSpaceId={selectedSpaceId}
          countsBySpaceId={spaceCounts}
          onSelect={(spaceId) => selectSpace(machine.id, spaceId)}
        />
      ) : null}
      {machine !== null && workspaceMenuOpen && machineWorkspaces !== null && selectedWorkspaceId !== null ? (
        <ContextMenu
          visible
          title={machineDisplayLabel(machine)}
          items={workspaceMenuItems(machineWorkspaces, selectedWorkspaceId, (workspaceId) => {
            setWorkspaceMenuOpen(false);
            selectWorkspace(machine.id, workspaceId);
          })}
          onClose={() => setWorkspaceMenuOpen(false)}
        />
      ) : null}
      <View style={styles.listArea}>
        {unified.on ? (
          <FlatList
            data={unified.items}
            keyExtractor={unified.keyExtractor}
            renderItem={unified.renderItem}
            style={[styles.list, listEdges.scroll]}
            contentContainerStyle={[styles.listContent, listEdges.content]}
            refreshControl={listRefreshControl}
            ListFooterComponent={listFooter}
          />
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(entry) => entry.listKey}
            renderItem={renderBlock}
            style={[styles.list, listEdges.scroll]}
            contentContainerStyle={[styles.listContent, listEdges.content]}
            refreshControl={listRefreshControl}
            ListFooterComponent={listFooter}
          />
        )}
        {machine !== null && selectedNotice !== null ? (
          <MachineNotice
            notice={selectedNotice}
            collapsed={selectedNotice.kind === 'failure' && shrunkNotices[machine.id] === selectedNotice.failureKey}
            appearance={sidebarAppearance}
            onShrink={() => {
              if (selectedNotice.kind !== 'failure') return;
              setShrunkNotices((current) => ({ ...current, [machine.id]: selectedNotice.failureKey }));
            }}
            onExpand={() =>
              setShrunkNotices((current) =>
                Object.fromEntries(Object.entries(current).filter(([id]) => id !== machine.id)),
              )
            }
            onReconnect={() => retryMachineWithStatus(machine)}
            onRemoteSettings={() => navigation.navigate('MachineForm', { machineId: machine.id })}
          />
        ) : null}
      </View>
      {/*
        CDXC:Sessions 2026-10-27 DECISION:
        User picked option E for the Sessions screen's top bar buttons (Q362, docs/2026-10-21/phone-sessions-screen/top-bar-buttons.html): "Voice, Search, Web and Machines move to a labelled bar at the bottom; the top keeps only the title and the menu." The bottom bar holds the four, labelled, within thumb reach. Search still opens SessionSearchSheet, which searches every visible computer's open and closed sessions with the desktop's Sessions search rules and restores a closed one when tapped (the 2026-10-01 decision); only its place moves from the top right to the bar. Voice shows only where the computer runs the voice agent, and Web only once a computer is chosen.
      */}
      {/*
        On iOS the bar's background runs to the bottom screen edge as iOS tab bars do; this screen
        leaves the bottom safe area to it (SafeAreaView edges), and its items stay above the home indicator.
      */}
      <SessionsBottomBar>
        <VoiceButton
          machine={machine}
          style={styles.bottomItem}
          color={styles.bottomIconColor.color}
          size={20}
          activeFill={false}
          label="Voice"
          labelStyle={styles.bottomLabel}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SessionSearchCopy.buttonLabel}
          style={({ pressed }) => [styles.bottomItem, pressed ? styles.bottomItemPressed : null]}
          onPress={() => setSessionSearchOpen(true)}
        >
          <SearchGlyph size={20} color={styles.bottomIconColor.color} />
          <Text style={styles.bottomLabel}>Search</Text>
        </Pressable>
        {/*
          Web Preview forwards a port from the selected machine, so it is
          offered whenever a machine is chosen. It is also in the machine menu,
          but that is a long press on a machine tab (or on the page title), so
          this button is the entry point that is always visible.
        */}
        {machine !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={WebPreviewCopy.menuLabel}
            style={({ pressed }) => [styles.bottomItem, pressed ? styles.bottomItemPressed : null]}
            onPress={() => navigation.navigate('WebPreviewPorts', { machineId: machine.id })}
          >
            <WorldGlyph size={20} color={styles.bottomIconColor.color} />
            <Text style={styles.bottomLabel}>Web</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Machines"
          style={({ pressed }) => [styles.bottomItem, pressed ? styles.bottomItemPressed : null]}
          onPress={() => navigation.navigate('Machines')}
        >
          <MachinesGlyph size={20} color={styles.bottomIconColor.color} />
          <Text style={styles.bottomLabel}>Machines</Text>
        </Pressable>
      </SessionsBottomBar>
      <ProgressOverlay visible={progress !== null} message={progress ?? ''} />

      <SessionSearchSheet
        visible={sessionSearchOpen}
        machines={machines}
        onOpen={(target, session) => {
          setSessionSearchOpen(false);
          // A result can come from another computer; show that computer's list, as if the row had been tapped there.
          if (machine?.id !== target.id) selectMachine(target.id);
          revealSessionWorkspace(target.id, session.sessionId);
          void attach(target, session);
        }}
        onRestore={async (target, closed) => {
          // A failure here stays in the search panel, which shows it under the field.
          const restored = await restoreClosedSession(target, closed);
          await refreshMachine(target);
          setSessionSearchOpen(false);
          if (machine?.id !== target.id) selectMachine(target.id);
          revealSessionWorkspace(target.id, restored.sessionId);
          void attachCreated(target, restored.sessionId).catch((error: unknown) => {
            setTransientStatus(error instanceof Error ? error.message : String(error));
          });
        }}
        onClose={() => setSessionSearchOpen(false)}
      />

      {overlay.kind === 'sessionMenu' ? (
        <ContextMenu
          visible
          title={sessionTitle(overlay.ctx.item.session)}
          {...sessionMenuView(overlay.ctx, overlay.menuPath)}
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
          title="Close session?"
          body={
            closePutsSessionToSleep(overlay.ctx.item.session)
              ? SessionCopy.claudeCloudCloseSleeps
              : 'This closes the selected Ghostex session on the connected machine.'
          }
          targetLine={`${overlay.ctx.item.session.alias} · ${sessionTitle(overlay.ctx.item.session)}`}
          confirmLabel="Close Session"
          destructive
          onConfirm={() => {
            const action = closeSessionAction(overlay.ctx.item.session);
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
          subtitle={machineConnectionLine(overlay.ctx.machine.id)}
          items={machineMenuItems(overlay.ctx.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

      {overlay.kind === 'appMenu' ? (
        <ContextMenu
          visible
          title="Ghostex"
          subtitle={machine === null ? undefined : machineDisplayLabel(machine)}
          items={appMenuItems(machine)}
          onClose={() => setOverlay(NONE)}
          anchor={appMenuAnchor}
        />
      ) : null}

      {overlay.kind === 'sectionMenu' ? (
        <ContextMenu
          visible
          title="Projects"
          subtitle={machineDisplayLabel(overlay.machine)}
          items={sectionMenuItems(overlay.machine)}
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

      {overlay.kind === 'agentMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle="Start an agent session"
          items={agentMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}

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
          projectTitle={overlay.ctx.header.title}
          loadOptions={() => loadCoordinatorOptions(overlay.ctx)}
          onCreate={(input) => createCoordinator(overlay.ctx, input)}
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
          title={overlay.machine !== null ? machineDisplayLabel(overlay.machine) : StateCardCopy.noMachines.title}
          items={recoveryItems(overlay.machine)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
    </SafeAreaView>
  );
}
