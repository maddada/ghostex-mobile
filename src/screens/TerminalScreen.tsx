/**
 * Terminal screen (docs/specs/terminal-screen.md).
 * - In-screen header (native nav bar hidden here) with the tabs bar embedded
 *   between the back and overflow buttons (no title text),
 *   native terminal surface for the SELECTED tab only (the native registry
 *   keeps other warm entries alive across view detach), state overlays,
 *   on iOS the floating Befehlspad (command pad) with its Keys/Agent layers in the
 *   keyboard's place and the text editor above the soft keyboard (or, with the
 *   pad switched off, the round upload button), on Android the key
 *   accessory/editor bar above the soft keyboard, floating keyboard/upload
 *   controls when the keyboard is hidden, and edge-swipe tab switching.
 * - Keyboard tracking: RN Keyboard events keep the terminal, the pad and the key bar
 *   above the IME. Android resizes the container by the measured overlap; on iOS
 *   the terminal keeps its size (so its grid and the pty stay put) and slides
 *   with the keyboard: the bottom row above what covers it (keyboard, editor or layer), the cursor row wins
 *   (`slidesWithKeyboard`).
 * - Laptop pose (iPhone Duo half folded, `laptopMode.ts`): with the keyboard or a pad layer up the terminal's
 *   visible part ends at the fold and the lower half is covered; the keyboard and the layers lie below the fold, the
 *   pad and the text editor above it (the open pad reaches below it only where the upper half is too short for it
 *   even reaching over the header). In chat view the transcript and the composer end above the fold, keyboard up
 *   or not.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexNative, GhostexTerminalView } from '../../modules/ghostex-native/src';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import { useKeyboardState, useKeyboardTop } from '../components/common/keyboard/keyboardFrame';
import { measureInWindow } from '../components/common/measureInWindow';
import { useLaptopFold } from '../components/common/verticalBar/laptopFold';
import { bandRowFrame, foldUpperHalfInset, LAPTOP_CONTROL_CLEAR } from '../components/common/verticalBar/layout';
import {
  barBackgroundToEdges,
  railMenuItems,
  useContentTop,
  useHeaderPlacement,
  useHeaderMenu,
  useBandOverflow,
  useRailButtons,
  useRailOverflow,
  useFoldDivisions,
  useVerticalBarSpace,
  type RailButtons,
} from '../components/common/verticalBar/VerticalBarArea';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import CommandPad from '../components/terminal/CommandPad';
import CommandPadLayer from '../components/terminal/CommandPadLayer';
import EdgeSwipeZones from '../components/terminal/EdgeSwipeZones';
import ExportTranscriptSheet from '../components/terminal/ExportTranscriptSheet';
import KeyBarDock from '../components/terminal/KeyBarDock';
import PromptEditorSheet from '../components/terminal/PromptEditorSheet';
import TerminalFloatingControls from '../components/terminal/TerminalFloatingControls';
import TerminalKeyBar from '../components/terminal/TerminalKeyBar';
import TerminalMenu, { type TerminalMenuActionId } from '../components/terminal/TerminalMenu';
import TerminalSkillsMenu from '../components/terminal/TerminalSkillsMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar, { MIN_TAB_WIDTH } from '../components/terminal/TerminalTabsBar';
import TerminalTextEditor, { TEXT_EDITOR_HEIGHT } from '../components/terminal/TerminalTextEditor';
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  PanesIcon,
  TerminalPromptIcon,
} from '../components/terminal/icons';
import { PAD_MARGIN, PAD_TOGGLE, padAnchor, padHeaderReach } from '../components/terminal/commandPadLayout';
import {
  laptopEditorInset,
  laptopFloatingBottom,
  laptopLayerHeight,
  laptopObstruction,
  laptopPadArea,
  laptopPadCover,
  laptopPadReachBelowFold,
  laptopPadRoomBelowFold,
} from '../components/terminal/laptopMode';
import { terminalObstruction, terminalSlideOffset } from '../components/terminal/terminalKeyboardSlide';
import { useCommandPad } from '../components/terminal/useCommandPad';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import { isSessionChatSupportedAgent } from '../chat/session-chat-helpers';
import SessionChatSurface from '../demo/SessionChatSurface';
import DemoTerminalView from '../demo/DemoTerminalView';
import { isDemoMachineId } from '../demo/identity';
import SessionLinksSheet from '../chat/native/SessionLinksSheet';
import { useSessionLinksRefresh } from '../chat/native/useSessionLinksRefresh';
import { useTranscriptTheme } from '../chat/native/transcript/theme';
import { DuoChromeCopy, PanesCopy, RenameCopy, SessionCopy, TerminalHeaderCopy } from '../copy';
import { summarizeFailure } from '../inventory/client';
import { hasPassword } from '../machines/credentials';
import { useInventoryStore } from '../inventory/store';
import { sessionNotesOnIn } from '../sessions/sessionNotesSwitch';
import type { RootStackParamList } from '../navigation/types';
import { contextSessionFor } from '../files/sessionContext';
import { FORK_AGENT_ICONS, renameInitialTitle } from '../sessions/sessionCommands';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { setChatGridSessionKey } from '../terminal/chatGridClaim';
import { setMountedSessionKeys } from '../terminal/zmxDisplay';
import { GhostexPalette } from '../theme/palette';
import { useStatusBarStyle } from '../theme/statusBar';
import { terminalChrome } from '../theme/terminalColours';
import { useTerminalColours } from '../theme/useTerminalColours';
import { useAppearance } from '../theme/useAppearance';
import { useMachinesStore } from '../machines/store';
import { VoiceButton } from '../voice/VoiceButton';
import { readAloudChatKey, setReadAloudOnScreen } from '../voice/readAloud';
import { useOpenMachineLink } from '../webPreview/useOpenMachineLink';
import type { PaneArrangement } from '../panes/layout';
import PaneContentView from '../panes/PaneContentView';
import PaneHost from '../panes/PaneHost';
import { usePaneStore } from '../panes/store';
import { usePaneHost } from '../panes/usePaneHost';
import { paneLayoutInput, useTerminalPanes, type PaneQuestion } from '../panes/useTerminalPanes';
import {
  AGENT_OVERLAY_NONE,
  ANDROID_KEYBOARD_GAP,
  HEADER_HEIGHT,
  HEADER_PADDING,
  sessionAgentIdFor,
  sessionProjectIdFor,
  sessionRecordFor,
  useMachineTarget,
  TAP_KEYBOARD_HINT_TIMEOUT_MS,
  tabChatCapable,
  type AgentOverlay,
  type ExportedTranscript,
} from './terminal-screen/session-lookups';
import { styles } from './terminal-screen/styles';
import { useTerminalAgentActions } from './terminal-screen/use-agent-actions';
import { boxMachineRecord, useCloudBoxesStore } from '../cloudBoxes/store';
import { boxIdOfMachine } from '../cloudBoxes/types';
import CloudBoxPill from '../components/terminal/CloudBoxPill';
import CoordinatorPlaybookSheet, { loadCoordinatorPlaybook } from './sessions-screen/CoordinatorPlaybookSheet';
import type { MachineConnectionTarget } from '../machines/credentials';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

/** The header buttons of the status band's row: 44 pt wide, side by side (`headerButton`). */
const TERMINAL_BAND_BUTTONS = { size: 44, gap: 0 } as const;

/** The tab strip's margin from a screen edge with no header button beside it (the chat box's own side margin). */
const TABS_EDGE_MARGIN = 10;

/** The native chat's More actions rows this screen performs (the terminal menu's own actions). */
const NATIVE_CHAT_HOST_ACTIONS: readonly string[] = [
  'rename',
  'sleep',
  'delayedActions',
  'closeAfterDone',
  'fork',
  'fullReload',
  'exportTranscript',
];
const NO_NATIVE_CHAT_HOST_ACTIONS: readonly string[] = [];
/** A coordinator's chat also serves View playbook (the sheet its long-press menu opens). */
const COORDINATOR_CHAT_HOST_ACTIONS: readonly string[] = [...NATIVE_CHAT_HOST_ACTIONS, 'viewPlaybook'];

/**
 * The rows the chat's top bar menu held, now the chat's More actions rows (`moreActionsRows`, which records the
 * user's decision): each served only where the top bar menu enabled it, on the selected session's tab.
 */
function chatShellActions({
  agentActions,
  project,
  session,
}: {
  agentActions: boolean;
  project: boolean;
  session: boolean;
}): string[] {
  return [
    ...(agentActions ? ['promptEditor'] : []),
    ...(project ? ['docs', 'changes'] : []),
    'newTerminal',
    'settings',
    'disconnect',
    ...(session ? ['killSession'] : []),
  ];
}

