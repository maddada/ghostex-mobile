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
import { Alert, BackHandler, Keyboard, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexNative, GhostexTerminalView } from '../../modules/ghostex-native/src';
import EdgeSwipeZones from '../components/terminal/EdgeSwipeZones';
import TerminalFloatingControls from '../components/terminal/TerminalFloatingControls';
import TerminalKeyBar from '../components/terminal/TerminalKeyBar';
import TerminalOverflowMenu, {
  type OverflowMenuItem,
} from '../components/terminal/TerminalOverflowMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar from '../components/terminal/TerminalTabsBar';
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  TerminalPromptIcon,
} from '../components/terminal/icons';
import { pickAndSendAttachment } from '../components/terminal/uploads';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import { attachCommand, loginShellCommand } from '../commands/ghostexCli';
import { isSessionChatSupportedAgent } from '../chat/session-chat-bridge';
import SessionChatWebView from '../chat/SessionChatWebView';
import { resolveAgentIconId, type GhostexMobileSummary } from '../contract/mobileSummary';
import { ensureConnected, summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

const HEADER_HEIGHT = 44;
/** Deliberate separation between the Android IME boundary and the accessory bar. */
const ANDROID_KEYBOARD_GAP = 3;
/** How long an onSingleTap keeps the key bar optimistic before keyboard events decide. */
const TAP_KEYBOARD_HINT_TIMEOUT_MS = 1500;

function machineTargetFor(machineId: string): MachineConnectionTarget | null {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record === undefined) return null;
  return { id: record.id, host: record.host, username: record.username, port: record.port };
}

/**
 * Folder of the session shown in `tab` ('' when unknown): a shell tab reuses
 * its own starting directory; an attach tab resolves its session's project
 * path from the machine inventory.
 */
function sessionFolderFor(tab: TerminalTab | null): string {
  if (tab === null) return '';
  if (tab.kind === 'shell') return tab.cwd ?? '';
  if (tab.ghostexSessionId === undefined) return '';
  const summary = useInventoryStore.getState().inventoriesByMachineId[tab.machineId]?.summary;
  if (summary === null || summary === undefined) return '';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  if (session === undefined) return '';
  const project = summary.projects.find((entry) => entry.projectId === session.projectId);
  return project?.path ?? '';
}

/**
 * Resolved agent icon id of the session shown in `tab` ('terminal' when it is
 * a shell tab or the session is unknown) — drives the key bar's agent-hotkey
 * page. Pure so the screen can subscribe to it as an inventory selector.
 */
function sessionAgentIdFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): string {
  if (tab === null || tab.ghostexSessionId === undefined) return 'terminal';
  if (summary === null || summary === undefined) return 'terminal';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  if (session === undefined) return 'terminal';
  return resolveAgentIconId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
}

/**
 * gxserver projectId of the session shown in `tab` ('' while the inventory
 * has not resolved it) — the Session Chat CLI verbs address sessions by the
 * (projectId, sessionId) pair.
 */
function sessionProjectIdFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): string {
  if (tab === null || tab.ghostexSessionId === undefined) return '';
  if (summary === null || summary === undefined) return '';
  const session = summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId);
  return session?.projectId ?? '';
}

