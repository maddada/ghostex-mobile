/**
 * Terminal screen (docs/specs/terminal-screen.md).
 * - In-screen header (native nav bar hidden here) with the tabs bar embedded
 *   between the back and overflow buttons (no title text),
 *   native terminal surface for the SELECTED tab only (the native registry
 *   keeps other warm entries alive across view detach), state overlays,
 *   key accessory/editor bar above the soft keyboard, floating keyboard/upload
 *   controls when the keyboard is hidden, and edge-swipe tab switching.
 * - Keyboard tracking: RN Keyboard events keep the terminal and accessory keys
 *   above the IME. Android resizes the container by the measured overlap; on iOS
 *   the terminal keeps its size (so its grid and the pty stay put) and slides
 *   with the keyboard: the bottom row above the key bar, the cursor row wins (`slidesWithKeyboard`).
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
import { measureInWindow } from '../components/common/measureInWindow';
import { bandRowFrame } from '../components/common/verticalBar/layout';
import {
  barBackgroundToEdges,
  railMenuItems,
  useContentTop,
  useHeaderPlacement,
  useHeaderMenu,
  useBandOverflow,
  useRailButtons,
  useRailOverflow,
  useVerticalBarSpace,
  type RailButtons,
} from '../components/common/verticalBar/VerticalBarArea';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import EdgeSwipeZones from '../components/terminal/EdgeSwipeZones';
import ExportTranscriptSheet from '../components/terminal/ExportTranscriptSheet';
import KeyBarDock from '../components/terminal/KeyBarDock';
import PromptEditorSheet from '../components/terminal/PromptEditorSheet';
import TerminalFloatingControls from '../components/terminal/TerminalFloatingControls';
import TerminalKeyBar, { KEY_BAR_HEIGHT } from '../components/terminal/TerminalKeyBar';
import TerminalMenu, { type TerminalMenuActionId } from '../components/terminal/TerminalMenu';
import TerminalSkillsMenu from '../components/terminal/TerminalSkillsMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar, { MIN_TAB_WIDTH } from '../components/terminal/TerminalTabsBar';
import { ChatBubbleIcon, ChevronLeftIcon, EllipsisIcon, TerminalPromptIcon } from '../components/terminal/icons';
import { terminalObstruction, terminalSlideOffset } from '../components/terminal/terminalKeyboardSlide';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import { isSessionChatSupportedAgent } from '../chat/session-chat-helpers';
import NativeChatScreen from '../chat/native/NativeChatScreen';
import SessionLinksSheet from '../chat/native/SessionLinksSheet';
import { useSessionLinksRefresh } from '../chat/native/useSessionLinksRefresh';
import { useTranscriptTheme } from '../chat/native/transcript/theme';
import { DuoChromeCopy, RenameCopy, SessionCopy, TerminalHeaderCopy } from '../copy';
import { summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import type { RootStackParamList } from '../navigation/types';
import { FORK_AGENT_ICONS, renameInitialTitle } from '../sessions/sessionCommands';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { setChatGridSessionKey } from '../terminal/chatGridClaim';
import { setMountedSessionKeys } from '../terminal/zmxDisplay';
import { GhostexPalette } from '../theme/palette';
import { useMachinesStore } from '../machines/store';
import { VoiceButton } from '../voice/VoiceButton';
import { readAloudChatKey, setReadAloudOnScreen } from '../voice/readAloud';
import { useOpenMachineLink } from '../webPreview/useOpenMachineLink';
import {
  AGENT_OVERLAY_NONE,
  ANDROID_KEYBOARD_GAP,
  HEADER_HEIGHT,
  HEADER_PADDING,
  machineTargetFor,
  sessionAgentIdFor,
  sessionProjectIdFor,
  sessionRecordFor,
  TAP_KEYBOARD_HINT_TIMEOUT_MS,
  type AgentOverlay,
  type ExportedTranscript,
} from './terminal-screen/session-lookups';
import { styles } from './terminal-screen/styles';
import { useTerminalAgentActions } from './terminal-screen/use-agent-actions';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

/** The header buttons of the status band's row: 44 pt wide, side by side (`headerButton`). */
const TERMINAL_BAND_BUTTONS = { size: 44, gap: 0 } as const;

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
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [exportedTranscript, setExportedTranscript] = useState<ExportedTranscript | null>(null);
  const [startingTranscriptConversation, setStartingTranscriptConversation] = useState(false);
  const [exportedTranscriptError, setExportedTranscriptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [keyboardOcclusionCorrection, setKeyboardOcclusionCorrection] = useState(0);
  const bottomEdgeFrameRef = useRef<ViewInstance>(null);
  // The iOS terminal's cursor row and size, which decide how far it slides with the keyboard (below).
  const [caretTop, setCaretTop] = useState<number | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(0);
  const [keyBarHeight, setKeyBarHeight] = useState(0);
  /** Session keys already auto-focused this visit (hide-keyboard-on-startup off). */
  const autoFocusedSessionsRef = useRef<Set<string>>(new Set());

  const openMachineLink = useOpenMachineLink();
  const activeTab = tabs.find((tab) => tab.sessionKey === selectedSessionKey) ?? null;
  const activeMachine = useMachinesStore((state) =>
    activeTab === null ? null : (state.machines.find((entry) => entry.id === activeTab.machineId) ?? null),
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

  // Chat/terminal toggle (per tab): only agent sessions with a chat
  // projection and a resolved (projectId, sessionId) identity offer it.
  const chatCapable =
    activeTab !== null &&
    activeTab.kind === 'attach' &&
    activeTab.ghostexSessionId !== undefined &&
    activeProjectId.length > 0 &&
    isSessionChatSupportedAgent(activeAgentId) &&
    // CDXC:AgentBox 2026-10-01 SEE-ALSO: gx-core's `session_chat_view_unavailable`. A box session's agent runs in its box, so no transcript exists here and it stays on its terminal; a draft whose box only starts with its first message (`pending`) keeps chat until that message.
    !(activeSession?.agentbox !== undefined && activeSession.agentbox.pending !== true);
  const chatModeActive =
    chatCapable &&
    activeTab !== null &&
    (sessionViewModeBySessionKey[activeTab.sessionKey] ?? settings.preferredAgentInterface) === 'chat';
  const chatMachineTarget = chatCapable && activeTab !== null ? machineTargetFor(activeTab.machineId) : null;
  useSessionLinksRefresh(activeMachine, activeSession?.sessionId, chatModeActive);
  // iOS terminal mode: the terminal view keeps its size, so its grid and the pty stay put, and slides with
  // the keyboard instead (terminal-screen.md §2), on every iPhone (decision Q761 in terminalKeyboardSlide.ts).
  // The one place that decides it.
  const slidesWithKeyboard = Platform.OS === 'ios' && !chatModeActive;
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

  // zmx display policy: the terminal view is on screen for exactly one session
  // key (or none, in chat view / when another screen is on top).
  const mountedChatSessionKey = activeTab !== null && chatModeActive && isFocused ? activeTab.sessionKey : null;
  useEffect(() => {
    setMountedSessionKeys(mountedTerminalSessionKey, mountedChatSessionKey);
    setChatGridSessionKey(mountedChatSessionKey);
  }, [mountedTerminalSessionKey, mountedChatSessionKey]);
  // A tab opened in Chat View has no terminal yet (`openChatTab`); showing its terminal attaches it.
  const activeTabDetached = activeTab?.state === 'detached';
  useEffect(() => {
    if (mountedTerminalSessionKey !== null && activeTabDetached) {
      void useTerminalStore.getState().ensureTerminalAttached(mountedTerminalSessionKey);
    }
  }, [mountedTerminalSessionKey, activeTabDetached]);
  // Read aloud speaks only the chat on screen, locked or not; leaving this screen leaves the chat.
  const readAloudKey =
    mountedChatSessionKey !== null && activeTab !== null && activeTab.ghostexSessionId !== undefined
      ? readAloudChatKey(activeTab.machineId, activeProjectId, activeTab.ghostexSessionId)
      : null;
  const readAloudTitle =
    activeSession !== null && activeSession.displayTitle.length > 0
      ? activeSession.displayTitle
      : (activeTab?.title ?? '');
  useEffect(() => {
    setReadAloudOnScreen(
      readAloudKey === null || activeTab === null
        ? null
        : {
            key: readAloudKey,
            title: readAloudTitle,
            machineId: activeTab.machineId,
            sessionId: activeTab.ghostexSessionId ?? '',
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
  const keyBarDocked = slidesWithKeyboard && keyBarVisible && activeTab !== null;
  const obstruction = slidesWithKeyboard
    ? terminalObstruction(bottomInset, keyBarDocked ? keyBarHeight || KEY_BAR_HEIGHT : 0, insets.bottom)
    : 0;
  const terminalOffset = terminalSlideOffset(caretTop, terminalHeight, obstruction);
  // Without a key bar the floating controls stay above the keyboard: the terminal area no longer shrinks.
  const floatingLift = slidesWithKeyboard ? Math.max(0, bottomInset - insets.bottom) : 0;

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

  const toggleChatView = useCallback((): void => {
    const store = useTerminalStore.getState();
    const sessionKey = store.selectedSessionKey;
    if (sessionKey === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const enteringChat = !store.chatModeArmed(sessionKey);
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
    store.toggleChatMode(sessionKey);
  }, [dismissKeyboard]);

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
    handleUpload,
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
          navigation.navigate('Docs', {
            machineId: activeTab.machineId,
            projectId: activeProject.projectId,
            projectName: activeProject.name ?? '',
            projectPath: activeProject.path ?? '',
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
        }
        setChatSessionNoteRequestId((current) => current + 1);
        return;
      }
      handleMenuAction(id);
    },
    [activeProject, activeTab, chatModeActive, handleMenuAction, navigation, setMenuVisible, toggleChatView],
  );

  const uploadEnabled = activeTab !== null && (chatModeActive ? agentActionsCapable : activeTab.state === 'open');
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

  // The header's buttons on top, or in the iPhone Duo's status band (band); in the rail they are
  // `railButtons` below.
  const headerButtons = (buttonStyle: StyleProp<ViewStyle>) => (
    <>
      <VoiceButton
        machine={activeMachine}
        style={buttonStyle}
        color={GhostexPalette.FOREGROUND}
        size={20}
        activeFill={false}
      />
      {chatCapable && bandOverflow.shows('view') && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={chatModeActive ? TerminalHeaderCopy.terminalView : TerminalHeaderCopy.chatView}
          hitSlop={8}
          style={buttonStyle}
          onPress={toggleChatView}
        >
          {chatModeActive ? (
            <TerminalPromptIcon size={19} color={GhostexPalette.FOREGROUND} />
          ) : (
            <ChatBubbleIcon size={19} color={GhostexPalette.FOREGROUND} />
          )}
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
        <EllipsisIcon size={22} color={GhostexPalette.FOREGROUND} />
      </Pressable>
    </>
  );
  const backButton = (buttonStyle: StyleProp<ViewStyle>) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={DuoChromeCopy.back}
      hitSlop={8}
      style={buttonStyle}
      onPress={showSessions}
    >
      <ChevronLeftIcon size={22} color={GhostexPalette.FOREGROUND} />
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
  // The screen reaches the window edges: the strip under the iPhone Duo's rail shows what the screen
  // shows (the chat theme's page in chat view, black in the terminal).
  const chatBackground = useTranscriptTheme().background;
  const surfaceBackground = chatModeActive ? chatBackground : GhostexPalette.TERMINAL_BACKGROUND;
  // The same buttons standing in the iPhone Duo's side bar below the status items (rail): Back never
  // moves into the menu. The voice button has no rail entry: the rail exists only on iOS, where it does
  // not render (VOICE_SUPPORTED). Memoized on the header's inputs, so terminal output and tab updates
  // do not republish the side bar.
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
          icon: (size) => <ChevronLeftIcon size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: showSessions,
        },
        ...(chatCapable
          ? [
              {
                key: 'view',
                label: chatModeActive ? TerminalHeaderCopy.terminalView : TerminalHeaderCopy.chatView,
                icon: (size: number) =>
                  chatModeActive ? (
                    <TerminalPromptIcon size={size - 3} color={GhostexPalette.FOREGROUND} />
                  ) : (
                    <ChatBubbleIcon size={size - 3} color={GhostexPalette.FOREGROUND} />
                  ),
                onPress: toggleChatView,
              },
            ]
          : []),
        {
          key: 'more',
          label: DuoChromeCopy.more,
          icon: (size) => <EllipsisIcon size={size} color={GhostexPalette.FOREGROUND} />,
          onPress: openMenu,
        },
      ],
    }),
    [chatCapable, chatModeActive, toggleChatView, showSessions, openMenu],
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

  return (
    <View
      style={[
        styles.container,
        {
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
        {inRail ? null : backButton(styles.headerButton)}
        <TerminalTabsBar
          headerColor={GhostexPalette.TERMINAL_BACKGROUND}
          tabs={tabs}
          selectedSessionKey={selectedSessionKey}
          onSelect={handleSelectTab}
          onClose={(sessionKey) => {
            const tab = tabs.find((entry) => entry.sessionKey === sessionKey);
            if (tab !== undefined) requestCloseTab(tab);
          }}
        />
        {inRail ? null : headerButtons(styles.headerButton)}
      </View>

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
            {activeTab.error ? summarizeFailure(activeTab.error, true) : 'Agent startup failed.'} Tap to retry.
          </Text>
        </Pressable>
      ) : null}
      <View
        style={slidesWithKeyboard ? [styles.terminalArea, styles.terminalAreaSliding] : styles.terminalArea}
        onLayout={slidesWithKeyboard ? (event) => setTerminalHeight(event.nativeEvent.layout.height) : undefined}
      >
        {activeTab !== null && !chatModeActive ? (
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
        ) : null}
        {activeTab !== null && chatMachineTarget !== null ? (
          /*
           * Keep the selected session's chat screen mounted while terminal mode
           * is visible. Its first transcript read warms in advance, and while
           * hidden it owns no input region until the user switches views.
           * Toggling no longer destroys the conversation.
           *
           * CDXC:SessionChat 2026-09-25 DECISION:
           * User (2026-09-25): delete the phone's "Web (previous)" chat fallback so the phone runs only the native Rust chat. NativeChatScreen is the only chat view; the WebView chat, the Settings > Chat view choice and its bundled page are gone, and a stored `sessionChatView: 'web'` is ignored. Supersedes the earlier 2026-09-25 decision that kept the WebView as a fallback.
           */
          <NativeChatScreen
            key={activeTab.sessionKey}
            machine={chatMachineTarget}
            projectId={activeProjectId}
            sessionId={activeTab.ghostexSessionId ?? ''}
            onSwitchToTerminal={() => {
              if (chatModeActive) toggleChatView();
            }}
            hostActions={
              agentActionsCapable && activeSession !== null ? NATIVE_CHAT_HOST_ACTIONS : NO_NATIVE_CHAT_HOST_ACTIONS
            }
            onHostAction={(action) => {
              if (action === 'closeAfterDone') void toggleCloseAfterDone();
              else handleTerminalMenuAction(action as TerminalMenuActionId);
            }}
            visible={chatModeActive}
            openSearchRequestId={chatSearchRequestId}
            openSessionNoteRequestId={chatSessionNoteRequestId}
            onQueueCountChange={handleChatQueueCount}
            links={{ links: activeSession?.links, onOpen: () => setLinksSheetVisible(true) }}
            style={styles.terminal}
          />
        ) : null}
        {activeTab !== null && !chatModeActive && (
          <TerminalStateOverlay
            tab={activeTab}
            errorCaption={activeTab.error !== undefined ? summarizeFailure(activeTab.error, true) : null}
            onRetry={() => void reopenTab(activeTab)}
            onReconnect={() => void reopenTab(activeTab)}
          />
        )}
        {/*
          Queued prompts are invisible from the terminal — they never reach the
          agent CLI until the server scheduler delivers them — so the terminal
          view says how many are waiting and takes one tap to the chat view,
          which is where they can be edited, reordered or sent. Top-left, out of
          the way of the floating controls at the bottom, and gone at zero.
        */}
        {!chatModeActive && activeQueuedPromptCount > 0 ? (
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
        ) : null}
        {tabs.length > 1 && <EdgeSwipeZones onPrev={() => switchTabBy(-1)} onNext={() => switchTabBy(1)} />}
        {!keyBarVisible && !chatModeActive && (
          <TerminalFloatingControls
            showKeyboardButton={settings.keyboardButtonVisible}
            showUploadButton={settings.fileUploadButtonVisible}
            showRefreshButton={settings.refreshButtonVisible && activeTab?.kind === 'attach'}
            uploadEnabled={uploadEnabled}
            uploading={uploading}
            refreshEnabled={activeTab?.state === 'open'}
            keyboardShown={keyboardVisible}
            bottomOffset={16 + floatingLift}
            onKeyboard={showKeyboard}
            onDismissKeyboard={dismissKeyboard}
            onUpload={() => void handleUpload('file')}
            onRefresh={handleRefresh}
          />
        )}
      </View>

      {/*
        The screen's bottom edge, always mounted and measurable: the extra-keys
        toolbar while it is up, otherwise the bottom margin.
      */}
      <View ref={bottomEdgeFrameRef} collapsable={false} onLayout={reconcileBottomEdgeWithVisibleWindow}>
        {slidesWithKeyboard ? (
          // The terminal view ends above the home-indicator inset, with or without the keyboard; the key
          // bar rides over the keyboard (the dock below), not in this flow.
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
        <KeyBarDock shown={keyBarDocked} inset={bottomInset} hideMs={hideMotionMs} onHeightChange={setKeyBarHeight}>
          {activeTab !== null ? (
            <TerminalKeyBar
              sessionKey={activeTab.sessionKey}
              agentId={activeAgentId}
              onDismissKeyboard={dismissKeyboard}
            />
          ) : null}
        </KeyBarDock>
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
        sessionNoteEnabled={chatCapable && (activeSession?.agentSessionId.length ?? 0) > 0}
        searchConversationEnabled={chatModeActive}
        docsEnabled={activeProject !== null && (activeProject.path ?? '').length > 0}
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