export default function TerminalScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const headerPlacement = useHeaderPlacement();
  const tabs = useTerminalStore((state) => state.tabs);
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const openShellTab = useTerminalStore((state) => state.openShellTab);
  const settings = useSettingsStore((state) => state.settings);

  const isFocused = useIsFocused();
  const [tapKeyboardHint, setTapKeyboardHint] = useState(false);
  // The "More options" menu; on the iPhone Duo at its button as it is now.
  const {
    visible: menuVisible,
    setVisible: setMenuVisible,
    open: openMenu,
    buttonRef: moreButtonRef,
    anchor: menuAnchor,
  } = useHeaderMenu();
  const contentTop = useContentTop();
  const bar = useVerticalBarSpace();
  // Each pick of the menu's Search Conversation row opens the chat screen's own
  // search box; the screen has no search button of its own.
  const [chatSearchRequestId, setChatSearchRequestId] = useState(0);
  const [chatSessionNoteRequestId, setChatSessionNoteRequestId] = useState(0);
  const [agentOverlay, setAgentOverlay] = useState<AgentOverlay>(AGENT_OVERLAY_NONE);
  // The coordinator playbook a chat's More sheet opened (`CoordinatorPlaybookSheet`), or null.
  const [playbook, setPlaybook] = useState<{ machine: MachineConnectionTarget; projectId: string } | null>(null);
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [exportedTranscript, setExportedTranscript] = useState<ExportedTranscript | null>(null);
  const [startingTranscriptConversation, setStartingTranscriptConversation] = useState(false);
  const [exportedTranscriptError, setExportedTranscriptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [keyboardOcclusionCorrection, setKeyboardOcclusionCorrection] = useState(0);
  const bottomEdgeFrameRef = useRef<ViewInstance>(null);
  // The iOS terminal's cursor row, which decides how far it slides with the keyboard (below), and the terminal
  // area's frame (its height for the slide; its size for where the pad may stand, its top for the header above it).
  const [caretTop, setCaretTop] = useState<number | null>(null);
  const [terminalArea, setTerminalArea] = useState<LayoutRectangle | null>(null);
  const onTerminalAreaLayout = useCallback((event: LayoutChangeEvent): void => {
    const { x, y, width, height } = event.nativeEvent.layout;
    setTerminalArea((area) =>
      area?.x === x && area.y === y && area.width === width && area.height === height ? area : { x, y, width, height },
    );
  }, []);
  // What covers the terminal's bottom besides the keyboard: the text editor on it, or a pad layer in its place.
  const [editorHeight, setEditorHeight] = useState(0);
  const [layerHeight, setLayerHeight] = useState(0);
  /** Session keys already auto-focused this visit (hide-keyboard-on-startup off). */
  const autoFocusedSessionsRef = useRef<Set<string>>(new Set());

  const openMachineLink = useOpenMachineLink();
  const activeTab = tabs.find((tab) => tab.sessionKey === selectedSessionKey) ?? null;
  // Whether the active tab's computer has a saved SSH password, so a failed connection names the
  // right fix (it always claimed a saved password was rejected; CDXC:Notices 2026-11-06, Q1415).
  const activeMachineId = activeTab?.machineId ?? null;
  const [activeMachineHasPassword, setActiveMachineHasPassword] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setActiveMachineHasPassword(false);
    if (activeMachineId === null) return undefined;
    hasPassword(activeMachineId).then(
      (saved) => {
        if (!cancelled) setActiveMachineHasPassword(saved);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [activeMachineId]);
  const activeSavedMachine = useMachinesStore((state) =>
    activeTab === null ? null : (state.machines.find((entry) => entry.id === activeTab.machineId) ?? null),
  );
  // A Cloud Box session's tab is on the box's hidden machine, which is never saved (cloudBoxes/store.ts).
  const activeBoxEntry = useCloudBoxesStore((state) =>
    activeTab === null ? null : (state.entries[boxIdOfMachine(activeTab.machineId) ?? ''] ?? null),
  );
  const activeMachine = useMemo(
    () => activeSavedMachine ?? (activeBoxEntry === null ? null : boxMachineRecord(activeBoxEntry)),
    [activeSavedMachine, activeBoxEntry],
  );
  const activeAgentId = useInventoryStore((state) =>
    sessionAgentIdFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  const activeProjectId = useInventoryStore((state) =>
    sessionProjectIdFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  // The project's folder and name, for the menu's Docs row.
  const activeProject = useInventoryStore((state) =>
    activeTab === null || activeProjectId.length === 0
      ? null
      : (state.inventoriesByMachineId[activeTab.machineId]?.summary?.projects.find(
          (project) => project.projectId === activeProjectId,
        ) ?? null),
  );
  const activeSession = useInventoryStore((state) =>
    sessionRecordFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  // Session Note in the menu and the chat's More actions only while the computer has Session notes on.
  const sessionNotesOn = useInventoryStore((state) =>
    activeTab === null ? true : sessionNotesOnIn(state.inventoriesByMachineId[activeTab.machineId]?.summary),
  );
  const sessionViewModeBySessionKey = useTerminalStore((state) => state.sessionViewModeBySessionKey);
  const sessionLinkOpenTarget = useInventoryStore((state) =>
    activeTab === null
      ? 'embedded'
      : (state.inventoriesByMachineId[activeTab.machineId]?.summary?.sessionLinkOpenTarget ?? 'embedded'),
  );
  // The session's links sheet, which the chat's Links pill opens (CDXC:SessionLinks 2026-10-28 in
  // gx-core `sidebar_view/links.rs`: the pill replaced the strip under the chat's header).
  const [linksSheetVisible, setLinksSheetVisible] = useState(false);

  // Agent Actions apply to a gxserver session, so shell tabs and tabs whose
  // session identity has not resolved yet do not get the button at all.
  const agentActionsCapable =
    activeTab !== null &&
    activeTab.kind === 'attach' &&
    activeTab.ghostexSessionId !== undefined &&
    activeProjectId.length > 0;

  // Chat/terminal toggle (per tab): only agent sessions with a chat projection and a resolved (projectId, sessionId)
  // identity offer it (`tabChatCapable`).
  const chatCapable = useInventoryStore((state) =>
    tabChatCapable(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  // The selected session's saved view (its tab's, else the Default Agent View setting): what one content area shows.
  const savedChatMode =
    chatCapable &&
    activeTab !== null &&
    (sessionViewModeBySessionKey[activeTab.sessionKey] ?? settings.preferredAgentInterface) === 'chat';

  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // The iPhone Duo half folded like a laptop (`laptopMode.ts`): the output above the fold, the keyboard and the pad's
  // layers below it, the pad in the upper half. Null in every other pose, on every other iPhone and on Android.
  const foldShown = useLaptopFold();
  // Two panes (`src/panes/`): where the window has pane slots (the iPhone Duo's inner display, whose window has the
  // fold's divisions; folded, on other iPhones and on Android it has none) and the selected tab is an agent session, in
  // the terminal and in the chat view alike, except while a question opened from the attention
  // list pane stands full screen, when not even the Panes button is there. A question a link opened (a
  // notification, the Notifications screen) stands full screen too, the Panes button bringing the panes back.
  // Side by side across and half folded like a laptop, one above the other upright.
  // selected session is a pane's, so the keyboard, the pad, the editor and Upload go to it unchanged.
  const foldDivisions = useFoldDivisions();
  const hasPaneSlots = (foldDivisions?.length ?? 0) > 0;
  const [paneQuestion, setPaneQuestion] = useState<PaneQuestion | null>(null);
  const panesAvailable = Platform.OS === 'ios' && hasPaneSlots && activeTab?.kind === 'attach' && paneQuestion === null;
  // The question's chat view stands while its session stays selected in its chat view (`usePaneStore`'s questionHold).
  const questionHold = usePaneStore((state) => state.questionHold);
  const questionStands = questionHold !== null && questionHold === activeTab?.sessionKey && savedChatMode;
  useEffect(() => {
    if (questionHold !== null && !questionStands) usePaneStore.getState().setQuestionHold(null);
  }, [questionHold, questionStands]);
  const panesOffered = panesAvailable && !questionStands;
  const paneArrangement: PaneArrangement = foldShown !== null || windowWidth > windowHeight ? 'sideBySide' : 'stacked';
  const panes = usePaneHost({ offered: panesOffered, arrangement: paneArrangement });
  const twoPanes = panes.display.kind === 'panes' ? panes.display : null;
  const showsPanes = twoPanes !== null;
  const setPaneChat = panes.setChatSession;
  // The session pane showing its chat view (one at most, the panes' own choice, never saved), or null.
  const paneChatKey = twoPanes === null ? null : panes.chatSessionKey;
  // The selected session shows its chat view: with two panes in its pane, with one as its saved view says.
  const chatModeActive = twoPanes === null ? savedChatMode : activeTab !== null && paneChatKey === activeTab.sessionKey;
  // The chat on screen: the one in a pane, else the selected session's (mounted hidden while its terminal shows).
  const chatTab = paneChatKey === null ? activeTab : (tabs.find((tab) => tab.sessionKey === paneChatKey) ?? null);
  const chatProjectId = useInventoryStore((state) =>
    sessionProjectIdFor(
      chatTab,
      chatTab === null ? undefined : state.inventoriesByMachineId[chatTab.machineId]?.summary,
    ),
  );
  const chatSession = useInventoryStore((state) =>
    sessionRecordFor(chatTab, chatTab === null ? undefined : state.inventoriesByMachineId[chatTab.machineId]?.summary),
  );
  const chatMachine = useMachinesStore((state) =>
    chatTab === null ? null : (state.machines.find((entry) => entry.id === chatTab.machineId) ?? null),
  );
  const chatMachineTarget = useMachineTarget(chatCapable && activeTab !== null ? activeTab.machineId : null);
  useSessionLinksRefresh(
    chatMachine,
    chatSession?.sessionId,
    twoPanes === null ? chatModeActive : paneChatKey !== null,
  );
  // iOS terminal mode: the terminal view keeps its size, so its grid and the pty stay put, and slides with
  // the keyboard instead (terminal-screen.md §2), on every iPhone (decision Q761 in terminalKeyboardSlide.ts).
  // With two panes the panes take the keyboard so, whatever the active one shows: a chat in a pane ends where its pane
  // does and lifts nothing itself. The one place that decides it.
  const slidesWithKeyboard = Platform.OS === 'ios' && (twoPanes !== null || !chatModeActive);
  const mountedTerminalSessionKey = activeTab !== null && !chatModeActive && isFocused ? activeTab.sessionKey : null;
  const { keyboardVisible, bottomInset, visibleWindowBottom, hideMotionMs } = useKeyboardMetrics({
    slides: slidesWithKeyboard,
    // Summoned while scrolled back (keyboard button, tap, focus): show the input area, with the keyboard.
    // Not on a frame change while it is up: a user who scrolls back with the keyboard open stays there.
    onAppear: () => {
      // Only the terminal on screen: a retained terminal behind another screen keeps its scrollback.
      const sessionKey = mountedTerminalSessionKey;
      if (sessionKey === null) return;
      void GhostexNative.scrollToBottom(sessionKey).catch((error: unknown) => {
        console.warn(`Terminal: scrolling to the input area failed for session ${sessionKey}.`, error);
      });
    },
  });

  // The chat view on screen, for the zmx display policy below (the terminals on screen are the panes' too).
  const mountedChatSessionKey = !isFocused
    ? null
    : twoPanes !== null
      ? paneChatKey
      : activeTab !== null && chatModeActive
        ? activeTab.sessionKey
        : null;
  // A tab opened in Chat View has no terminal yet (`openChatTab`); showing its terminal attaches it.
  const activeTabDetached = activeTab?.state === 'detached';
  useEffect(() => {
    if (mountedTerminalSessionKey !== null && activeTabDetached) {
      void useTerminalStore.getState().ensureTerminalAttached(mountedTerminalSessionKey);
    }
  }, [mountedTerminalSessionKey, activeTabDetached]);
  // Read aloud speaks only the chat on screen, locked or not; leaving this screen leaves the chat.
  const readAloudKey =
    mountedChatSessionKey !== null && chatTab !== null && chatTab.ghostexSessionId !== undefined
      ? readAloudChatKey(chatTab.machineId, chatProjectId, chatTab.ghostexSessionId)
      : null;
  const readAloudTitle =
    chatSession !== null && chatSession.displayTitle.length > 0 ? chatSession.displayTitle : (chatTab?.title ?? '');
  useEffect(() => {
    setReadAloudOnScreen(
      readAloudKey === null || chatTab === null
        ? null
        : {
            key: readAloudKey,
            title: readAloudTitle,
            machineId: chatTab.machineId,
            sessionId: chatTab.ghostexSessionId ?? '',
          },
    );
    // The tab object changes on every store update; the key and the title are what matter.
  }, [readAloudKey, readAloudTitle]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      setMountedSessionKeys(null, null);
      setChatGridSessionKey(null);
      setReadAloudOnScreen(null);
    },
    [],
  );

  /*
   * CDXC:SessionChatPromptQueue 2026-08-21:
   * How many prompts are waiting in each session's Ghostex queue. The chat
   * page is mounted for the selected session even while the terminal is on
   * screen, and it already long-polls a read whose fingerprint moves on queue
   * changes, so it reports the count here instead of the app opening a second
   * polling channel over SSH. Missing (or 0) hides the button.
   */
  const [chatQueueCounts, setChatQueueCounts] = useState<Record<string, number>>({});
  const chatQueueSessionKey = activeTab?.sessionKey ?? null;
  const activeQueuedPromptCount = chatQueueSessionKey === null ? 0 : (chatQueueCounts[chatQueueSessionKey] ?? 0);
  const handleChatQueueCount = useCallback(
    (count: number): void => {
      if (chatQueueSessionKey === null) return;
      setChatQueueCounts((current) =>
        current[chatQueueSessionKey] === count ? current : { ...current, [chatQueueSessionKey]: count },
      );
    },
    [chatQueueSessionKey],
  );

  // The native nav bar has no styling guarantee here; render our own header.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Adopt the routed tab once; in-screen switching then owns selection.
  useEffect(() => {
    const store = useTerminalStore.getState();
    const routed = route.params.sessionKey;
    if (store.tabs.some((tab) => tab.sessionKey === routed) && store.selectedSessionKey !== routed) {
      store.selectTab(routed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the display awake only while this terminal screen is active.
  useEffect(() => {
    const keepAwake = isFocused && settings.keepScreenOn;
    void GhostexNative.setKeepScreenOn(keepAwake).catch(() => undefined);
    return () => {
      if (keepAwake) void GhostexNative.setKeepScreenOn(false).catch(() => undefined);
    };
  }, [isFocused, settings.keepScreenOn]);

  // Hide keyboard on startup OFF → explicitly focus a terminal once it opens,
  // at most once per session per visit (a deliberate dismissal stays dismissed).
  useEffect(() => {
    if (settings.hideKeyboardOnStartup || !isFocused) return;
    if (activeTab === null || activeTab.state !== 'open') return;
    if (autoFocusedSessionsRef.current.has(activeTab.sessionKey)) return;
    autoFocusedSessionsRef.current.add(activeTab.sessionKey);
    setTapKeyboardHint(true);
    void GhostexNative.focusTerminal(activeTab.sessionKey).catch(() => setTapKeyboardHint(false));
  }, [settings.hideKeyboardOnStartup, isFocused, activeTab]);

  /*
   * Android's reported keyboard height can fall short of what actually covers
   * the window (IME candidate/tool rows, gesture bar), so measure the screen's
   * own bottom edge — the extra-keys toolbar when it is up, the bottom spacer
   * otherwise — and fold the residual overlap into the container's padding.
   * Chat mode has no toolbar, which is why this measures the wrapper rather
   * than the toolbar itself: without it the composer's last few pixels sit
   * under the keyboard.
   */
  const reconcileBottomEdgeWithVisibleWindow = useCallback((): void => {
    if (!keyboardVisible || visibleWindowBottom === null) return;
    requestAnimationFrame(() => {
      bottomEdgeFrameRef.current?.measureInWindow((_x, y, _width, height) => {
        const signedOcclusion = y + height + ANDROID_KEYBOARD_GAP - visibleWindowBottom;
        if (Math.abs(signedOcclusion) < 0.5) return;
        setKeyboardOcclusionCorrection((current) => {
          const next = Math.max(0, Math.round((current + signedOcclusion) * 2) / 2);
          return Math.abs(next - current) < 0.5 ? current : next;
        });
      });
    });
  }, [keyboardVisible, visibleWindowBottom]);

  useEffect(() => {
    if (!keyboardVisible) {
      setKeyboardOcclusionCorrection(0);
      return;
    }
    reconcileBottomEdgeWithVisibleWindow();
  }, [keyboardVisible, reconcileBottomEdgeWithVisibleWindow, visibleWindowBottom]);

  const dismissKeyboard = useCallback((): void => {
    setTapKeyboardHint(false);
    const sessionKey = useTerminalStore.getState().selectedSessionKey;
    if (sessionKey !== null) void GhostexNative.blurTerminal(sessionKey).catch(() => undefined);
    Keyboard.dismiss();
  }, []);

  const showSessions = useCallback((): void => {
    dismissKeyboard();
    navigation.popTo('Sessions');
  }, [dismissKeyboard, navigation]);

  // Android Back always switches to Sessions and is never allowed to fall
  // through to the system app-exit behavior.
  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        showSessions();
        return true;
      });
      return () => subscription.remove();
    }, [showSessions]),
  );

  // No tabs left (last one closed) → leave the terminal screen.
  useEffect(() => {
    if (tabs.length === 0) showSessions();
  }, [tabs.length, showSessions]);

  const showKeyboard = useCallback((): void => {
    const sessionKey = useTerminalStore.getState().selectedSessionKey;
    if (sessionKey === null) return;
    setTapKeyboardHint(true);
    void GhostexNative.focusTerminal(sessionKey).catch(() => setTapKeyboardHint(false));
  }, []);

  // Android: the key bar in the flow, as before the pad.
  // Optimistic key-bar visibility from onSingleTap until keyboard events land.
  useEffect(() => {
    if (!tapKeyboardHint) return;
    if (keyboardVisible) {
      setTapKeyboardHint(false);
      return;
    }
    const timer = setTimeout(() => setTapKeyboardHint(false), TAP_KEYBOARD_HINT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [tapKeyboardHint, keyboardVisible]);

  const keyBarVisible = (keyboardVisible || tapKeyboardHint) && settings.extraKeysToolbarVisible;

  // The laptop pose where the terminal slides (`foldShown` above): with one content area not in chat view (the chat
  // has its own laptop layout, `chatFoldInset` below); with two panes always, which end above it whatever they show.
  const laptopFold = slidesWithKeyboard ? foldShown : null;
  const chatKeyboardUp = useKeyboardTop() !== null;
  // A pane without a terminal (browser, files, Git changes, agents, attention list, usage, a session's chat view) tapped
  // last is the active one: the pad's keys, the text editor and Upload would reach no terminal there, so they are not
  // shown (the approved panes mockup).
  const activePaneContent = twoPanes === null ? null : twoPanes.slots[twoPanes.active];
  const terminalPaneActive =
    twoPanes === null || (activePaneContent?.kind === 'session' && activePaneContent.sessionKey !== paneChatKey);
  // The Befehlspad: over the shown terminal while it is switched on, where the terminal slides with the keyboard
  // (iOS; never in chat view).
  const padSessionKey =
    settings.extraKeysToolbarVisible && activeTab !== null && slidesWithKeyboard && terminalPaneActive
      ? activeTab.sessionKey
      : null;
  // zmx display policy: the terminals on screen own their real grid (with two panes both, unless one shows its
  // session's chat), the chat view its own; none while another screen is on top.
  const mountedPaneSessionKey =
    twoPanes !== null && isFocused && panes.paneSessionKey !== paneChatKey ? panes.paneSessionKey : null;
  useEffect(() => {
    setMountedSessionKeys(mountedTerminalSessionKey, mountedChatSessionKey, mountedPaneSessionKey);
    setChatGridSessionKey(mountedChatSessionKey);
  }, [mountedTerminalSessionKey, mountedChatSessionKey, mountedPaneSessionKey]);
  // The pad's room: the terminal area within the window's safe area across (in landscape the area runs under the
  // screen's rounded corners and the camera), and the header above it where the open pad needs that (`padReach`).
  // In the laptop pose only the part above the fold.
  const padArea = useMemo(() => {
    if (terminalArea === null) return null;
    const left = Math.max(terminalArea.x, insets.left);
    const right = Math.min(terminalArea.x + terminalArea.width, windowWidth - insets.right);
    const area = { x: left, y: terminalArea.y, width: Math.max(0, right - left), height: terminalArea.height };
    return laptopFold === null ? area : laptopPadArea(area, laptopFold);
  }, [terminalArea, insets.left, insets.right, windowWidth, laptopFold]);
  // The header between the terminal area and the window's safe area: the open pad reaches over it where the area
  // alone is too short for it.
  const headerRoom = padArea === null ? 0 : Math.max(0, padArea.y - insets.top);
  // iOS: how much of the terminal's bottom the keyboard covers, with the text editor on it when `editorOpen`.
  const keyboardCover = (editorOpen: boolean): number =>
    terminalObstruction(bottomInset, editorOpen ? editorHeight || TEXT_EDITOR_HEIGHT : 0, insets.bottom);
  // How much of the pad room's bottom is covered while the keyboard is up, with the text editor when `editorOpen`:
  // in the laptop pose only the editor above the fold, as the keyboard lies below it.
  const padCoverWithKeyboard = (editorOpen: boolean): number =>
    laptopFold !== null
      ? laptopPadCover(editorOpen ? editorHeight || TEXT_EDITOR_HEIGHT : 0)
      : keyboardCover(editorOpen);
  // The toggle's lowest place while nothing covers the pad room: in the laptop pose a finger's width above the fold.
  const padFloor = laptopFold !== null ? LAPTOP_CONTROL_CLEAR : PAD_MARGIN;
  // Whether the open pad has room above the keyboard (and the editor when `editorOpen`), reaching over the header if
  // it must. In the laptop pose without the editor it always has: where the upper half is too short even over the
  // header, its room reaches below the fold (`padRoomBelowFold`), as lowering the keyboard below the fold adds none.
  const openPadFits = (editorOpen: boolean): boolean =>
    padArea === null ||
    (laptopFold !== null && !editorOpen) ||
    padHeaderReach(padArea, padCoverWithKeyboard(editorOpen), headerRoom, padFloor) !== null;
  // Whether the last render drew the open pad closed for a layer (`padGivesWay` below); the pad's state needs it
  // when the keyboard comes back, and the room it is read from depends on that state.
  const [padGaveWay, setPadGaveWay] = useState(false);
  // Each time the keyboard comes up from hidden (iOS; a turn or fold of a keyboard that is up is none): the person
  // asked for it, so the pad's room is judged at once then, also while a turn, fold or resize settles.
  const { appearances: keyboardAppearances } = useKeyboardState();
  const pad = useCommandPad({
    sessionKey: padSessionKey,
    agentId: activeAgentId,
    // The laptop pose has a place of its own.
    layout: laptopFold !== null ? 'laptop' : 'flat',
    keyboardVisible,
    keyboardOverlap: slidesWithKeyboard ? bottomInset : 0,
    windowWidth,
    showKeyboard,
    dismissKeyboard,
    padGaveWay,
    openPadFitsAboveKeyboard: openPadFits,
    // A turn, fold or resize reports these one by one; the pad's room is judged once they have settled (the
    // keyboard: `keyboardOverlap`, which a keyboard coming up does not move). Folding to or from the laptop pose
    // reports the fold.
    roomInputs: [
      windowWidth,
      windowHeight,
      insets.top,
      insets.bottom,
      insets.left,
      insets.right,
      terminalArea?.x ?? -1,
      terminalArea?.y ?? -1,
      terminalArea?.width ?? -1,
      terminalArea?.height ?? -1,
      laptopFold?.top ?? -1,
      laptopFold?.bottom ?? -1,
    ],
    keyboardAppearances,
  });
  const editorShown = padSessionKey !== null && pad.editorVisible;
  const layerShown = padSessionKey !== null && pad.layer !== null;
  // A layer in the keyboard's place: the keyboard's last height in this window (it scrolls inside), so the pad stays
  // put; before any keyboard was seen, its own height. In the laptop pose it never reaches the fold.
  const layerFrameHeight =
    laptopFold !== null ? laptopLayerHeight(laptopFold, windowHeight, pad.layerMinHeight) : pad.layerMinHeight;
  // iOS: the covered part of the terminal's bottom, the keyboard with the editor on it or a layer in its place. In
  // the laptop pose, keyboard up or not: everything below the fold (and the editor above it).
  const layerCover = layerShown ? (layerFrameHeight ?? layerHeight) - insets.bottom : 0;
  // The terminal area's bottom edge in the window: the home indicator's inset above the window's bottom until measured.
  const terminalAreaBottom =
    terminalArea === null ? windowHeight - insets.bottom : terminalArea.y + terminalArea.height;
  // In the laptop pose: how far the fold's top stands above the terminal area's bottom (0 in every other pose).
  const foldAboveAreaBottom = laptopFold === null ? 0 : Math.max(0, terminalAreaBottom - laptopFold.top);
  // The chat view in the laptop pose: with the keyboard down the transcript and the composer end above the fold, as
  // a web page does (`foldUpperHalfInset`), and the lower half stays empty; with the keyboard up the composer lifts
  // itself above the fold (`KeyboardLiftedView`). 0 in every other pose and in terminal view.
  const chatFoldInset = chatModeActive && !chatKeyboardUp ? foldUpperHalfInset(foldShown, terminalAreaBottom) : 0;
  const obstruction =
    laptopFold !== null
      ? laptopObstruction({
          fold: laptopFold,
          areaBottom: terminalAreaBottom,
          keyboardCover: keyboardCover(false),
          layerCover,
          editorHeight: editorShown ? editorHeight || TEXT_EDITOR_HEIGHT : 0,
        })
      : slidesWithKeyboard
        ? Math.max(keyboardCover(editorShown), layerCover)
        : 0;
  // The laptop pose's cover across the window: with two panes without the text editor, which stands over the active
  // pane only and ends that pane's terminal above it (`paneLayoutInput`), so the other pane keeps all its output.
  const laptopCover =
    laptopFold !== null && twoPanes !== null
      ? laptopObstruction({
          fold: laptopFold,
          areaBottom: terminalAreaBottom,
          keyboardCover: keyboardCover(false),
          layerCover,
          editorHeight: 0,
        })
      : obstruction;
  const terminalOffset = terminalSlideOffset(caretTop, terminalArea?.height ?? 0, obstruction);
  const panesUpright = paneArrangement === 'stacked';
  const { paneLayout, editorDockFrame } = paneLayoutInput({
    twoPanes,
    arrangement: paneArrangement,
    ratio: panes.ratio,
    terminalArea,
    terminalAreaBottom,
    windowHeight,
    laptopFold,
    foldDivisions,
    editorShown,
    editorHeight,
    keyboardCover,
    layerCover,
  });
  // What covers the pad room's bottom: the pad and the floating controls stay above it, the terminal area does not
  // shrink. In the laptop pose the room ends at the fold and only the editor lies in it.
  const padCover = laptopFold !== null ? padCoverWithKeyboard(editorShown) : obstruction;
  // The pad keeps the user's place unless it would stand under what covers its room or below its lowest place.
  const padAt = useMemo(
    () => padAnchor(pad.placement, padArea, padCover, padFloor),
    [pad.placement, padArea, padCover, padFloor],
  );
  // In the laptop pose without the text editor, where the upper half is too short for the open pad even over the
  // header: the open pad's room, reaching below the fold by what is missing. With the editor open the pad is closed
  // instead (`padYieldsToEditor`).
  const padRoomBelowFold = useMemo(
    () =>
      laptopFold !== null && padArea !== null && !editorShown ? laptopPadRoomBelowFold(padArea, headerRoom) : null,
    [laptopFold, padArea, editorShown, headerRoom],
  );
  // How far the open pad reaches over the header (null: it does not fit even then). Below the fold it reaches over all
  // of the header and fits unless a layer below the fold comes up into its room.
  const padReach =
    padArea === null
      ? 0
      : padRoomBelowFold !== null
        ? laptopPadReachBelowFold(padRoomBelowFold, headerRoom, layerShown ? terminalAreaBottom - layerCover : null)
        : padHeaderReach(padArea, padCover, headerRoom, padFloor);
  // Where a Keys or Agent layer leaves the open pad no room above it, even over the header (the pad holding the
  // keyboard down, a phone in landscape whose keyboard was down when the pad opened, or in the laptop pose a layer
  // coming up into the open pad's room below the fold), the pad is drawn closed and the layer gets its own close
  // button, so neither is cut off. Closing the layer, or tapping the toggle, shows the pad again with the keyboard
  // still down. Read from the room on every render, so a rotation or window change that makes room shows the pad
  // above the layer again.
  const padGivesWay = pad.open && layerShown && padReach === null;
  // The room the pad is drawn in: below the fold only while it is drawn open there; closed, its toggle stays in the
  // upper half.
  const padRoom = padRoomBelowFold !== null && pad.open && !padGivesWay ? padRoomBelowFold : padArea;
  if (padGivesWay !== padGaveWay) setPadGaveWay(padGivesWay);
  // The laptop pose with the text editor open where the upper half has no room for the open pad above it: the pad is
  // closed while the editor is open; Send or a tap on the toggle closes the editor and opens the pad, the keyboard
  // staying up below the fold.
  const padYieldsToEditor = laptopFold !== null && editorShown && !openPadFits(true);
  // Opening the pad where it does not fit above the keyboard even over the header lowers the keyboard.
  const togglePadOpen = pad.toggle;
  const closePadLayer = pad.closeLayer;
  const openPadOverEditor = pad.openOverEditor;
  const togglePad = useCallback(
    (): void =>
      padYieldsToEditor ? openPadOverEditor() : padGivesWay ? closePadLayer() : togglePadOpen(padReach !== null),
    [padYieldsToEditor, openPadOverEditor, padGivesWay, closePadLayer, togglePadOpen, padReach],
  );
  // The text editor open while the pad is closed and the open pad has no room above the keyboard and the editor, even
  // over the header (a phone in landscape; in the laptop pose an upper half too short for the pad above the editor,
  // `padYieldsToEditor`): the pen is out of reach, so the editor gets its own close button, which does what the pen
  // does (the editor closes, its draft stays, the keyboard stays up) and leaves the pad closed. Read from the room on
  // every render, as for a layer.
  const editorStandsAlone = editorShown && !pad.open && padReach === null;
  // While a finger is on the pad's toggle, from its first touch until it is up or its touch is cancelled, the stack's
  // swipe back to Sessions does not start, so neither the hold nor the drag is taken for it (`useTerminalPanes` writes
  // it, with a question opened from the attention list pane). The native stack reads its two options at different
  // times: `gestureEnabled` only as a touch begins, so turning it off keeps every touch that begins meanwhile (another
  // finger) from starting the swipe, but not the toggle's own touch, which began before; `gestureResponseDistance` as
  // the full-width swipe is about to begin, after the finger has moved, so an empty band keeps the toggle's own touch
  // from starting it. The swipe from the screen's very left edge reads neither once the touch is down; the toggle's
  // place on the left stands farther in to stay clear of it (`PAD_LEFT_MARGIN`). The finger going up, its touch being
  // cancelled, the pad going away and leaving the screen turn the swipe back on, and so does a session switch (the
  // touch belonged to the session it began in). At every other time the swipe works as before.
  const [padHeld, setPadHeld] = useState(false);
  const [heldSessionKey, setHeldSessionKey] = useState(padSessionKey);
  if (heldSessionKey !== padSessionKey) {
    setHeldSessionKey(padSessionKey);
    setPadHeld(false);
  }

  // The round buttons with the pad switched off stand above what covers the terminal (in the laptop pose: the fold).
  const floatingLift =
    laptopFold !== null ? obstruction : slidesWithKeyboard ? Math.max(0, bottomInset - insets.bottom) : 0;
  // The round buttons' bottom edge in the terminal area: above the closed pad's toggle at the right edge, else in the
  // corner above what covers the area; in the laptop pose at least a finger's width above the fold's top
  // (`laptopFloatingBottom`). On iOS, where the area does not shrink with the keyboard, the height left for them above
  // it, 16 pt below the area's top.
  const floatingBottom =
    padSessionKey !== null && padAt.side === 'right'
      ? foldAboveAreaBottom + padAt.bottom + PAD_TOGGLE + 12
      : laptopFold !== null
        ? laptopFloatingBottom(laptopFold, terminalAreaBottom, 16 + floatingLift)
        : 16 + floatingLift;
  const floatingRoom =
    slidesWithKeyboard && terminalArea !== null ? terminalArea.height - floatingBottom - 16 : undefined;
  // The round buttons over a terminal on screen (not in chat view, not while a pane without a terminal is active):
  // without the pad while the key bar is down, with it while the pad is closed and no layer stands.
  const terminalButtonsShown =
    !chatModeActive && terminalPaneActive && (padSessionKey !== null ? !pad.open && !layerShown : !keyBarVisible);
  // The chat in the active pane while the keyboard is up: the same keyboard button, at the same place, hides it.
  const chatPaneKeyboardButton =
    activePaneContent?.kind === 'session' && activePaneContent.sessionKey === paneChatKey && keyboardVisible;

  const toggleChatView = useCallback((): void => {
    const store = useTerminalStore.getState();
    const sessionKey = store.selectedSessionKey;
    if (sessionKey === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // With two panes the selected session's pane turns, and only there: one chat per screen,
    // the other pane's back to its terminal, the session's saved view kept; with one, the session's saved view.
    const enteringChat = showsPanes ? paneChatKey !== sessionKey : !store.chatModeArmed(sessionKey);
    // Each surface owns its own input focus. Dismiss before either direction
    // so the retained hidden WebView cannot leave its keyboard attached to the
    // terminal, and the terminal keyboard cannot linger over chat.
    dismissKeyboard();
    if (enteringChat) {
      // Desktop parity: reading the session's chat is looking at the session,
      // so it clears attention the same way selecting its tab does.
      const tab = store.tabs.find((entry) => entry.sessionKey === sessionKey);
      if (tab?.ghostexSessionId !== undefined) {
        acknowledgeSessionAttention(tab.machineId, tab.ghostexSessionId);
      }
    }
    if (showsPanes) setPaneChat(enteringChat ? sessionKey : null);
    else store.toggleChatMode(sessionKey);
  }, [dismissKeyboard, showsPanes, paneChatKey, setPaneChat]);

  // The keyboard's way to the composer of the chat in a pane (`focusRequestId`, each new value focuses it).
  const [composerFocusRequestId, setComposerFocusRequestId] = useState(0);
  const focusComposer = useCallback(() => setComposerFocusRequestId((current) => current + 1), []);
  // The menu's Session Note for a terminal pane turns that pane to its chat view, which mounts there: the note is
  // asked for once that chat is on screen (a request present at a chat's mount is not a new one).
  const [noteWhenChatShows, setNoteWhenChatShows] = useState<string | null>(null);
  useEffect(() => {
    if (noteWhenChatShows === null || noteWhenChatShows !== paneChatKey) return;
    setNoteWhenChatShows(null);
    setChatSessionNoteRequestId((current) => current + 1);
  }, [noteWhenChatShows, paneChatKey]);

  /** Re-run the open flow for a failed/closed tab (Retry / Reconnect). */
  const reopenTab = useCallback(async (tab: TerminalTab): Promise<void> => {
    await useTerminalStore.getState().reopenTab(tab.sessionKey);
  }, []);

  const requestCloseTab = useCallback(
    (tab: TerminalTab): void => {
      if (!settings.confirmTabClose) {
        void closeTab(tab.sessionKey);
        return;
      }
      Alert.alert('Close Tab?', `This will disconnect "${tab.title}".`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Close', style: 'destructive', onPress: () => void closeTab(tab.sessionKey) },
      ]);
    },
    [closeTab, settings.confirmTabClose],
  );

  const handleSelectTab = useCallback(
    (sessionKey: string): void => {
      if (sessionKey !== useTerminalStore.getState().selectedSessionKey) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      // Desktop parity: tapping a session's tab acknowledges its attention
      // status (even when the tab is already selected).
      const tab = useTerminalStore.getState().tabs.find((entry) => entry.sessionKey === sessionKey);
      if (tab?.ghostexSessionId !== undefined) {
        acknowledgeSessionAttention(tab.machineId, tab.ghostexSessionId);
      }
      selectTab(sessionKey);
    },
    [selectTab],
  );

  const switchTabBy = useCallback((delta: -1 | 1): void => {
    const store = useTerminalStore.getState();
    const index = store.tabs.findIndex((tab) => tab.sessionKey === store.selectedSessionKey);
    if (index < 0) return;
    const next = store.tabs[index + delta];
    if (next === undefined) return;
    store.selectTab(next.sessionKey);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  // What a touch, a pick, the Panes button and Back do with the two panes; the keyboard follows the active one.
  const {
    goBack,
    activatePane,
    pickPaneSession,
    openAttentionTarget,
    togglePanes,
    panesLabel,
    closeChooser,
    newPaneTerminal,
    showsTwoPanes,
    chooserSlot,
    selectedPaneSlot,
  } = useTerminalPanes({
    panes,
    navigation,
    isFocused,
    panesOffered,
    paneQuestion,
    setPaneQuestion,
    hasPaneSlots,
    tabs,
    selectedSessionKey,
    activeMachineId: activeTab?.machineId ?? null,
    chatModeActive,
    mountedTerminalSessionKey,
    focusComposer,
    keyboardVisible,
    editorShown,
    dismissKeyboard,
    showSessions,
    setProgress: setAgentProgress,
    padHeld,
  });
  // The Panes button over a question a link opened brings the panes back (those that waited, else as Panes opens them).
  const openPanes = panes.openPanes;
  const pressPanes = useCallback((): void => {
    if (!questionStands) {
      togglePanes();
      return;
    }
    usePaneStore.getState().setQuestionHold(null);
    openPanes();
  }, [questionStands, togglePanes, openPanes]);

  // ---------------------------------------------------------------------
  // Agent Actions (desktop terminal-overlay parity, minus the stash entries
  // gxserver exposes no CLI verb for).
  // ---------------------------------------------------------------------

  const {
    submitAgentRename,
    runDelayedSend,
    cancelDelayedSend,
    toggleCloseAfterDone,
    startTranscriptConversation,
    promptEditorDraft,
    pushPromptEditorDraft,
    submitPromptEditor,
    promptAttachmentSource,
    handleRefresh,
    handleMenuAction,
    handleMenuDismissed,
    pickSkill,
    configureSkills,
  } = useTerminalAgentActions({
    activeTab,
    activeProjectId,
    activeSession,
    activeAgentId,
    chatModeActive,
    uploading,
    setUploading,
    setAgentOverlay,
    setAgentProgress,
    exportedTranscript,
    setExportedTranscript,
    startingTranscriptConversation,
    setStartingTranscriptConversation,
    setExportedTranscriptError,
    setMenuVisible,
    setChatSearchRequestId,
    navigation,
    requestCloseTab,
    openShellTab,
  });

  const handleTerminalMenuAction = useCallback(
    (id: Parameters<typeof handleMenuAction>[0]): void => {
      if (id === 'docs') {
        setMenuVisible(false);
        if (activeTab !== null && activeProject !== null && (activeProject.path ?? '').length > 0) {
          // The agent session Files was opened from takes Add to Session Context.
          const session = contextSessionFor(
            activeTab,
            activeAgentId,
            activeSession === null || activeSession.displayTitle.length === 0
              ? SessionCopy.fallbackTitle
              : activeSession.displayTitle,
            chatCapable,
          );
          navigation.navigate('Docs', {
            machineId: activeTab.machineId,
            projectId: activeProject.projectId,
            projectName: activeProject.name ?? '',
            projectPath: activeProject.path ?? '',
            ...(session !== null ? { session } : {}),
          });
        }
        return;
      }
      if (id === 'changes') {
        setMenuVisible(false);
        if (activeTab !== null && activeProject !== null && activeProject.projectId.length > 0) {
          navigation.navigate('Changes', {
            machineId: activeTab.machineId,
            projectId: activeProject.projectId,
            projectName: activeProject.name ?? '',
          });
        }
        return;
      }
      if (id === 'sessionNote') {
        setMenuVisible(false);
        if (!chatModeActive) {
          toggleChatView();
          if (showsPanes && activeTab !== null) {
            setNoteWhenChatShows(activeTab.sessionKey);
            return;
          }
        }
        setChatSessionNoteRequestId((current) => current + 1);
        return;
      }
      handleMenuAction(id);
    },
    [
      activeAgentId,
      activeProject,
      activeSession,
      activeTab,
      chatCapable,
      chatModeActive,
      handleMenuAction,
      navigation,
      setMenuVisible,
      showsPanes,
      toggleChatView,
    ],
  );

  const uploadEnabled = activeTab !== null && (chatModeActive ? agentActionsCapable : activeTab.state === 'open');
  // The pad's Upload key asks for the source as the terminal menu's "Send & Attach File" does.
  const padUpload = useMemo(
    () => ({ available: uploadEnabled && !uploading, uploading, start: promptAttachmentSource }),
    [uploadEnabled, uploading, promptAttachmentSource],
  );
  const openPadSettings = useCallback(() => navigation.navigate('SettingsPage', { page: 'keyboard' }), [navigation]);
  const padLayer =
    padSessionKey !== null && pad.layer !== null ? (
      <CommandPadLayer
        kind={pad.layer}
        input={pad.input}
        modifiers={pad.modifiers}
        agentId={activeAgentId}
        onOpenSettings={openPadSettings}
        height={layerFrameHeight}
        bottomInset={insets.bottom}
        onHeightChange={setLayerHeight}
        onClose={padGivesWay ? closePadLayer : undefined}
      />
    ) : null;
  const agentSessionTitle =
    activeSession === null || activeSession.displayTitle.length === 0
      ? SessionCopy.fallbackTitle
      : activeSession.displayTitle;
  // Shell tabs have no gxserver session record; the menu still names the thing
  // it acts on, so fall back to the tab's own title before the generic copy.
  const menuTitle =
    activeSession !== null && activeSession.displayTitle.length > 0
      ? activeSession.displayTitle
      : activeTab !== null && activeTab.title.length > 0
        ? activeTab.title
        : SessionCopy.fallbackTitle;

  // The screen reaches the window edges in the colour of what it shows: the chat theme's page in chat view, the
  // terminal's own background (palette, Terminal background, its appearance) in the terminal, so the header, the
  // strip under the iPhone Duo's rail and the status bar sit on the same surface; their ink follows it.
  const appearance = useAppearance();
  const chatBackground = useTranscriptTheme().background;
  const terminalSurface = useTerminalColours().chrome;
  const surfaceBackground = chatModeActive ? chatBackground : terminalSurface.background;
  const headerChrome = chatModeActive ? terminalChrome(chatBackground) : terminalSurface;
  const ink = headerChrome.foreground;
  useStatusBarStyle(headerChrome.light);

  // The header's buttons on top, or in the iPhone Duo's status band (band); in the rail they are
  // `railButtons` below.
  const headerButtons = (buttonStyle: StyleProp<ViewStyle>) => (
    <>
      <VoiceButton
        machine={activeMachine}
        style={buttonStyle}
        color={ink}
        size={20}
        activeFill={false}
      />
      {panesAvailable && bandOverflow.shows('panes') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={panesLabel}
          accessibilityState={{ selected: showsTwoPanes }}
          hitSlop={8}
          style={buttonStyle}
          onPress={pressPanes}
        >
          <PanesIcon
            across={!panesUpright}
            size={20}
            color={showsTwoPanes ? GhostexPalette.ACCENT : ink}
          />
        </Pressable>
      )}
      {chatCapable && bandOverflow.shows('view') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chatModeActive ? TerminalHeaderCopy.terminalView : TerminalHeaderCopy.chatView}
          hitSlop={8}
          style={buttonStyle}
          onPress={toggleChatView}
        >
          {chatModeActive ? <TerminalPromptIcon size={19} color={ink} /> : <ChatBubbleIcon size={19} color={ink} />}
        </Pressable>
      )}
      <Pressable
        ref={moreButtonRef}
        accessibilityRole="button"
        accessibilityLabel={DuoChromeCopy.more}
        hitSlop={8}
        style={buttonStyle}
        // In the iPhone Duo's status band the menu opens below this button.
        onPress={() => (headerPlacement.kind === 'top' ? openMenu() : measureInWindow(moreButtonRef, openMenu))}
      >
        <EllipsisIcon size={22} color={ink} />
      </Pressable>
    </>
  );
  const backButton = (buttonStyle: StyleProp<ViewStyle>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={DuoChromeCopy.back}
      hitSlop={8}
      style={buttonStyle}
      onPress={goBack}
    >
      <ChevronLeftIcon size={22} color={ink} />
    </Pressable>
  );
  const inRail = headerPlacement.kind === 'rail';
  /*
   * CDXC:SessionChat 2026-10-29 DECISION:
   * User, asked "drops the chat box's bottom spacer, so on Android (and iPhones with the keyboard down) the
   * chat box sits lower. Take that?" (Q764): "Keep today's spacing". The spacer under the chat composer stays
   * on Android and on every iPhone; only the iPhone Duo, whose header stands in the status band or the side
   * bar, leaves the composer's own bottom margin alone below it.
   */
  const chatBottomSpacer = headerPlacement.kind === 'top';
  // The same buttons standing in the iPhone Duo's side bar below the status items (rail): Back never
  // moves into the menu. The voice button has no rail entry: the rail exists only on iOS, where it does
  // not render (VOICE_SUPPORTED). Memoized on the header's inputs, so terminal output and tab updates
  // do not republish the side bar. Its capsules and menus take the app appearance; the header row takes `ink`.
  const railButtons = useMemo<RailButtons>(
    () => ({
      pinned: 1,
      moreMenu: 'always',
      // The terminal and the chat composer both take the keyboard.
      reserveKeyboard: true,
      entries: [
        {
          key: 'back',
          label: DuoChromeCopy.back,
          icon: (size) => <ChevronLeftIcon size={size} color={appearance.foreground} />,
          onPress: goBack,
        },
        ...(panesAvailable
          ? [
              {
                key: 'panes',
                label: panesLabel,
                icon: (size: number) => (
                  <PanesIcon
                    across={!panesUpright}
                    size={size - 2}
                    color={showsTwoPanes ? appearance.accent : appearance.foreground}
                  />
                ),
                onPress: pressPanes,
              },
            ]
          : []),
        ...(chatCapable
          ? [
              {
                key: 'view',
                label: chatModeActive ? TerminalHeaderCopy.terminalView : TerminalHeaderCopy.chatView,
                icon: (size: number) =>
                  chatModeActive ? (
                    <TerminalPromptIcon size={size - 3} color={appearance.foreground} />
                  ) : (
                    <ChatBubbleIcon size={size - 3} color={appearance.foreground} />
                  ),
                onPress: toggleChatView,
              },
            ]
          : []),
        {
          key: 'more',
          label: DuoChromeCopy.more,
          icon: (size) => <EllipsisIcon size={size} color={appearance.foreground} />,
          onPress: openMenu,
        },
      ],
    }),
    [
      appearance,
      chatCapable,
      chatModeActive,
      toggleChatView,
      goBack,
      openMenu,
      panesAvailable,
      showsTwoPanes,
      panesLabel,
      panesUpright,
      pressPanes,
    ],
  );
  useRailButtons(railButtons, surfaceBackground, inRail && isFocused);
  const railOverflow = useRailOverflow(railButtons, inRail && isFocused);
  // The status band's row: Back, the tab strip (one tab wide at least, it scrolls), the chat
  // toggle and "…"; the toggle moves into the "…" menu when the band is too narrow for all of them.
  const inBand = headerPlacement.kind === 'band';
  const bandOverflow = useBandOverflow(
    railButtons,
    inBand ? headerPlacement.frame.width - 2 * HEADER_PADDING - MIN_TAB_WIDTH : 0,
    TERMINAL_BAND_BUTTONS,
    inBand,
  );
  const overflowEntries = inBand ? bandOverflow.menu : railOverflow;
  /*
    Queued prompts are invisible from the terminal — they never reach the
    agent CLI until the server scheduler delivers them — so the terminal
    view says how many are waiting and takes one tap to the chat view,
    which is where they can be edited, reordered or sent. Top-left, out of
    the way of the floating controls at the bottom, and gone at zero. With
    two panes it stands in the active pane, whose session it counts.
  */
  const queuedPill =
    !chatModeActive && activeQueuedPromptCount > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${activeQueuedPromptCount} queued ${
          activeQueuedPromptCount === 1 ? 'prompt' : 'prompts'
        }. Show the chat view.`}
        hitSlop={8}
        style={({ pressed }) => [styles.queuedPill, pressed ? styles.queuedPillPressed : null]}
        onPress={() => {
          if (!chatModeActive) toggleChatView();
        }}
      >
        <Text style={styles.queuedPillLabel}>{`Queued: ${activeQueuedPromptCount}`}</Text>
      </Pressable>
    ) : null;

  /*
   * CDXC:SessionChat 2026-11-12 DECISION:
   * User, on the phone's chat: "I want top bar just to show tabs", with the voice agent and the terminal switch moved
   * to the chat box and the top bar's ⋯ merged into the chat box's (`moreActionsRows`). In the chat view the top bar
   * holds the tab strip alone (on the iPhone also Back, below); the terminal view keeps its buttons and its ⋯ menu, as
   * it has no chat box, and so do the iPhone Duo's status band and side bar and two panes, which serve both.
   */
  const tabsOnlyHeader = headerPlacement.kind === 'top' && chatModeActive && twoPanes === null;
  const docsEnabled = activeProject !== null && (activeProject.path ?? '').length > 0;
  const activeChatHostActions = useMemo(() => {
    const base =
      !agentActionsCapable || activeSession === null
        ? NO_NATIVE_CHAT_HOST_ACTIONS
        : activeSession.isCoordinator
          ? COORDINATOR_CHAT_HOST_ACTIONS
          : NATIVE_CHAT_HOST_ACTIONS;
    // The top bar's ⋯ rows, only where that menu is gone (one place each).
    if (!tabsOnlyHeader) return base;
    return [
      ...base,
      ...chatShellActions({
        agentActions: agentActionsCapable && activeSession !== null,
        project: docsEnabled,
        session: activeSession !== null,
      }),
    ];
  }, [activeSession, agentActionsCapable, docsEnabled, tabsOnlyHeader]);

  // What the chat's More actions rows and cards ask of the screen: the terminal menu's own actions, on the selected
  // session (a touch in a chat pane selects its session before its rows are reached).
  const chatHostAction = (action: string): void => {
    if (action === 'closeAfterDone') void toggleCloseAfterDone();
    else handleTerminalMenuAction(action as TerminalMenuActionId);
  };
  // A chat's own View playbook: the coordinator's project on the chat's computer, not the selected session's.
  const chatHostActionFor =
    (machine: MachineConnectionTarget | null, projectId: string) =>
    (action: string): void => {
      if (action !== 'viewPlaybook') chatHostAction(action);
      else if (machine !== null && projectId.length > 0) setPlaybook({ machine, projectId });
    };
  // The chat in a pane: today's chat view at the size of the pane's body, which ends at
  // the keyboard or above the fold, so its composer lifts nothing itself (`inPane`). Its Terminal View turns only this
  // pane back to the terminal. Its sheets and dialogs stay the chat's own, over the whole window.
  const paneChatTarget = useMachineTarget(chatTab !== null && paneChatKey !== null ? chatTab.machineId : null);
  const paneChat =
    paneChatKey === null || chatTab === null || paneChatTarget === null
      ? null
      : {
          sessionKey: paneChatKey,
          view: (
            <SessionChatSurface
              key={paneChatKey}
              machine={paneChatTarget}
              projectId={chatProjectId}
              sessionId={chatTab.ghostexSessionId ?? ''}
              onSwitchToTerminal={() => setPaneChat(null)}
              hostActions={
                chatSession === null
                  ? NO_NATIVE_CHAT_HOST_ACTIONS
                  : chatSession.isCoordinator
                    ? COORDINATOR_CHAT_HOST_ACTIONS
                    : NATIVE_CHAT_HOST_ACTIONS
              }
              onHostAction={chatHostActionFor(paneChatTarget, chatProjectId)}
              visible
              inPane
              focusRequestId={composerFocusRequestId}
              openSearchRequestId={chatSearchRequestId}
              openSessionNoteRequestId={chatSessionNoteRequestId}
              links={{ links: chatSession?.links, onOpen: () => setLinksSheetVisible(true) }}
              style={styles.terminal}
            />
          ),
        };

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground,
          // In the side bar's poses the header row takes the top itself (below).
          paddingTop: inRail ? 0 : insets.top,
          // WKWebView already contracts its visual viewport around the iOS
          // keyboard. Applying the native keyboard inset to its parent as
          // well moves the chat composer twice (all the way to the top).
          // The iOS terminal is not resized at all: it slides (`terminalOffset`).
          paddingBottom:
            keyboardVisible && !slidesWithKeyboard && (!chatModeActive || Platform.OS === 'android')
              ? bottomInset + keyboardOcclusionCorrection
              : 0,
        },
      ]}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: surfaceBackground },
          // No Back on Android and no buttons in the chat view: the tab strip keeps the chat's side margin there.
          headerPlacement.kind === 'top'
            ? {
                paddingLeft: Platform.OS === 'android' ? TABS_EDGE_MARGIN : HEADER_PADDING,
                paddingRight: tabsOnlyHeader ? TABS_EDGE_MARGIN : HEADER_PADDING,
              }
            : null,
          headerPlacement.kind === 'band'
            ? [styles.bandHeader, bandRowFrame(headerPlacement.frame, HEADER_HEIGHT)]
            : null,
          // In the side bar's poses: below the system's top margin, and its background runs to the
          // window edge under the side bar, as an iOS bar's does.
          inRail
            ? [
                { paddingTop: contentTop, height: contentTop + HEADER_HEIGHT },
                barBackgroundToEdges(bar, HEADER_PADDING),
              ]
            : null,
        ]}
      >
        {/* Android's own Back (gesture and button) goes back to Sessions (`BackHandler` above): no arrow there. The
            iPhone has no system Back, so it keeps the arrow. */}
        {inRail || Platform.OS === 'android' ? null : backButton(styles.headerButton)}
        <TerminalTabsBar
          headerColor={surfaceBackground}
          tabs={tabs}
          selectedSessionKey={selectedSessionKey}
          onSelect={handleSelectTab}
          onClose={(sessionKey) => {
            const tab = tabs.find((entry) => entry.sessionKey === sessionKey);
            if (tab !== undefined) requestCloseTab(tab);
          }}
        />
        {inRail || tabsOnlyHeader ? null : headerButtons(styles.headerButton)}
      </View>
      {activeBoxEntry !== null ? (
        <CloudBoxPill entry={activeBoxEntry} sessionId={activeTab?.ghostexSessionId ?? null} />
      ) : null}

      {/*
        Only a session this phone launched into chat (it carries the launcher's agent id) starts
        its agent through the attach, so only there is a failed attach an agent startup failure.
        Any other session's terminal error waits for the Terminal view's own overlay.
      */}
      {chatModeActive && activeTab?.state === 'failed' && activeTab.ghostexAgentId !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry agent startup"
          style={styles.chatStartupError}
          onPress={() => void reopenTab(activeTab)}
        >
          <Text style={styles.chatStartupErrorText}>
            {activeTab.error ? summarizeFailure(activeTab.error, activeMachineHasPassword) : 'Agent startup failed.'} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <View
        style={slidesWithKeyboard ? [styles.terminalArea, styles.terminalAreaSliding] : styles.terminalArea}
        onLayout={onTerminalAreaLayout}
      >
        {activeTab !== null && !chatModeActive && twoPanes === null ? (
          isDemoMachineId(activeTab.machineId) ? (
            <DemoTerminalView
              sessionId={activeTab.ghostexSessionId ?? activeTab.sessionKey}
              style={styles.terminal}
            />
          ) : (
            // Only the selected tab's terminal is mounted; the native registry
            // keeps other entries warm across view detach.
            <GhostexTerminalView
              sessionKey={activeTab.sessionKey}
              style={slidesWithKeyboard ? [styles.terminal, { top: -terminalOffset }] : styles.terminal}
              onCaretChange={slidesWithKeyboard ? ({ nativeEvent }) => setCaretTop(nativeEvent.top) : undefined}
              onSingleTap={() => setTapKeyboardHint(true)}
              onOpenUrl={({ nativeEvent }) =>
                openMachineLink(activeTab.machineId, nativeEvent.url, { projectId: activeProjectId })
              }
            />
          )
        ) : null}
        {twoPanes !== null && paneLayout !== null && activeTab !== null ? (
          // Two panes: each terminal in its own pane, the selected one in the active pane.
          <PaneHost
            layout={paneLayout}
            slots={twoPanes.slots}
            chatSessionKey={paneChatKey}
            renderContent={(content, frame) => (
              <PaneContentView
                content={content}
                frame={frame}
                chat={paneChat}
                machineId={activeTab.machineId}
                besideSessionId={activeTab.ghostexSessionId}
                projectOffered={chooserSlot !== null && panes.typeOffered(chooserSlot, 'files')}
                onPickSession={pickPaneSession}
                onPickType={(type) => {
                  if (chooserSlot !== null) panes.setSlotType(chooserSlot, type);
                }}
                onCloseChooser={closeChooser}
                onNewTerminal={newPaneTerminal}
                onOpenAttention={openAttentionTarget}
                navigation={navigation}
              />
            )}
            // The queued prompts of the selected session stand in its pane.
            accessory={queuedPill}
            accessorySlot={selectedPaneSlot}
            typeOffered={panes.typeOffered}
            onSetType={panes.setSlotType}
            onActivate={activatePane}
            onClose={panes.closeSlot}
            onSwap={panes.swap}
            onRatio={panes.setRatio}
          />
        ) : null}
        {activeTab !== null && chatMachineTarget !== null && activeTab.sessionKey !== paneChatKey ? (
          /*
           * Keep the selected session's chat screen mounted while terminal mode
           * is visible. Its first transcript read warms in advance, and while
           * hidden it owns no input region until the user switches views.
           * Toggling no longer destroys the conversation. With two panes it stays hidden; a chat in a pane is its own
           * (`paneChat`), and while it is the selected session's this one is not mounted (one screen per chat core).
           *
           * CDXC:SessionChat 2026-09-25 DECISION:
           * User (2026-09-25): delete the phone's "Web (previous)" chat fallback so the phone runs only the native Rust chat. NativeChatScreen is the only chat view; the WebView chat, the Settings > Chat view choice and its bundled page are gone, and a stored `sessionChatView: 'web'` is ignored. Supersedes the earlier 2026-09-25 decision that kept the WebView as a fallback.
           */
          <SessionChatSurface
            key={activeTab.sessionKey}
            machine={chatMachineTarget}
            projectId={activeProjectId}
            sessionId={activeTab.ghostexSessionId ?? ''}
            onSwitchToTerminal={() => {
              if (chatModeActive) toggleChatView();
            }}
            hostActions={activeChatHostActions}
            onHostAction={chatHostActionFor(chatMachineTarget, activeProjectId)}
            visible={chatModeActive && twoPanes === null}
            openSearchRequestId={chatSearchRequestId}
            openSessionNoteRequestId={chatSessionNoteRequestId}
            onQueueCountChange={handleChatQueueCount}
            links={{ links: activeSession?.links, onOpen: () => setLinksSheetVisible(true) }}
            style={chatFoldInset > 0 ? [styles.terminal, { marginBottom: chatFoldInset }] : styles.terminal}
          />
        ) : null}
        {activeTab !== null && !chatModeActive && twoPanes === null && (
          <TerminalStateOverlay
            tab={activeTab}
            errorCaption={activeTab.error !== undefined ? summarizeFailure(activeTab.error, activeMachineHasPassword) : null}
            onRetry={() => void reopenTab(activeTab)}
            onReconnect={() => void reopenTab(activeTab)}
            // Laptop pose: Retry and Reconnect above the fold, never on it.
            contentBottom={foldAboveAreaBottom}
          />
        )}
        {twoPanes === null ? queuedPill : null}
        {/* With two panes the screen's edges are their title bars' and contents': no edge swipe there. */}
        {twoPanes === null && tabs.length > 1 && (
          <EdgeSwipeZones onPrev={() => switchTabBy(-1)} onNext={() => switchTabBy(1)} />
        )}
        {laptopFold !== null && laptopCover > 0 ? (
          // Laptop pose, keyboard up or not: the output ends at the fold. The view keeps its size and
          // slides; what it still has below the fold's top (the cursor row won and it slid less) is covered, and
          // touches there reach no terminal.
          <View
            testID="laptop-cover"
            style={[styles.laptopCover, { height: laptopCover, backgroundColor: terminalSurface.background }]}
          />
        ) : null}
        {/*
          Without the pad (switched off, or Android): the round buttons as before the pad, hidden while the key bar
          is up. With it on, Upload is a pad key and the optional keyboard and refresh buttons stand above the
          closed pad's toggle; when the user moved the pad away from the right edge they keep their own corner.
          iOS: while the keyboard is up and the pad is off or closed, the keyboard button shows as its dismiss
          whatever its setting, so one tap hides the keyboard; with the pad on it is then the only one there. Not
          while a pane without a terminal is the active one: they act on a terminal. A chat pane that is the active
          one gets the keyboard button alone, at the same place, while the keyboard is up (its dismiss).
        */}
        {(terminalButtonsShown || chatPaneKeyboardButton) && (
          <TerminalFloatingControls
            showKeyboardButton={
              chatPaneKeyboardButton || settings.keyboardButtonVisible || (slidesWithKeyboard && keyboardVisible)
            }
            showUploadButton={terminalButtonsShown && padSessionKey === null && settings.fileUploadButtonVisible}
            showRefreshButton={
              terminalButtonsShown &&
              settings.refreshButtonVisible &&
              activeTab?.kind === 'attach' &&
              (padSessionKey === null || !keyboardVisible)
            }
            uploadEnabled={uploadEnabled}
            uploading={uploading}
            refreshEnabled={activeTab?.state === 'open'}
            keyboardShown={keyboardVisible}
            bottomOffset={floatingBottom}
            maxHeight={floatingRoom}
            onKeyboard={showKeyboard}
            onDismissKeyboard={dismissKeyboard}
            onUpload={promptAttachmentSource}
            onRefresh={handleRefresh}
          />
        )}
      </View>
      {/*
        The pad's room (`padRoom`): the terminal area within the window's safe area across, and the header above it
        while the open pad needs that (`padReach`); in the laptop pose the upper half, reaching below the fold while
        the open pad needs that (`padRoomBelowFold`). Its own view, after the header, because the terminal area clips
        what slides out of it. Until the area is measured, the pad has no place and is not shown.
      */}
      {padSessionKey !== null ? (
        <View
          pointerEvents="box-none"
          style={
            padRoom === null
              ? styles.padRoomUnmeasured
              : [
                  styles.padRoom,
                  {
                    left: padRoom.x,
                    top: padRoom.y - (padReach ?? 0),
                    width: padRoom.width,
                    height: padRoom.height + (padReach ?? 0),
                  },
                ]
          }
        >
          <CommandPad
            open={pad.open && !padGivesWay}
            onToggle={togglePad}
            keys={pad.keys}
            input={pad.input}
            modifiers={pad.modifiers}
            upload={padUpload}
            anchor={padAt}
            area={padRoom}
            reach={padReach ?? 0}
            cover={padCover}
            floor={padFloor}
            placement={pad.placement}
            onMove={pad.movePad}
            onHold={setPadHeld}
            layer={pad.layer}
            onLayer={pad.selectLayer}
            agentAvailable={pad.agentAvailable}
            editorOpen={pad.editorVisible}
            onEditor={pad.toggleEditor}
            keyboardVisible={keyboardVisible}
            onKeyboard={pad.toggleKeyboard}
          />
        </View>
      ) : null}

      {/*
        The screen's bottom edge, always mounted and measurable: the extra-keys
        toolbar while it is up, otherwise the bottom margin.
      */}
      <View ref={bottomEdgeFrameRef} collapsable={false} onLayout={reconcileBottomEdgeWithVisibleWindow}>
        {slidesWithKeyboard ? (
          // The terminal view ends above the home-indicator inset, with or without the keyboard; the text editor
          // rides over the keyboard (the dock below) and a pad layer stands in the keyboard's place, not in this flow.
          <View style={{ height: insets.bottom }} />
        ) : keyBarVisible && activeTab !== null && !chatModeActive ? (
          <TerminalKeyBar
            sessionKey={activeTab.sessionKey}
            agentId={activeAgentId}
            onDismissKeyboard={dismissKeyboard}
          />
        ) : (
          // With the keyboard up the container's bottom padding already clears
          // the IME, so the terminal surface takes all of it and only adds the
          // home-indicator inset while the keyboard is down. The chat composer
          // is a control rather than a full-bleed surface: it keeps the margin
          // it has with the keyboard down so its bottom row never sits flush
          // against the keyboard. On the iPhone Duo the composer's own bottom
          // margin is the only one (`chatBottomSpacer`).
          <View
            testID="terminal-bottom-spacer"
            style={{ height: (chatModeActive ? chatBottomSpacer : !keyboardVisible) ? insets.bottom : 0 }}
          />
        )}
      </View>
      {slidesWithKeyboard ? (
        <>
          <KeyBarDock
            shown={editorShown}
            // Laptop pose: above the fold, at the bottom of the upper half.
            inset={laptopFold !== null ? laptopEditorInset(laptopFold, windowHeight) : bottomInset}
            hideMs={hideMotionMs}
            onHeightChange={setEditorHeight}
            // Two panes side by side: as wide as the active pane, which it types into.
            frame={editorDockFrame}
          >
            {padSessionKey !== null ? (
              <TerminalTextEditor
                key={padSessionKey}
                sessionKey={padSessionKey}
                onClose={editorStandsAlone ? pad.toggleEditor : undefined}
                onSent={padYieldsToEditor ? openPadOverEditor : undefined}
              />
            ) : null}
          </KeyBarDock>
          {padLayer !== null ? <View style={styles.padLayerDock}>{padLayer}</View> : null}
        </>
      ) : null}

      <TerminalMenu
        visible={menuVisible}
        sessionTitle={menuTitle}
        agentActionsEnabled={agentActionsCapable && activeSession !== null}
        sleeping={activeSession?.isSleeping === true}
        forkEnabled={FORK_AGENT_ICONS.includes(activeAgentId)}
        // gxserver only parses the transcripts of the agents the chat view
        // supports, so anything else would only ever get `unsupportedAgent`.
        exportTranscriptEnabled={isSessionChatSupportedAgent(activeAgentId)}
        sessionNoteEnabled={sessionNotesOn && chatCapable && (activeSession?.agentSessionId.length ?? 0) > 0}
        searchConversationEnabled={chatModeActive}
        docsEnabled={docsEnabled}
        attachEnabled={uploadEnabled && !uploading}
        disconnectEnabled={activeTab !== null}
        killSessionEnabled={activeTab !== null && activeSession !== null}
        // The terminal's own input; chat mode has the composer's More actions > Skills.
        skillsEnabled={agentActionsCapable && activeSession !== null && !chatModeActive}
        onSelect={handleTerminalMenuAction}
        // Rail buttons with no room above the keyboard (iPhone Duo), first.
        leadingItems={railMenuItems(overflowEntries, () => setMenuVisible(false))}
        onClose={() => setMenuVisible(false)}
        onDismissed={handleMenuDismissed}
        anchor={menuAnchor}
      />

      {playbook !== null ? (
        <CoordinatorPlaybookSheet
          load={() => loadCoordinatorPlaybook(playbook.machine, playbook.projectId)}
          onClose={() => setPlaybook(null)}
        />
      ) : null}
      {activeSession !== null ? (
        <>
          {agentOverlay.kind === 'rename' ? (
            <PromptDialog
              visible
              title={RenameCopy.title}
              body={RenameCopy.body}
              placeholder={RenameCopy.inputHint}
              initialValue={renameInitialTitle(activeSession)}
              error={agentOverlay.error}
              confirmLabel="Rename"
              onSubmit={(value) => void submitAgentRename(value)}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
            />
          ) : null}
          {agentOverlay.kind === 'delayedSend' ? (
            <DelayedSendDialog
              agentIcon={activeSession.agentIcon}
              agentName={activeSession.agentName.length > 0 ? activeSession.agentName : activeSession.agent}
              closeAfterDoneActive={activeSession.closeAfterDone}
              supportsCloseAfterDone={!activeSession.isCoordinator}
              visible
              sessionTitle={agentSessionTitle}
              remainingLabel={activeSession.delayedSendRemainingLabel}
              delayedSendDeadlineAt={activeSession.delayedSendDeadlineAt}
              sendWhenAllProjectSessionsStopActive={activeSession.sendWhenAllProjectSessionsStopActive}
              sendWhenAgentStopsActive={activeSession.sendWhenAgentStopsActive}
              onConfirm={(trigger, delayMs) => void runDelayedSend(trigger, delayMs)}
              onCancelTimer={() => void cancelDelayedSend()}
              onToggleCloseAfterDone={() => toggleCloseAfterDone()}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
            />
          ) : null}
          {agentOverlay.kind === 'skills' ? (
            <TerminalSkillsMenu
              sessionTitle={agentSessionTitle}
              rows={agentOverlay.rows}
              error={agentOverlay.error}
              onPick={pickSkill}
              onConfigure={configureSkills}
              onClose={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
            />
          ) : null}
          {agentOverlay.kind === 'promptEditor' ? (
            <PromptEditorSheet
              visible
              sessionTitle={agentSessionTitle}
              destination={chatModeActive ? 'chat' : 'terminal'}
              busy={agentOverlay.sending}
              initialText={promptEditorDraft?.supported === true ? promptEditorDraft.content : undefined}
              onSubmit={(text) => void submitPromptEditor(text)}
              onCancel={(text) => {
                // Closing without sending publishes the draft rather than
                // dropping it: this sheet is the session's composer right now.
                pushPromptEditorDraft(text);
                setAgentOverlay(AGENT_OVERLAY_NONE);
              }}
            />
          ) : null}
        </>
      ) : null}

      {activeMachine !== null && activeSession !== null && activeTab !== null ? (
        <SessionLinksSheet
          visible={linksSheetVisible}
          onClose={() => setLinksSheetVisible(false)}
          machine={activeMachine}
          session={activeSession}
          openTarget={sessionLinkOpenTarget}
          openInApp={(url) => navigation.navigate('WebPreview', { machineId: activeTab.machineId, url })}
        />
      ) : null}
      {exportedTranscript !== null ? (
        <ExportTranscriptSheet
          visible
          sessionTitle={exportedTranscript.sessionTitle}
          path={exportedTranscript.path}
          agentLabel={exportedTranscript.agentLabel}
          starting={startingTranscriptConversation}
          error={exportedTranscriptError}
          onStartNewConversation={() => void startTranscriptConversation()}
          onClose={() => setExportedTranscript(null)}
        />
      ) : null}

      <ProgressOverlay visible={agentProgress !== null} message={agentProgress ?? ''} />
    </View>
  );
}