function patchTab(sessionKey: string, patch: Partial<TerminalTab>): void {
  useTerminalStore.setState((state) => ({
    tabs: state.tabs.map((tab) => (tab.sessionKey === sessionKey ? { ...tab, ...patch } : tab)),
  }));
}

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
  const [uploading, setUploading] = useState(false);
  const [keyboardOcclusionCorrection, setKeyboardOcclusionCorrection] = useState(0);
  const keyBarFrameRef = useRef<View>(null);
  /** Session keys already auto-focused this visit (hide-keyboard-on-startup off). */
  const autoFocusedSessionsRef = useRef<Set<string>>(new Set());

  const activeTab = tabs.find((tab) => tab.sessionKey === selectedSessionKey) ?? null;
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
  const chatModeSessionKeys = useTerminalStore((state) => state.chatModeSessionKeys);

  // Chat/terminal toggle (per tab): only agent sessions with a chat
  // projection and a resolved (projectId, sessionId) identity offer it.
  const chatCapable =
    activeTab !== null &&
    activeTab.kind === 'attach' &&
    activeTab.ghostexSessionId !== undefined &&
    activeProjectId.length > 0 &&
    isSessionChatSupportedAgent(activeAgentId);
  const chatModeActive =
    chatCapable && activeTab !== null && chatModeSessionKeys.includes(activeTab.sessionKey);
  const chatMachineTarget =
    chatModeActive && activeTab !== null ? machineTargetFor(activeTab.machineId) : null;

  // The native nav bar has no styling guarantee here; render our own header.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  // Adopt the routed tab once; in-screen switching then owns selection.
  useEffect(() => {
    const store = useTerminalStore.getState();
    const routed = route.params.sessionKey;
    if (
      store.tabs.some((tab) => tab.sessionKey === routed) &&
      store.selectedSessionKey !== routed
    ) {
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

  const reconcileKeyBarWithVisibleWindow = useCallback((): void => {
    if (!keyboardVisible || visibleWindowBottom === null) return;
    requestAnimationFrame(() => {
      keyBarFrameRef.current?.measureInWindow((_x, y, _width, height) => {
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
    reconcileKeyBarWithVisibleWindow();
  }, [keyboardVisible, reconcileKeyBarWithVisibleWindow, visibleWindowBottom]);

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
    // Entering chat parks the terminal (its warm native entry stays alive);
    // its soft keyboard must not linger over the chat composer.
    if (!store.chatModeSessionKeys.includes(sessionKey)) {
      dismissKeyboard();
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

  const handleUpload = useCallback(async (): Promise<void> => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === store.selectedSessionKey);
    if (tab === undefined || tab.state !== 'open' || uploading) return;
    setUploading(true);
    try {
      await pickAndSendAttachment(tab.machineId, tab.sessionKey);
    } catch {
      Alert.alert('Upload Failed', undefined, [{ text: 'OK' }]);
    } finally {
      setUploading(false);
    }
  }, [uploading]);

  const handleNewTerminal = useCallback(async (): Promise<void> => {
    const machineId = activeTab?.machineId ?? useMachinesStore.getState().selectedMachineId;
    if (machineId === null || machineId === undefined) return;
    const target = machineTargetFor(machineId);
    if (target === null) return;
    try {
      // New terminals open in the folder of the session being viewed.
      await openShellTab(target, { cwd: sessionFolderFor(activeTab) });
    } catch {
      // The store marks the tab failed; the state overlay surfaces it.
    }
  }, [activeTab, openShellTab]);

  const handleRefresh = useCallback((): void => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === store.selectedSessionKey);
    if (tab === undefined || tab.state !== 'open') return;
    void GhostexNative.refreshTerminalViewport(tab.sessionKey).catch(() => undefined);
  }, []);

  const uploadEnabled = activeTab !== null && activeTab.state === 'open';

  const menuItems: OverflowMenuItem[] = [
    {
      id: 'upload',
      label: 'Upload Image or File',
      disabled: !uploadEnabled || uploading,
      onPress: () => void handleUpload(),
    },
    { id: 'new-terminal', label: 'New Terminal', onPress: () => void handleNewTerminal() },
    { id: 'settings', label: 'Settings', onPress: () => navigation.navigate('Settings') },
    {
      id: 'disconnect',
      label: 'Disconnect',
      destructive: true,
      disabled: activeTab === null,
      onPress: () => {
        if (activeTab !== null) requestCloseTab(activeTab);
      },
    },
  ];

  return (
    <View
      style={[
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: keyboardVisible ? bottomInset + keyboardOcclusionCorrection : 0,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
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
            accessibilityRole="button"
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
          accessibilityRole="button"
          accessibilityLabel="More options"
          hitSlop={8}
          style={styles.headerButton}
          onPress={() => setMenuVisible(true)}
        >
          <EllipsisIcon size={22} color={GhostexPalette.FOREGROUND} />
        </Pressable>
      </View>

      <View style={styles.terminalArea}>
        {activeTab !== null &&
          (chatModeActive && chatMachineTarget !== null ? (
            /*
             * Chat mode swaps the surface INSIDE the same terminal area: the
             * tabs bar, header, and layout stay identical (no extra bar), and
             * the parked terminal's warm native entry survives the detach so
             * toggling back resumes exactly where it was.
             */
            <SessionChatWebView
              key={activeTab.sessionKey}
              machine={chatMachineTarget}
              projectId={activeProjectId}
              sessionId={activeTab.ghostexSessionId ?? ''}
              agentId={activeAgentId}
              style={styles.terminal}
            />
          ) : (
            // Only the selected tab's view is mounted; the native registry keeps
            // the other warm entries alive. Keep this host mounted while its
            // sessionKey changes so closing a tab cannot race native teardown
            // against destruction of the replacement terminal's host view.
            <GhostexTerminalView
              sessionKey={activeTab.sessionKey}
              style={styles.terminal}
              onSingleTap={() => setTapKeyboardHint(true)}
            />
          ))}
        {activeTab !== null && !chatModeActive && (
          <TerminalStateOverlay
            tab={activeTab}
            errorCaption={
              activeTab.error !== undefined ? summarizeFailure(activeTab.error, true) : null
            }
            onRetry={() => void reopenTab(activeTab)}
            onReconnect={() => void reopenTab(activeTab)}
          />
        )}
        {tabs.length > 1 && (
          <EdgeSwipeZones onPrev={() => switchTabBy(-1)} onNext={() => switchTabBy(1)} />
        )}
        {!keyBarVisible && !chatModeActive && (
          <TerminalFloatingControls
            showKeyboardButton={settings.keyboardButtonVisible}
            showUploadButton={settings.fileUploadButtonVisible}
            showRefreshButton={
              settings.refreshButtonVisible && activeTab?.kind === 'attach'
            }
            uploadEnabled={uploadEnabled}
            uploading={uploading}
            refreshEnabled={activeTab?.state === 'open'}
            keyboardShown={keyboardVisible}
            bottomOffset={16}
            onKeyboard={showKeyboard}
            onDismissKeyboard={dismissKeyboard}
            onUpload={() => void handleUpload()}
            onRefresh={handleRefresh}
          />
        )}
      </View>

      {keyBarVisible && activeTab !== null && !chatModeActive ? (
        <View
          ref={keyBarFrameRef}
          collapsable={false}
          onLayout={reconcileKeyBarWithVisibleWindow}
        >
          <TerminalKeyBar
            sessionKey={activeTab.sessionKey}
            agentId={activeAgentId}
            onDismissKeyboard={dismissKeyboard}
          />
        </View>
      ) : (
        // With the keyboard up (toolbar hidden), the container's bottom
        // padding already clears the IME; only add the home-indicator inset
        // while the keyboard is down.
        <View style={{ height: keyboardVisible ? 0 : insets.bottom }} />
      )}

      <TerminalOverflowMenu
        visible={menuVisible}
        topOffset={insets.top + HEADER_HEIGHT + 4}
        items={menuItems}
        onDismiss={() => setMenuVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  headerButton: {
    width: 44,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalArea: {
    flex: 1,
  },
  terminal: {
    flex: 1,
  },
});
