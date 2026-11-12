/**
 * Sessions drawer as the app's home page (docs/specs/sessions-drawer.md §§1-6):
 * header + status line + flat drawer list built from
 * buildDrawerItems, with session/project context menus, creation flows,
 * recovery sheet, and focus-scoped 5s inventory polling. Folded on the iPhone
 * Duo the list starts with the sessions that wait for the user (`triage/`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ProjectPickerSheet } from '../chat/native/composer/ProjectPickerSheet';
import {
  agentSpaceOfProject,
  newSessionComputersNow,
  projectChoicesNow,
  summaryOfProjectWorkspace,
} from './sessions-screen/new-session-place';
import { NewSessionButton, newSessionEmptyList } from './sessions-screen/new-session-button';
import { UpdateButton } from './sessions-screen/UpdateButton';
import {
  AppState,
  BackHandler,
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
import NoticeToast, { type Notice } from '../components/common/NoticeToast';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import { measureInWindow } from '../components/common/measureInWindow';
import { bandRowFrame } from '../components/common/verticalBar/layout';
import {
  useContentTop,
  useFoldDivisions,
  useHeaderPlacement,
  useLiveMenuAnchor,
  useRailButtons,
  useScrollToBarEdges,
  useVerticalBarSpace,
  type RailButtons,
  type RailEntry,
} from '../components/common/verticalBar/VerticalBarArea';
import { useCollapseStore } from '../components/sessions/collapseStore';
import { useOpenProjectDraftsOnArrival } from '../components/sessions/useDraftArrivals';
import { useSessionListClock } from '../components/sessions/useSessionListClock';
import ContextMenu, { type ContextMenuItem } from '../components/sessions/ContextMenu';
import SessionLinksSheet from '../chat/native/SessionLinksSheet';
import {
  buildDrawerList,
  hideProjectsWithoutSessions,
  hidesProjectsWithoutSessions,
  type DrawerBlock,
} from '../components/sessions/drawerModel';
import { drawerStatusLine } from '../components/sessions/drawerStatusLine';
import { ListGlyph, MachinesGlyph, MenuGlyph, SearchGlyph, TilesGlyph, WorldGlyph } from '../components/sessions/icons';
import { EditGlyph } from '../components/sessions/unified/glyphs';
import { bellLabel, BellWithCount, useNeedsYouCount } from '../notifications/NotificationsBell';
import { VoiceButton } from '../voice/VoiceButton';
import { useVoiceStore, voiceActive } from '../voice/conversation';
import MachineTabs, {
  MACHINE_TAB_ADD,
  type MachineTabItem,
  type MachineTabStripItem,
} from '../components/sessions/MachineTabs';
import SpaceTabs from '../components/sessions/SpaceTabs';
import ChiefRow, { CHIEF_LABEL } from '../components/sessions/ChiefRow';
import { runGhostexCli } from '../components/sessions/cli';
import {
  chiefOnIn,
  chiefRows,
  hasHomeProject,
  HOME_LABEL,
  MAIN_HUB_EXPLANATION,
  parseChiefAgents,
  type ChiefRowModel,
} from '../contract/chief';
import {
  chiefNewChatCommand,
  chiefOpenCommand,
  chiefSetAgentCommand,
  chiefStatusCommand,
  chiefStopAskingCommand,
} from '../commands/ghostexCli';
import WorkspaceTile, { workspaceMenuItems } from '../components/sessions/WorkspaceTile';
import { agentChoicePlace, parseAgentChoiceScope, type AgentChoiceContext } from '../components/sessions/agentChoice';
import { useLauncherStore } from '../components/sessions/launcherStore';
import { expandedGroupBackground, inkWash, sidebarInk } from '../components/sessions/rows';
import SessionSearchSheet from '../components/sessions/SessionSearchSheet';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import NewCoordinatorSheet from './sessions-screen/NewCoordinatorSheet';
import CoordinatorDetailsSheet from './sessions-screen/CoordinatorDetailsSheet';
import CoordinatorPlaybookSheet from './sessions-screen/CoordinatorPlaybookSheet';
import WorkLinkPicker from './sessions-screen/work-link-picker';
import DrawerBlockView, { type DrawerBlockActions } from './sessions-screen/DrawerBlockView';
import { useGbots } from './sessions-screen/use-gbots';
import { recentProjectsWithoutGbots } from '../contract/gbotsFilter';
import ExportTranscriptSheet from '../components/terminal/ExportTranscriptSheet';
import { CloseIcon, WarningTriangleIcon } from '../components/terminal/icons';
import { DemoCopy } from '../demo/copy';
import { isDemoMachine } from '../demo/identity';
import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createSessionInGroupCommand,
  delayedSendCommand,
} from '../commands/ghostexCli';
import { stateWithCollectionTitle } from '../contract/collectionsState';
import { machineSessionCounts, tabStatusCounts } from '../contract/grouping';
import { coordinatorRowKey } from '../contract/coordinatorTree';
import { EMPTY_SIDEBAR_SPACES, NO_SUMMARY_CAPABILITIES, type GhostexSession } from '../contract/mobileSummary';
import {
  DuoChromeCopy,
  NewSessionCopy,
  ProgressCopy,
  RenameCopy,
  SessionCopy,
  SessionNoteCopy,
  SessionSearchCopy,
  StateCardCopy,
  StripCopy,
  WebPreviewCopy,
  WallCopy,
} from '../copy';
import JustPairedLine from './sessions-screen/JustPairedLine';
import { MachineNoticeDetails, MachineNoticeLine, useNoticeClock } from './sessions-screen/MachineNotice';
import { machineNotice, machineShortName } from '../components/sessions/machineNotice';
import { renameInitialTitle } from '../sessions/sessionCommands';
import { useInventoryStore } from '../inventory/store';
import {
  isMachineEnabled,
  machineDisplayLabel,
  selectedMachine,
  useMachinesStore,
  type MachineRecord,
} from '../machines/store';
import {
  computerIconDrawing,
  forgetComputerIcon,
  readComputerIcon,
  setConnectedComputers,
  useComputerIconsStore,
} from '../machines/computerIcons';
import type { RootStackParamList } from '../navigation/types';
import {
  filterSummaryForSpace,
  resolveSelectedSpaceId,
  spaceRowItems,
  spaceSessionCounts,
} from '../spaces/spaceFilter';
import { useSpacesStore } from '../spaces/store';
import { revealSessionWorkspace, useWorkspacesStore } from '../workspaces/store';
import { restoreClosedSession } from '../sessions/closedSessions';
import { filterSummaryForWorkspace, resolveWorkspaceId, workspaceSwitchTarget } from '../workspaces/workspaceFilter';
import { useSettingsStore, type SessionListView } from '../settings/store';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { GhostexPalette, mixHexColors } from '../theme/palette';
import { readableSecondaryText } from '../theme/sidebarAppearance';
import { useStatusBarStyle } from '../theme/statusBar';
import { useAppearance } from '../theme/useAppearance';
import {
  closePutsSessionToSleep,
  type SessionContext,
  closeSessionAction,
  NONE,
  sessionTitle,
  type Overlay,
} from './sessions-screen/session-actions';
import { closeConfirmCopy } from './sessions-screen/close-confirm';
import { SessionList } from './sessions-screen/session-list';
import { SessionsBottomBar } from './sessions-screen/BottomBar';
import {
  SESSIONS_HEADER_HEIGHT,
  styles,
  TAILSCALE_WARNING_AMBER,
  TAILSCALE_WARNING_WASH_PERCENT,
} from './sessions-screen/styles';
import { useSessionsScreenActions } from './sessions-screen/use-sessions-screen-actions';
import { useSessionsScreenMenus } from './sessions-screen/use-sessions-screen-menus';
import { makeSnoozeSession, useUnifiedList } from './sessions-screen/use-unified-list';
import { machineTabsVisible } from './sessions-screen/machineStripPolicy';
import { useListInventories } from '../cloudBoxes/listInventories';
import { cloudBoxRowMenu } from '../cloudBoxes/rowMenu';
import { cloudWhereItems, useCloudWhere } from '../cloudBoxes/whereMenu';
import { runPhoneBoxStart, type PhoneBoxStart } from '../cloudBoxes/phoneStartFlow';
import { wallColumns } from './wall/layout';
import { wallTargets } from './wall/previews';
import { useWallPreviews } from './wall/useWallPreviews';
import WallSwitch from './wall/WallSwitch';
import { foldedOuterDisplay, triageSessions, unifiedTriageWaits, type TriageWait } from './triage/model';
import TriageSection from './triage/TriageSection';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

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

/** What Main Hub is, at the top of its menus (the desktop's hover card). */
const MAIN_HUB_NOTES: ContextMenuItem[] = [
  ...MAIN_HUB_EXPLANATION.map((line, index): ContextMenuItem => ({
    kind: 'note',
    key: `main-hub-note-${index}`,
    label: line,
  })),
  { kind: 'separator', key: 'main-hub-note-end' },
];

