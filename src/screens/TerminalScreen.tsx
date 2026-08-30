/**
 * Terminal screen (docs/specs/terminal-screen.md).
 * - In-screen header (native nav bar hidden here) with the tabs bar embedded
 *   between the back and overflow buttons (no title text),
 *   native terminal surface for the SELECTED tab only (the native registry
 *   keeps other warm entries alive across view detach), state overlays,
 *   key accessory/editor bar above the soft keyboard, floating keyboard/upload
 *   controls when the keyboard is hidden, and edge-swipe tab switching.
 * - Keyboard tracking: RN Keyboard events plus measured viewport overlap keep
 *   the terminal and accessory keys above the IME on both platforms.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Keyboard, Platform, Pressable, Text, ToastAndroid, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexNative, GhostexTerminalView } from '../../modules/ghostex-native/src';
import ProgressOverlay from '../components/common/ProgressOverlay';
import PromptDialog from '../components/common/PromptDialog';
import DelayedSendDialog from '../components/sessions/DelayedSendDialog';
import EdgeSwipeZones from '../components/terminal/EdgeSwipeZones';
import ExportTranscriptSheet from '../components/terminal/ExportTranscriptSheet';
import PromptEditorSheet from '../components/terminal/PromptEditorSheet';
import TerminalFloatingControls from '../components/terminal/TerminalFloatingControls';
import TerminalKeyBar from '../components/terminal/TerminalKeyBar';
import TerminalMenu from '../components/terminal/TerminalMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar from '../components/terminal/TerminalTabsBar';
import { ChatBubbleIcon, ChevronLeftIcon, EllipsisIcon, TerminalPromptIcon } from '../components/terminal/icons';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import { isSessionChatSupportedAgent } from '../chat/session-chat-bridge';
import SessionChatWebView from '../chat/SessionChatWebView';
import { RenameCopy, SessionCopy } from '../copy';
import { summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import type { RootStackParamList } from '../navigation/types';
import { FORK_AGENT_ICONS } from '../sessions/sessionCommands';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { GhostexPalette } from '../theme/palette';
import {
  AGENT_OVERLAY_NONE,
  ANDROID_KEYBOARD_GAP,
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

export default function TerminalScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const tabs = useTerminalStore((state) => state.tabs);
  const selectedSessionKey = useTerminalStore((state) => state.selectedSessionKey);
  const selectTab = useTerminalStore((state) => state.selectTab);
  const closeTab = useTerminalStore((state) => state.closeTab);
  const openShellTab = useTerminalStore((state) => state.openShellTab);
  const settings = useSettingsStore((state) => state.settings);

  const { keyboardVisible, bottomInset, visibleWindowBottom } = useKeyboardMetrics();
  const isFocused = useIsFocused();
  const [tapKeyboardHint, setTapKeyboardHint] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  // Each pick of the menu's Search Conversation row opens the chat page's own
  // search box; the page has no search button of its own on this surface.
  const [chatSearchRequestId, setChatSearchRequestId] = useState(0);
  const [chatSessionNoteRequestId, setChatSessionNoteRequestId] = useState(0);
  const [chatSavedPromptsRequestId, setChatSavedPromptsRequestId] = useState(0);
  const [agentOverlay, setAgentOverlay] = useState<AgentOverlay>(AGENT_OVERLAY_NONE);
  const [agentProgress, setAgentProgress] = useState<string | null>(null);
  const [exportedTranscript, setExportedTranscript] = useState<ExportedTranscript | null>(null);
  const [startingTranscriptConversation, setStartingTranscriptConversation] = useState(false);
  const [exportedTranscriptError, setExportedTranscriptError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [keyboardOcclusionCorrection, setKeyboardOcclusionCorrection] = useState(0);
  const bottomEdgeFrameRef = useRef<View>(null);
  /** Session keys already auto-focused this visit (hide-keyboard-on-startup off). */
  const autoFocusedSessionsRef = useRef<Set<string>>(new Set());

  const activeTab = tabs.find((tab) => tab.sessionKey === selectedSessionKey) ?? null;
  const activeAgentId = useInventoryStore((state) =>
    sessionAgentIdFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary
    )
  );
  const activeProjectId = useInventoryStore((state) =>
    sessionProjectIdFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary
    )
  );
  const activeSession = useInventoryStore((state) =>
    sessionRecordFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary
    )
  );
  const sessionViewModeBySessionKey = useTerminalStore((state) => state.sessionViewModeBySessionKey);

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
    isSessionChatSupportedAgent(activeAgentId);
  const chatModeActive =
    chatCapable &&
    activeTab !== null &&
    (sessionViewModeBySessionKey[activeTab.sessionKey] ?? settings.preferredAgentInterface) === 'chat';
  const chatMachineTarget = chatCapable && activeTab !== null ? machineTargetFor(activeTab.machineId) : null;

  /*
   * Terminal → chat draft transfer counter, per session key. Entering chat
   * bumps the session's entry, which tells its (already mounted) chat page to
   * pull whatever the user had typed into the agent CLI into its composer.
   * Runtime-only: a transfer is a response to one switch, never a stored fact.
   */
  const [chatDraftTransferIds, setChatDraftTransferIds] = useState<Record<string, number>>({});

  /*
   * Chat → terminal draft transfer counter, per session key, and the exact
   * mirror of the one above: leaving chat bumps the session's entry, which
   * tells its chat page to park whatever is in the composer and hand it back
   * for the agent CLI. Runtime-only for the same reason.
   */
  const [handoffToTerminalIds, setHandoffToTerminalIds] = useState<Record<string, number>>({});

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
        current[chatQueueSessionKey] === count ? current : { ...current, [chatQueueSessionKey]: count }
      );
    },
    [chatQueueSessionKey]
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
    }, [showSessions])
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
      // Anything half-typed in the agent CLI belongs to the surface the user
      // is moving to, not the one they are leaving.
      setChatDraftTransferIds((current) => ({
        ...current,
        [sessionKey]: (current[sessionKey] ?? 0) + 1,
      }));
    } else {
      // Same rule, other direction: anything half-typed in the chat composer
      // belongs to the agent CLI the user is moving to.
      setHandoffToTerminalIds((current) => ({
        ...current,
        [sessionKey]: (current[sessionKey] ?? 0) + 1,
      }));
    }
    store.toggleChatMode(sessionKey);
  }, [dismissKeyboard]);

  const switchToTerminalForAgentPicker = useCallback((): void => {
    const store = useTerminalStore.getState();
    const sessionKey = store.selectedSessionKey;
    if (sessionKey === null) return;
    dismissKeyboard();
    if (store.chatModeArmed(sessionKey)) {
      store.setSessionViewMode(sessionKey, 'terminal');
    }
    const message = 'Please pick the model and effort in the CLI then switch back to the chat view';
    if (Platform.OS === 'android') {
      ToastAndroid.show(message, ToastAndroid.LONG);
    } else {
      Alert.alert(message);
    }
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
    [closeTab, settings.confirmTabClose]
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
    [selectTab]
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
      if (id === 'sessionNote' || id === 'savedPrompts') {
        setMenuVisible(false);
        if (!chatModeActive) {
          toggleChatView();
        }
        if (id === 'sessionNote') {
          setChatSessionNoteRequestId((current) => current + 1);
        } else {
          setChatSavedPromptsRequestId((current) => current + 1);
        }
        return;
      }
      handleMenuAction(id);
    },
    [chatModeActive, handleMenuAction, toggleChatView]
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

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          // WKWebView already contracts its visual viewport around the iOS
          // keyboard. Applying the native keyboard inset to its parent as
          // well moves the chat composer twice (all the way to the top).
          paddingBottom:
            keyboardVisible && (!chatModeActive || Platform.OS === 'android')
              ? bottomInset + keyboardOcclusionCorrection
              : 0,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole='button'
          accessibilityLabel='Back'
          hitSlop={8}
          style={styles.headerButton}
          onPress={showSessions}
        >
          <ChevronLeftIcon size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
        <TerminalTabsBar
          tabs={tabs}
          selectedSessionKey={selectedSessionKey}
          onSelect={handleSelectTab}
          onClose={(sessionKey) => {
            const tab = tabs.find((entry) => entry.sessionKey === sessionKey);
            if (tab !== undefined) requestCloseTab(tab);
          }}
        />
        {chatCapable && (
          <Pressable
            accessibilityRole='button'
            accessibilityLabel={chatModeActive ? 'Terminal view' : 'Chat view'}
            hitSlop={8}
            style={styles.headerButton}
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
          accessibilityRole='button'
          accessibilityLabel='More options'
          hitSlop={8}
          style={styles.headerButton}
          onPress={() => setMenuVisible(true)}
        >
          <EllipsisIcon size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      </View>

      <View style={styles.terminalArea}>
        {activeTab !== null && !chatModeActive ? (
          // Only the selected tab's terminal is mounted; the native registry
          // keeps other entries warm across view detach.
          <GhostexTerminalView
            sessionKey={activeTab.sessionKey}
            style={styles.terminal}
            onSingleTap={() => setTapKeyboardHint(true)}
          />
        ) : null}
        {activeTab !== null && chatMachineTarget !== null ? (
          /*
           * Keep the selected session's chat page mounted while terminal mode
           * is visible. Its bundle and first transcript read warm in advance,
           * and its offscreen preload frame owns no input region until the user
           * switches views. Toggling no longer destroys the conversation.
           */
          <SessionChatWebView
            key={activeTab.sessionKey}
            machine={chatMachineTarget}
            projectId={activeProjectId}
            sessionId={activeTab.ghostexSessionId ?? ''}
            terminalSessionKey={activeTab.sessionKey}
            onSwitchToTerminalForAgentPicker={switchToTerminalForAgentPicker}
            agentId={activeAgentId}
            customTranscriptWidthEnabled={settings.sessionChatCustomTranscriptWidthEnabled}
            fontFamily={settings.sessionChatFontFamily}
            theme={settings.sessionChatTheme}
            transcriptWidthPercent={settings.sessionChatTranscriptWidthPercent}
            verboseMode={settings.sessionChatVerboseMode}
            // The page cannot see live activity; the inventory poll supplies
            // that hint without acting as an input-availability lock.
            working={activeSession?.activity === 'working'}
            visible={chatModeActive}
            draftTransferRequestId={chatDraftTransferIds[activeTab.sessionKey] ?? 0}
            handoffToTerminalRequestId={handoffToTerminalIds[activeTab.sessionKey] ?? 0}
            openSearchRequestId={chatSearchRequestId}
            openSessionNoteRequestId={chatSessionNoteRequestId}
            openSavedPromptsRequestId={chatSavedPromptsRequestId}
            onQueueCountChange={handleChatQueueCount}
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
            accessibilityRole='button'
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
            bottomOffset={16}
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
        {keyBarVisible && activeTab !== null && !chatModeActive ? (
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
          // against the keyboard.
          <View style={{ height: !keyboardVisible || chatModeActive ? insets.bottom : 0 }} />
        )}
      </View>

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
        savedPromptsEnabled={chatCapable}
        searchConversationEnabled={chatModeActive}
        attachEnabled={uploadEnabled && !uploading}
        disconnectEnabled={activeTab !== null}
        killSessionEnabled={activeTab !== null && activeSession !== null}
        onSelect={handleTerminalMenuAction}
        onClose={() => setMenuVisible(false)}
        onDismissed={handleMenuDismissed}
      />

      {activeSession !== null ? (
        <>
          {agentOverlay.kind === 'rename' ? (
            <PromptDialog
              visible
              title={RenameCopy.title}
              body={RenameCopy.body}
              placeholder={RenameCopy.inputHint}
              initialValue={activeSession.title}
              error={agentOverlay.error}
              confirmLabel='Rename'
              onSubmit={(value) => void submitAgentRename(value)}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
            />
          ) : null}
          {agentOverlay.kind === 'delayedSend' ? (
            <DelayedSendDialog
              agentIcon={activeSession.agentIcon}
              agentName={activeSession.agentName.length > 0 ? activeSession.agentName : activeSession.agent}
              closeAfterDoneActive={activeSession.closeAfterDone}
              visible
              sessionTitle={agentSessionTitle}
              remainingLabel={activeSession.delayedSendRemainingLabel}
              sendWhenAllProjectSessionsStopActive={activeSession.sendWhenAllProjectSessionsStopActive}
              sendWhenAgentStopsActive={activeSession.sendWhenAgentStopsActive}
              onConfirm={(trigger, delayMs) => void runDelayedSend(trigger, delayMs)}
              onCancelTimer={() => void cancelDelayedSend()}
              onToggleCloseAfterDone={() => toggleCloseAfterDone()}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
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