export default function SessionsScreen({ navigation }: Props) {
  const headerPlacement = useHeaderPlacement();
  const isFocused = useIsFocused();
  const savedMachines = useMachinesStore((state) => state.machines);
  // Only machines the user keeps visible reach the tab strip, the drawer, and
  // the polling loop; hidden ones stay in Machines and are never connected to.
  const machines = useMemo(() => savedMachines.filter(isMachineEnabled), [savedMachines]);
  const machine = useMachinesStore((state) => selectedMachine(state));
  const selectMachine = useMachinesStore((state) => state.selectMachine);
  // Cloud Box sessions are listed inside their home project (cloudBoxes/listInventories.ts).
  const inventoriesByMachineId = useListInventories();
  const computerIconFacts = useComputerIconsStore((state) => state.facts);
  const refreshMachine = useInventoryStore((state) => state.refreshMachine);
  const refreshMachineFresh = useInventoryStore((state) => state.refreshMachineFresh);
  const retryMachine = useInventoryStore((state) => state.retryMachine);
  const refreshAll = useInventoryStore((state) => state.refreshAll);
  const needsYou = useNeedsYouCount();
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
  const sidebarGroupsOpacityPercent = useSettingsStore((state) => state.settings.sidebarGroupsOpacityPercent);
  const tailscaleReminder = useSettingsStore((state) => state.settings.tailscaleReminder);
  const setSetting = useSettingsStore((state) => state.setSetting);
  const sidebarAppearance = useAppearance();
  useStatusBarStyle(sidebarAppearance.light);
  // The list's ink (rows.tsx): on a light appearance the screen's own captions take the desktop's dark text.
  const listInk = sidebarInk(sidebarAppearance.light);
  const neutralExpandedGroupSurface = useMemo(
    () => expandedGroupBackground(sidebarAppearance.background),
    [sidebarAppearance.background],
  );
  // The Tailscale notice on a light appearance: its line and its close glyph in the list's muted ink, darkened where its
  // amber wash over the page needs that for 4.5:1 (the glyph needs 3:1).
  const tailscaleNoticeMuted = useMemo(
    () =>
      readableSecondaryText(listInk.muted, sidebarAppearance.foreground, [
        mixHexColors(TAILSCALE_WARNING_AMBER, sidebarAppearance.background, TAILSCALE_WARNING_WASH_PERCENT),
      ]),
    [listInk.muted, sidebarAppearance.foreground, sidebarAppearance.background],
  );
  const tailscaleConnectedInk = useMemo(
    () =>
      readableSecondaryText(GhostexPalette.STATUS_CONNECTED, sidebarAppearance.foreground, [
        sidebarAppearance.background,
      ]),
    [sidebarAppearance],
  );

  const [overlay, setOverlay] = useState<Overlay>(NONE);
  /** What a pick in the agent menu's project list opens once the sheet has gone. */
  const afterProjectSheet = useRef<(() => void) | null>(null);
  /** New session › Cloud Box with the computer off: the first message the phone starts the box with. */
  const [phoneBoxStart, setPhoneBoxStart] = useState<PhoneBoxStart | null>(null);
  // New session › Where (This computer or Cloud Box) for the project whose agent menu is open.
  useCloudWhere(
    overlay.kind === 'agentMenu' ? overlay.ctx.machine.id : null,
    overlay.kind === 'agentMenu' ? overlay.ctx.header.projectId : null,
  );
  const [sessionSearchOpen, setSessionSearchOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  /*
   * Pull-to-refresh replaces the old header Refresh button, and owns its own
   * spinner state: the 5s poll flips the inventory's `refreshing` flag on every
   * tick, so driving the control from that would blink it forever.
   */
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeCounter = useRef(0);
  const [tailscaleConnected, setTailscaleConnected] = useState<boolean | null>(null);
  /** Last logged Tailscale state, so the 5s probe logs only transitions. */
  const tailscaleLogged = useRef<boolean | null>(null);

  const machineById = useCallback(
    (id: string): MachineRecord | null => machines.find((entry) => entry.id === id) ?? null,
    [machines],
  );

  const setTransientStatus = useCallback(
    (message: string | null, options: Partial<Pick<Notice, 'title' | 'error' | 'announce'>> = {}): void => {
      if (message === null) {
        setNotice(null);
        return;
      }
      logAppEvent(options.title === undefined ? message : `${options.title}: ${message}`);
      noticeCounter.current += 1;
      setNotice({ id: noticeCounter.current, message, error: false, durationMs: 6000, ...options });
    },
    [],
  );

  // The summary poll is the app's own (src/app/lifecycle.ts): it runs on every screen while
  // the app is in the foreground and a machine is selected, so this screen only hydrates its own stores.
  useFocusEffect(
    useCallback(() => {
      void useCollapseStore.getState().hydrate();
      void useLauncherStore.getState().hydrate();
      void useSpacesStore.getState().hydrate();
      void useWorkspacesStore.getState().hydrate();
    }, []),
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
  /*
   * The computer answered its last list read (over the local network, another VPN or Tailscale
   * alike), so Tailscale being off on this phone is not what stands between them: the notice stays
   * hidden. Issue #439: it showed on the same Wi-Fi as the computer.
   */
  const computerReachable =
    selectedInventory !== undefined && selectedInventory.summary !== null && selectedInventory.lastError === null;
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
   * Space that shows it: the drawer's selected Space when it lists the project, else the project's
   * own (`agentSpaceOfProject`), so a pick is never looked up or remembered in another Space.
   */
  const agentChoiceContext = useCallback(
    (machineId: string, projectId: string): AgentChoiceContext => {
      const whole = inventoriesByMachineId[machineId]?.summary ?? null;
      // The shown workspace while it lists the project, else the project's own (the shown one can have no Spaces).
      const own =
        whole === null ? null : summaryOfProjectWorkspace(whole, projectId, selectedWorkspaceIdByMachine[machineId]);
      const spaces = own?.sidebarSpaces ?? EMPTY_SIDEBAR_SPACES;
      const drawerSpaceId =
        machineId === machine?.id
          ? selectedSpaceId
          : resolveSelectedSpaceId(spaces, selectedSpaceIdByMachine[machineId]);
      // The project's own Space: a start from New session, a Unified group or the filter can be in another one.
      const spaceId =
        own === null || spaces.order.length === 0
          ? null
          : agentSpaceOfProject(own, machineId, projectId, drawerSpaceId);
      const worktreeParent =
        whole?.projects.find((project) => project.projectId === projectId)?.worktreeParentProjectId ?? '';
      return {
        scope: parseAgentChoiceScope(whole?.newSessionAgentScope),
        place: agentChoicePlace(machineId, projectId, worktreeParent, spaceId),
      };
    },
    [machine?.id, inventoriesByMachineId, selectedSpaceId, selectedSpaceIdByMachine, selectedWorkspaceIdByMachine],
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

  /*
   * The session wall: where the window has the fold's divisions (the iPhone Duo's inner display, flat or half
   * folded; the panes' rule in TerminalScreen) the list switches between rows and tiles. Folded, on other iPhones
   * and on Android it is the list, and the stored choice waits. The classic list draws its tiles in `DrawerBlockView`,
   * the Unified list in `useUnifiedList` (`wall`). The tiles' thumbnails are read only while the tiles are shown on
   * this screen in front (`useWallPreviews` adds the app being in the foreground), for the list that draws them.
   */
  const foldDivisions = useFoldDivisions();
  const wallOffered = Platform.OS === 'ios' && (foldDivisions?.length ?? 0) > 0;
  const sessionListView = useSettingsStore((state) => state.settings.sessionListView);
  const chooseListView = useCallback(
    (view: SessionListView): void => setSetting('sessionListView', view),
    [setSetting],
  );
  const tilesShown = wallOffered && sessionListView === 'tiles';
  const [listWidth, setListWidth] = useState(0);
  const barSpace = useVerticalBarSpace();
  const tileColumns = tilesShown ? wallColumns(listWidth - barSpace.left - barSpace.right) : null;
  const classicWallTargets = useMemo(() => (tilesShown ? wallTargets(entries) : []), [tilesShown, entries]);

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
   * Project layout has one tab per visible machine, in saved order, then the "+" tab.
   * The glyph's retry goes through the inventory store by id and never touches
   * the selection, so retrying an unselected machine leaves the drawer in place.
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
      const iconFacts = computerIconFacts[entry.id];
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
        iconDrawing: iconFacts !== undefined ? computerIconDrawing(iconFacts) : undefined,
      };
    });
    return [...tabs, MACHINE_TAB_ADD];
  }, [machines, inventoriesByMachineId, retryMachineWithStatus, computerIconFacts]);

  /*
   * Each computer's icon (machines/computerIcons.ts): asked once a connected computer's sessions have loaded, asked
   * again after it was away; the connected ones decide whether session rows show it (more than one).
   */
  useEffect(() => {
    const isConnected = (machineId: string): boolean => {
      const inventory = inventoriesByMachineId[machineId];
      return inventory?.summary != null && inventory.lastError === null;
    };
    for (const entry of machines) {
      if (isConnected(entry.id)) void readComputerIcon(entry);
      else forgetComputerIcon(entry.id);
    }
    setConnectedComputers(machines.filter((entry) => isConnected(entry.id)).map((entry) => entry.id));
  }, [machines, inventoriesByMachineId]);

  /** The tab's connection line (the failure reason when failed): the long-press menu subtitle. */
  const machineConnectionLine = useCallback(
    (machineId: string): string | undefined => {
      const tab = machineTabs.find((item): item is MachineTabItem => !('kind' in item) && item.id === machineId);
      return tab?.connectionLabel;
    },
    [machineTabs],
  );

  const recentProjects = recentProjectsWithoutGbots(selectedInventory?.summary);

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
  const [showAllProjects, setShowAllProjects] = useState(false);
  const ownHideProjects = useSettingsStore((state) => state.settings.sessionsListHideProjectsWithoutSessions);
  const hideProjects = hidesProjectsWithoutSessions(
    ownHideProjects,
    machine === null ? null : (inventoriesByMachineId[machine.id]?.summary ?? null),
  );
  const visibleEntries = useMemo(
    () => hideProjectsWithoutSessions(entries, hideProjects, showAllProjects),
    [entries, hideProjects, showAllProjects],
  );
  const openAddProject = (machineId: string): void =>
    machines.length > 1
      ? setOverlay({ kind: 'machinePicker', purpose: 'addProject' })
      : navigation.navigate('AddProjectSource', { machineId });
  const unified = useUnifiedList({
    machines,
    selectedMachine: machine,
    inventoriesByMachineId,
    selectedWorkspaceIdByMachine,
    selectedSessionKey,
    sidebarBackground: sidebarAppearance.background,
    focused: isFocused,
    setOverlay,
    attach: (target, session) => attach(target, session),
    runBulkSessionActions,
    snoozeSession,
    openAddProject,
    notify: (notice) => setTransientStatus(notice.message, { title: notice.title }),
    workChipActions,
    wall: tileColumns === null ? null : { columns: tileColumns, appearance: sidebarAppearance },
  });
  useOpenProjectDraftsOnArrival(inventoriesByMachineId, !unified.on);
  const pullRefresh = useCallback((): void => {
    if (machine === null) return;
    setPullRefreshing(true);
    const done = (): void => setPullRefreshing(false);
    // Fresh on every computer: `refreshAll` would join a poll already under way and settle on
    // what it read before the pull.
    const refreshed = unified.on
      ? Promise.all(machines.map((entry) => refreshMachineFresh(entry)))
      : refreshMachineFresh(machine);
    void refreshed.then(done, done);
  }, [machine, machines, unified.on, refreshMachineFresh]);
  const notices = machines.flatMap((entry) => {
    const tab = machineTabs.find((item): item is MachineTabItem => !('kind' in item) && item.id === entry.id);
    const notice = machineNotice(
      machineShortName(entry),
      inventoriesByMachineId[entry.id],
      tab?.connectionState ?? 'disconnected',
    );
    return notice === null ? [] : [{ machineId: entry.id, notice }];
  });
  // Unified speaks for every computer, a computer tab for its own (machineNotice.ts).
  const shownNotices = unified.on ? notices : notices.filter(({ machineId }) => machineId === machine?.id);
  const noticeFailing = shownNotices.some(({ notice }) => notice.kind === 'failure');
  const noticeNow = useNoticeClock(noticeFailing);
  // The details a tap on the failure line opens; they close by themselves once nothing fails.
  const [noticeOpen, setNoticeOpen] = useState(false);
  useEffect(() => {
    if (!noticeFailing) setNoticeOpen(false);
  }, [noticeFailing]);
  const statusLine = drawerStatusLine(
    machine === null ? null : machineDisplayLabel(machine),
    selectedInventory,
    shownNotices[0]?.notice ?? null,
  );
  useWallPreviews(tilesShown && isFocused, unified.on ? unified.wallTargets : classicWallTargets);

  /*
   * The folded triage: on the iPhone Duo's outer display (the header in the status band, no fold divisions) the list
   * starts with the sessions that wait for the user, from the list's own scope: the classic list's computer, workspace
   * and Space, or every computer of the Unified list as its filter and search leave them (`triage/model.ts`). Only
   * while the screen is in front: it holds the waiting sessions' chats open (`triage/useTriageData.ts`).
   */
  const triageFolded = foldedOuterDisplay(headerPlacement.kind, foldDivisions);
  const triageWaits = useMemo((): TriageWait<MachineRecord>[] | null => {
    if (!triageFolded || machine === null || selectedSummary === null) return null;
    if (unified.on) {
      return unifiedTriageWaits(
        unified.view,
        machines,
        (machineId) => inventoriesByMachineId[machineId]?.summary ?? null,
      );
    }
    const scoped = filterSummaryForSpace(selectedSummary, selectedSpaceId);
    return triageSessions(scoped).map((session) => ({ machine, session, capabilities: scoped.capabilities }));
  }, [
    triageFolded,
    machine,
    selectedSummary,
    selectedSpaceId,
    unified.on,
    unified.view,
    machines,
    inventoriesByMachineId,
  ]);

  const showNotice = useCallback((next: Omit<Notice, 'id'>): void => {
    noticeCounter.current += 1;
    setNotice({ ...next, id: noticeCounter.current });
  }, []);

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
    placeItems,
    openAgentMenuAt,
    startNewSessionAt,
    closeAgentMenuThen,
    onAgentMenuDismissed,
    createCoordinator,
    loadCoordinatorOptions,
    loadCoordinatorDetails,
    loadCoordinatorPlaybook,
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
    attachCreated,
    runBulkSessionActions,
    runCreationFlow,
    runQuickAction,
    runSessionCommand,
    sessionsForProject,
    setOverlay,
    setTransientStatus,
  });

  /**
   * The header's New session (./sessions-screen/new-session-button.tsx): the project sheet, or,
   * with no project to list, Add computer, Add project, or why the list is empty.
   */
  const openNewSessionSheet = (): void => {
    const currentMachineId = machine?.id ?? '';
    if (projectChoicesNow(currentMachineId).length > 0) {
      setOverlay({ kind: 'newSessionProject', currentMachineId, purpose: 'start' });
      return;
    }
    const empty = newSessionEmptyList(newSessionComputersNow());
    if (empty.kind === 'addComputer') navigation.navigate('ConnectChoose');
    else if (empty.kind === 'addProject') openAddProject(currentMachineId);
    else setTransientStatus(empty.notice.message, { title: empty.notice.title });
  };

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

  /** Chief's row (contract/chief.ts): the selected computer's Chief, then the others it folds. */
  const chiefRowModels = useMemo(
    () =>
      machine === null
        ? []
        : chiefRows(
            machines.map((entry) => ({ id: entry.id, label: machineDisplayLabel(entry) })),
            Object.fromEntries(machines.map((entry) => [entry.id, inventoriesByMachineId[entry.id]?.summary ?? null])),
            machine.id,
          ),
    [machine, machines, inventoriesByMachineId],
  );
  /** The menu Chief's row opens: its first-open agent picker, or New Chat and Change Agent. */
  const [chiefMenu, setChiefMenu] = useState<{ title: string; items: ContextMenuItem[] } | null>(null);

  /** Runs `ghostex chief open|new-chat|set-agent` on `target` and opens the chat it answers with. */
  const runChief = useCallback(
    async (target: MachineRecord, command: string): Promise<void> => {
      setChiefMenu(null);
      setProgress(`Starting ${CHIEF_LABEL}…`);
      try {
        const result = await runGhostexCli(target, command);
        setProgress(null);
        const chief = (result.json as { chief?: { sessionId?: unknown } } | null)?.chief;
        if (typeof chief?.sessionId === 'string') await attachCreated(target, chief.sessionId);
        void refreshMachine(target);
      } catch (error) {
        setProgress(null);
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [attachCreated, refreshMachine, setTransientStatus],
  );

  /**
   * New Chat and Change Agent ask first while the computer's "Ask before New Chat" is on (CDXC:Chief 2026-11-08 in
   * server/src/chief/session.rs, Q1910); the dialog's Don't ask again turns it off on that computer.
   */
  const [chiefConfirm, setChiefConfirm] = useState<{
    target: MachineRecord;
    command: string;
    changeAgent: boolean;
    dontAskAgain: boolean;
  } | null>(null);
  const runChiefAsking = useCallback(
    (target: MachineRecord, command: string, changeAgent: boolean): void => {
      setChiefMenu(null);
      if (inventoriesByMachineId[target.id]?.summary?.chiefConfirmNewChat === false) {
        void runChief(target, command);
        return;
      }
      setChiefConfirm({ target, command, changeAgent, dontAskAgain: false });
    },
    [inventoriesByMachineId, runChief],
  );
  const answerChiefConfirm = useCallback(
    (start: boolean): void => {
      const pending = chiefConfirm;
      setChiefConfirm(null);
      if (pending === null || !start) return;
      if (pending.dontAskAgain) {
        void runGhostexCli(pending.target, chiefStopAskingCommand())
          .then(() => refreshMachine(pending.target))
          .catch(() => {});
      }
      void runChief(pending.target, pending.command);
    },
    [chiefConfirm, refreshMachine, runChief],
  );

  /** The agents Chief can run on, as menu rows that run `command(agentId)`. */
  const chiefAgentItems = useCallback(
    async (
      target: MachineRecord,
      command: (agentId: string) => string,
      current: string,
    ): Promise<ContextMenuItem[]> => {
      const status = await runGhostexCli(target, chiefStatusCommand());
      return parseChiefAgents(status.json).map((agent): ContextMenuItem => ({
        kind: 'item',
        key: `chief-agent-${agent.agentId}`,
        label: agent.name,
        selected: agent.agentId === current,
        onPress: () => void runChief(target, command(agent.agentId)),
      }));
    },
    [runChief],
  );

  /** First open: which agent runs Chief (Q1740). */
  const openChiefPicker = useCallback(
    async (target: MachineRecord): Promise<void> => {
      try {
        const items = await chiefAgentItems(target, chiefOpenCommand, '');
        if (items.length === 0) {
          setTransientStatus(
            `No agent can run ${CHIEF_LABEL} yet. Set up Claude, Codex or another coordinator agent first.`,
          );
          return;
        }
        setChiefMenu({ title: `Which agent runs ${CHIEF_LABEL}?`, items: [...MAIN_HUB_NOTES, ...items] });
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [chiefAgentItems, setTransientStatus],
  );

  /** Chief of Staff's long press: New Chat, Change Agent's agents, then (`more`) the row's own session options. */
  const openChiefMenu = useCallback(
    async (
      target: MachineRecord,
      row: ChiefRowModel & { session: GhostexSession },
      more?: () => void,
    ): Promise<void> => {
      let agents: ContextMenuItem[] = [];
      try {
        agents = (await chiefAgentItems(target, chiefSetAgentCommand, row.session.agent)).map((item) =>
          item.kind === 'item' && item.key.startsWith('chief-agent-')
            ? {
                ...item,
                onPress: () =>
                  runChiefAsking(target, chiefSetAgentCommand(item.key.slice('chief-agent-'.length)), true),
              }
            : item,
        );
      } catch {
        // New Chat still works without the agent list.
      }
      const heading: ContextMenuItem = { kind: 'heading', key: 'chief-agent-heading', label: 'Change Agent' };
      setChiefMenu({
        title: row.machineId === machine?.id ? CHIEF_LABEL : `${CHIEF_LABEL} · ${row.machineLabel}`,
        items: [
          {
            kind: 'item',
            key: 'chief-new-chat',
            label: 'New Chat',
            onPress: () => runChiefAsking(target, chiefNewChatCommand(), false),
          },
          ...(agents.length > 0 ? [heading, ...agents] : []),
          ...(more !== undefined
            ? [
                { kind: 'separator', key: 'chief-more-separator' } as ContextMenuItem,
                {
                  kind: 'item',
                  key: 'chief-more',
                  label: 'Session options…',
                  onPress: () => {
                    setChiefMenu(null);
                    more();
                  },
                } as ContextMenuItem,
              ]
            : []),
        ],
      });
    },
    [chiefAgentItems, machine?.id, runChiefAsking],
  );

  /** Main Hub's GBots: their menus, the remove confirm, GBot Settings and New GBot (use-gbots.tsx). */
  const showVoice = useCallback(() => navigation.navigate('Voice'), [navigation]);
  const gbots = useGbots({ machineById, attachCreated, refreshMachine, setProgress, setTransientStatus, showVoice });

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
        (target) => {
          const sessionOptions = () =>
            setOverlay({ kind: 'sessionMenu', ctx: { machine: target, item }, menuPath: [] });
          // Chief of Staff's row starts with its own New Chat and Change Agent (CDXC:Chief 2026-11-08 in contract/chief.ts).
          if (item.session.isChief) {
            const label = machines.find((entry) => entry.id === machineId);
            void openChiefMenu(
              target,
              {
                machineId,
                machineLabel: label === undefined ? machineId : machineDisplayLabel(label),
                session: item.session,
              },
              sessionOptions,
            );
            return;
          }
          sessionOptions();
        },
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
    openHomeChief: (machineId) => withMachine(machineId, (target) => void openChiefPicker(target)),
    homeMenu: (machineId, header) =>
      withMachine(
        machineId,
        (target) =>
          setChiefMenu({
            title: HOME_LABEL,
            items: [
              ...MAIN_HUB_NOTES,
              ...((header.chief ?? null) === null && chiefOnIn(inventoriesByMachineId[machineId]?.summary)
                ? [
                    {
                      kind: 'item',
                      key: 'main-hub-start-chief',
                      label: `Start ${CHIEF_LABEL}`,
                      onPress: () => void openChiefPicker(target),
                    } as ContextMenuItem,
                  ]
                : []),
              ...gbots.homeMenuItems(target, inventoriesByMachineId[machineId]?.summary, () => setChiefMenu(null)),
              {
                kind: 'item',
                key: 'main-hub-project-options',
                label: 'Project options…',
                onPress: () => {
                  setChiefMenu(null);
                  setOverlay({ kind: 'projectMenu', ctx: { machine: target, header }, menuPath: [] });
                },
              },
            ],
          }),
        true,
      ),
    stateCard: (machineId) => setOverlay({ kind: 'recovery', machine: machineById(machineId) }),
    workChipActions: (machineId, item) => workChipActions(machineById(machineId), item.session),
    toggleGbotsHeading: (machineId, headingKey) => collapse.toggleSessionKind(machineId, headingKey),
    toggleGbot: (machineId, bot) => collapse.toggleProject(machineId, bot.projectKey),
    gbotsHeadingMenu: (machineId) => gbots.openHeadingMenu(machineId),
    gbotsDepartmentMenu: (machineId, department) => gbots.openDepartmentMenu(machineId, department),
    gbotMenu: (machineId, bot, anchor) => gbots.openBotMenu(machineId, bot, anchor),
    gbotNewChat: (machineId, bot) => gbots.newChatFor(machineId, bot),
  };

  const listRefreshControl = (
    <RefreshControl
      colors={[GhostexPalette.ACCENT]}
      tintColor={sidebarAppearance.mutedGlyph}
      progressBackgroundColor={sidebarAppearance.background}
      refreshing={pullRefreshing}
      onRefresh={pullRefresh}
    />
  );
  // Dark draws the hint in its light grey at 72%; light takes the text ink, since the muted ink at 72% fades into the page.
  const listFooter = (
    <Text style={[styles.longPressHint, listInk.light ? { color: listInk.text } : null]} numberOfLines={1}>
      Long-press any item for more options.
    </Text>
  );
  // Above the classic and the Unified list alike; a card's head opens its session through the row's own `attach`.
  const triageHeader =
    triageWaits !== null && isFocused ? (
      <TriageSection
        waiting={triageWaits}
        appearance={sidebarAppearance}
        onOpen={(target, session) => withMachine(target.id, (saved) => void attach(saved, session))}
        onNotice={showNotice}
      />
    ) : undefined;

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
      // The machine notice's line above the search row says these two.
      hideStateCard={(item) =>
        (item.variant === 'failure' || item.variant === 'connecting') && machineById(block.machineId) !== null
      }
      actions={blockActions}
      tileColumns={tileColumns}
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
  // The header keeps only the title, the notifications bell and this menu button (Voice, Search, Web and
  // Machines stand in the bottom bar, CDXC:Sessions 2026-10-27). On the iPhone Duo the status band holds the
  // same row. In the side bar (a system that stands one) the bell and the menu stand there as its entries. On the
  // iPhone Duo's inner display the list/tiles switch stands before the bell, in the side bar as two switch entries.
  // The bell opens the attention list with the number of sessions that need the user.
  const newSessionButton = (
    <NewSessionButton color={sidebarAppearance.foreground} style={styles.headerButton} onPress={openNewSessionSheet} />
  );
  const bellButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bellLabel(needsYou)}
      style={styles.headerButton}
      onPress={() => navigation.navigate('AttentionList')}
    >
      <BellWithCount size={22} color={sidebarAppearance.foreground} count={needsYou} />
    </Pressable>
  );
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
  // The rail keeps one entry while the handler reads each committed render's stores.
  const openNewSessionRef = useRef(openNewSessionSheet);
  useEffect(() => {
    openNewSessionRef.current = openNewSessionSheet;
  });
  // Memoized on the header's inputs, so unrelated list updates do not republish the side bar.
  const railButtons = useMemo<RailButtons>(() => {
    const color = sidebarAppearance.foreground;
    const entries: RailEntry[] = [
      // Upright in the side bar, the list/tiles switch's two halves (the session wall design).
      ...(wallOffered
        ? [
            {
              key: 'wallList',
              label: WallCopy.showList,
              icon: (size: number) => <ListGlyph size={size} color={color} />,
              onPress: () => chooseListView('list'),
              selected: sessionListView === 'list',
            },
            {
              key: 'wallTiles',
              label: WallCopy.showTiles,
              icon: (size: number) => <TilesGlyph size={size} color={color} />,
              onPress: () => chooseListView('tiles'),
              selected: sessionListView === 'tiles',
            },
          ]
        : []),
      {
        key: 'newSession',
        label: NewSessionCopy.button,
        icon: (size) => <EditGlyph size={size} color={color} />,
        onPress: () => openNewSessionRef.current(),
      },
      {
        key: 'notifications',
        label: bellLabel(needsYou),
        icon: (size) => <BellWithCount size={size} color={color} count={needsYou} />,
        onPress: () => navigation.navigate('AttentionList'),
      },
      {
        key: 'more',
        label: DuoChromeCopy.more,
        icon: (size) => <MenuGlyph size={size} color={color} />,
        onPress: (anchor) => setOverlay({ kind: 'appMenu', anchor }),
      },
    ];
    // The session search sheet and the rename and note dialogs take the keyboard.
    return { entries, pinned: 0, moreMenu: 'always', reserveKeyboard: true };
  }, [sidebarAppearance.foreground, needsYou, navigation, wallOffered, sessionListView, chooseListView]);
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
        {wallOffered && !inRail ? (
          <WallSwitch view={sessionListView} appearance={sidebarAppearance} onChange={chooseListView} />
        ) : null}
        {/* Shown only while there is an update to take, in the side bar's poses too (CDXC:Updates 2026-11-12). */}
        <UpdateButton />
        {inRail ? null : newSessionButton}
        {inRail ? null : bellButton}
        {inRail ? null : moreButton}
      </View>
      {machineTabsVisible(unified.on, machines.length) ? (
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
      {machine !== null ? (
        <JustPairedLine
          machineId={machine.id}
          name={machineDisplayLabel(machine)}
          inventory={selectedInventory}
          appearance={sidebarAppearance}
        />
      ) : null}
      {machine !== null && isDemoMachine(machine) ? (
        <View
          accessibilityRole="text"
          style={{
            marginTop: 8,
            marginHorizontal: 16,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: sidebarAppearance.card,
          }}
        >
          <Text style={{ color: sidebarAppearance.muted, fontSize: 13, lineHeight: 18 }}>{DemoCopy.banner}</Text>
        </View>
      ) : null}
      {tailscaleApplies && tailscaleReminder && tailscaleConnected === false && !computerReachable ? (
        <View style={styles.tailscaleWarning}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tailscale is not connected. Open Tailscale"
            style={styles.tailscaleWarningMain}
            onPress={() => void openTailscaleOrDownload()}
          >
            <WarningTriangleIcon size={18} color={GhostexPalette.STATUS_WORKING} />
            <View style={styles.tailscaleWarningCopy}>
              <Text style={[styles.tailscaleWarningTitle, listInk.light ? { color: listInk.text } : null]}>
                Tailscale isn’t connected
              </Text>
              <Text style={[styles.tailscaleWarningBody, listInk.light ? { color: tailscaleNoticeMuted } : null]}>
                Tap to open Tailscale and reconnect.
              </Text>
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Hide the Tailscale notice"
            accessibilityHint="Turn it back on in Settings, Connection"
            hitSlop={10}
            style={styles.tailscaleWarningClose}
            onPress={() => setSetting('tailscaleReminder', false)}
          >
            <CloseIcon size={16} color={listInk.light ? tailscaleNoticeMuted : GhostexPalette.MUTED} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.statusRow}>
        {shownNotices.length > 0 ? (
          <View style={styles.statusPressable}>
            <MachineNoticeLine
              entries={shownNotices}
              now={noticeNow}
              open={noticeOpen}
              appearance={sidebarAppearance}
              onToggle={() => setNoticeOpen((current) => !current)}
            />
          </View>
        ) : (
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
        )}
        {tailscaleApplies && tailscaleConnected === true ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Tailscale connected"
            hitSlop={8}
            style={styles.tailscaleIndicator}
            onPress={() => void openTailscaleOrDownload()}
          >
            <Text style={[styles.tailscaleIndicatorLabel, { color: tailscaleConnectedInk }]}>• Tailscale</Text>
          </Pressable>
        ) : null}
      </View>
      {noticeOpen ? (
        <MachineNoticeDetails
          entries={shownNotices}
          now={noticeNow}
          appearance={sidebarAppearance}
          onRetry={(machineId) => {
            const target = machineById(machineId);
            if (target !== null) retryMachineWithStatus(target);
          }}
          onRemoteSettings={(machineId) => navigation.navigate('MachineForm', { machineId })}
          onLogs={() => setOverlay({ kind: 'logs' })}
        />
      ) : null}
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
      {machine !== null && !hasHomeProject(inventoriesByMachineId[machine.id]?.summary) ? (
        <ChiefRow
          rows={chiefRowModels}
          onOpen={(row) => withMachine(row.machineId, (target) => void attach(target, row.session))}
          onPickAgent={(machineId) => withMachine(machineId, (target) => void openChiefPicker(target))}
          onMenu={(row) => withMachine(row.machineId, (target) => void openChiefMenu(target, row), true)}
        />
      ) : null}
      {chiefMenu !== null ? (
        <ContextMenu visible title={chiefMenu.title} items={chiefMenu.items} onClose={() => setChiefMenu(null)} />
      ) : null}
      {gbots.overlays}
      {chiefConfirm !== null ? (
        <ConfirmDialog
          visible
          title={
            chiefConfirm.changeAgent ? `Move ${CHIEF_LABEL} to another agent?` : `Start a new chat with ${CHIEF_LABEL}?`
          }
          body={
            chiefConfirm.changeAgent
              ? `A new chat starts on that agent. This chat stays under ${CHIEF_LABEL} as an earlier chat, and its goal, memory and threads carry over.`
              : `This chat stays under ${CHIEF_LABEL} as an earlier chat. Its goal, memory and threads carry over to the new one.`
          }
          confirmLabel={chiefConfirm.changeAgent ? 'Change Agent' : 'New Chat'}
          checkbox={{
            label: "Don't ask again",
            checked: chiefConfirm.dontAskAgain,
            onToggle: () =>
              setChiefConfirm((current) =>
                current === null ? null : { ...current, dontAskAgain: !current.dontAskAgain },
              ),
          }}
          onConfirm={() => answerChiefConfirm(true)}
          onCancel={() => answerChiefConfirm(false)}
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
      <View style={styles.listArea} onLayout={(event) => setListWidth(event.nativeEvent.layout.width)}>
        <SessionList
          unified={
            unified.on
              ? {
                  data: unified.items,
                  keyExtractor: unified.keyExtractor,
                  renderItem: unified.renderItem,
                  style: [styles.list, listEdges.scroll],
                  contentContainerStyle: [styles.listContent, listEdges.content],
                  refreshControl: listRefreshControl,
                  ListHeaderComponent: triageHeader,
                  ListFooterComponent: listFooter,
                }
              : null
          }
          classic={{
            data: visibleEntries.blocks,
            keyExtractor: (entry) => entry.listKey,
            renderItem: renderBlock,
            style: [styles.list, listEdges.scroll],
            contentContainerStyle: [styles.listContent, listEdges.content],
            refreshControl: listRefreshControl,
            ListHeaderComponent: triageHeader,
            ListFooterComponent: (
              <>
                {visibleEntries.emptyProjects > 0 ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => setShowAllProjects((showing) => !showing)}
                    style={styles.showAllProjects}
                  >
                    <Text style={[styles.showAllProjectsText, { color: inkWash(listInk, 0.55) }]}>
                      {showAllProjects
                        ? 'Hide projects without sessions'
                        : `Show all projects (${visibleEntries.emptyProjects} hidden)`}
                    </Text>
                  </Pressable>
                ) : null}
                {listFooter}
              </>
            ),
          }}
        />
        <NoticeToast notice={notice} bottom={12} />
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
          color={sidebarAppearance.foreground}
          size={20}
          activeFill={false}
          label="Voice"
          labelStyle={[styles.bottomLabel, { color: sidebarAppearance.foreground }]}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SessionSearchCopy.buttonLabel}
          style={({ pressed }) => [styles.bottomItem, pressed ? styles.bottomItemPressed : null]}
          onPress={() => setSessionSearchOpen(true)}
        >
          <SearchGlyph size={20} color={sidebarAppearance.foreground} />
          <Text style={[styles.bottomLabel, { color: sidebarAppearance.foreground }]}>Search</Text>
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
            <WorldGlyph size={20} color={sidebarAppearance.foreground} />
            <Text style={[styles.bottomLabel, { color: sidebarAppearance.foreground }]}>Web</Text>
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Machines"
          style={({ pressed }) => [styles.bottomItem, pressed ? styles.bottomItemPressed : null]}
          onPress={() => navigation.navigate('Machines')}
        >
          <MachinesGlyph size={20} color={sidebarAppearance.foreground} />
          <Text style={[styles.bottomLabel, { color: sidebarAppearance.foreground }]}>Machines</Text>
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
          items={
            unified.on
              ? [
                  {
                    kind: 'item' as const,
                    key: 'computers',
                    label: 'Computers',
                    onPress: () => setOverlay({ kind: 'machinePicker', purpose: 'select' }),
                  },
                  ...appMenuItems(machine),
                ]
              : appMenuItems(machine)
          }
          onClose={() => setOverlay(NONE)}
          anchor={appMenuAnchor}
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
        The agent menu's project row (a pick opens the menu again there) and the header's New session
        (a pick starts there); either runs once the sheet has gone (iOS).
      */}
      <ProjectPickerSheet
        visible={overlay.kind === 'newSessionProject'}
        title={
          overlay.kind === 'newSessionProject' && overlay.purpose === 'start'
            ? NewSessionCopy.sheetTitle
            : 'Choose a project'
        }
        choices={overlay.kind === 'newSessionProject' ? projectChoicesNow(overlay.currentMachineId) : []}
        onClose={() => setOverlay(NONE)}
        onDismissed={() => {
          const work = afterProjectSheet.current;
          afterProjectSheet.current = null;
          work?.();
        }}
        onPick={(choice, machineIndex) => {
          const machine = choice.machines[machineIndex];
          const purpose = overlay.kind === 'newSessionProject' ? overlay.purpose : 'agentMenu';
          setOverlay(NONE);
          if (machine === undefined) return;
          const work = (): void =>
            purpose === 'start'
              ? startNewSessionAt({
                  machineId: machine.machineId,
                  projectId: machine.projectId,
                  connected: machine.connected,
                  label: machine.label,
                })
              : openAgentMenuAt(machine);
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
          loadOptions={() => loadCoordinatorOptions(overlay.ctx)}
          onCreate={(input, stillOpen) => createCoordinator(overlay.ctx, input, stillOpen)}
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
        <CoordinatorPlaybookSheet load={() => loadCoordinatorPlaybook(overlay.ctx)} onClose={() => setOverlay(NONE)} />
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
