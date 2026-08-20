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
import {
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  ToastAndroid,
  View,
} from 'react-native';
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
import TerminalMenu, { type TerminalMenuActionId } from '../components/terminal/TerminalMenu';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import TerminalTabsBar from '../components/terminal/TerminalTabsBar';
import { createdSessionId, runGhostexCli } from '../components/sessions/cli';
import {
  ChatBubbleIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  TerminalPromptIcon,
} from '../components/terminal/icons';
import { pickAndSendAttachment } from '../components/terminal/uploads';
import { useKeyboardMetrics } from '../components/terminal/useKeyboardMetrics';
import {
  acknowledgeAttentionCommand,
  attachCommand,
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createAgentCommand,
  delayedSendCommand,
  exportSessionTranscriptCommand,
  forkSessionCommand,
  loginShellCommand,
  reloadSessionCommand,
  requestSessionRenameCommand,
  sendSessionChatMessageCommand,
  sleepSessionCommand,
  wakeSessionCommand,
} from '../commands/ghostexCli';
import { isSessionChatSupportedAgent } from '../chat/session-chat-bridge';
import SessionChatWebView from '../chat/SessionChatWebView';
import {
  resolveAgentIconId,
  type GhostexMobileSummary,
  type GhostexSession,
} from '../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy } from '../copy';
import { ensureConnected, summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import {
  FORK_AGENT_ICONS,
  lifecycleMutation,
  renameMutation,
  runSessionCommand,
} from '../sessions/sessionCommands';
import { useSettingsStore } from '../settings/store';
import { acknowledgeSessionAttention } from '../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import { GhostexPalette } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Terminal'>;

/** Which Agent Actions surface (if any) is on top of the terminal screen. */
type AgentOverlay =
  | { kind: 'none' }
  | { kind: 'rename'; error: string | null }
  | { kind: 'delayedSend' }
  | { kind: 'promptEditor'; sending: boolean };

const AGENT_OVERLAY_NONE: AgentOverlay = { kind: 'none' };

/**
 * A finished Export Transcript run, as the result sheet needs it. The markdown
 * file lives on the machine, so everything here describes where it landed and
 * what a follow-up conversation on that same machine would be started from.
 */
type ExportedTranscript = {
  machine: MachineRecord;
  projectId: string;
  /** Session the transcript came from — the sheet's subtitle. */
  sessionTitle: string;
  /** Launcher agent id for the follow-up session ('' hides that choice). */
  agentId: string;
  /** Human name of that agent, for the follow-up row's description. */
  agentLabel: string;
  /** Absolute path of the exported markdown file on the machine. */
  path: string;
};

const HEADER_HEIGHT = 44;
/** Deliberate separation between the Android IME boundary and the screen's bottom edge. */
const ANDROID_KEYBOARD_GAP = 3;
/** How long an onSingleTap keeps the key bar optimistic before keyboard events decide. */
const TAP_KEYBOARD_HINT_TIMEOUT_MS = 1500;

/**
 * Plan 015 §7: the follow-up session's staged first input. A bare mention of
 * the exported markdown plus one trailing space — gxserver types it into the
 * new agent's input and never submits it, so the user writes their own prompt
 * around it. Nothing is ever sent on their behalf.
 */
function transcriptMentionDraft(path: string): string {
  return `@${path} `;
}

function machineRecordFor(machineId: string): MachineRecord | null {
  return useMachinesStore.getState().machines.find((machine) => machine.id === machineId) ?? null;
}

function machineTargetFor(machineId: string): MachineConnectionTarget | null {
  const record = machineRecordFor(machineId);
  if (record === null) return null;
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

/**
 * Full inventory record of the session shown in `tab` (null while unknown) —
 * the Agent Actions menu needs its live title, sleep state, delayed-send
 * countdown, and activity. Pure so the screen can subscribe to it: the record
 * is the same object identity until the machine's inventory changes.
 */
function sessionRecordFor(
  tab: TerminalTab | null,
  summary: GhostexMobileSummary | null | undefined,
): GhostexSession | null {
  if (tab === null || tab.ghostexSessionId === undefined) return null;
  if (summary === null || summary === undefined) return null;
  return summary.sessions.find((entry) => entry.sessionId === tab.ghostexSessionId) ?? null;
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
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  const activeProjectId = useInventoryStore((state) =>
    sessionProjectIdFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  const activeSession = useInventoryStore((state) =>
    sessionRecordFor(
      activeTab,
      activeTab === null ? undefined : state.inventoriesByMachineId[activeTab.machineId]?.summary,
    ),
  );
  const chatModeSessionKeys = useTerminalStore((state) => state.chatModeSessionKeys);

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
    chatCapable && activeTab !== null && chatModeSessionKeys.includes(activeTab.sessionKey);
  const chatMachineTarget =
    chatCapable && activeTab !== null ? machineTargetFor(activeTab.machineId) : null;

  /*
   * Terminal → chat draft transfer counter, per session key. Entering chat
   * bumps the session's entry, which tells its (already mounted) chat page to
   * pull whatever the user had typed into the agent CLI into its composer.
   * Runtime-only: a transfer is a response to one switch, never a stored fact.
   */
  const [chatDraftTransferIds, setChatDraftTransferIds] = useState<Record<string, number>>({});

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
    const enteringChat = !store.chatModeSessionKeys.includes(sessionKey);
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
    }
    store.toggleChatMode(sessionKey);
  }, [dismissKeyboard]);

  const switchToTerminalForAgentPicker = useCallback((): void => {
    const store = useTerminalStore.getState();
    const sessionKey = store.selectedSessionKey;
    if (sessionKey === null) return;
    dismissKeyboard();
    if (store.chatModeSessionKeys.includes(sessionKey)) {
      store.toggleChatMode(sessionKey);
    }
    const message =
      'Please pick the model and effort in the CLI then switch back to the chat view';
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

  /** The (machine, projectId, session) triple the Agent Actions verbs need. */
  const agentTarget = useCallback((): {
    machine: MachineRecord;
    projectId: string;
    session: GhostexSession;
    tab: TerminalTab;
  } | null => {
    if (activeTab === null || activeProjectId.length === 0 || activeSession === null) return null;
    const machine = machineRecordFor(activeTab.machineId);
    if (machine === null) return null;
    return { machine, projectId: activeProjectId, session: activeSession, tab: activeTab };
  }, [activeProjectId, activeSession, activeTab]);

  const reportAgentFailure = useCallback((title: string, error: unknown): void => {
    Alert.alert(title, error instanceof Error ? error.message : String(error), [{ text: 'OK' }]);
  }, []);

  /** Deliver text to the session through the Session Chat send endpoint. */
  const sendChatText = useCallback(
    async (text: string): Promise<void> => {
      const target = agentTarget();
      if (target === null) throw new Error('This session has no chat identity yet.');
      await runGhostexCli(
        target.machine,
        sendSessionChatMessageCommand(target.session.sessionId, target.projectId, text),
      );
    },
    [agentTarget],
  );

  /**
   * Chat-mode sink for user-authored sends (attachments, Prompt Editor).
   * Desktop parity: sending to a session is interacting with it, so it also
   * clears the session's attention status.
   */
  const sendChatMessageFromUser = useCallback(
    async (text: string): Promise<void> => {
      await sendChatText(text);
      const target = agentTarget();
      if (target !== null) {
        acknowledgeSessionAttention(target.machine.id, target.session.sessionId);
      }
    },
    [agentTarget, sendChatText],
  );

  const submitAgentRename = useCallback(
    async (value: string): Promise<void> => {
      const target = agentTarget();
      if (target === null) return;
      const title = value.trim();
      if (title.length === 0) {
        setAgentOverlay({ kind: 'rename', error: RenameCopy.emptyTitleError });
        return;
      }
      setAgentOverlay(AGENT_OVERLAY_NONE);
      const { machine, projectId, session } = target;
      const result = await runSessionCommand(
        machine,
        requestSessionRenameCommand(session.sessionId, projectId, title, activeAgentId),
        {
          optimisticChange: renameMutation(session.sessionId, title),
          onError: (message) => Alert.alert('Rename Failed', message, [{ text: 'OK' }]),
        },
      );
      /*
       * Agent sessions keep their title inside the agent CLI, so gxserver only
       * records the request and tells the client to stage the CLI's own rename
       * command. gpui types it into the mounted terminal; the phone has no
       * terminal in front of the user in chat mode, so it goes through the
       * session-chat send endpoint, which reaches the TUI either way.
       */
      if (result?.json?.shouldSendAgentRenameCommand !== true) return;
      const command = activeAgentId === 'pi' ? 'name' : 'rename';
      try {
        await sendChatText(`/${command} ${title}`);
      } catch (error) {
        reportAgentFailure('Rename Failed', error);
      }
    },
    [activeAgentId, agentTarget, reportAgentFailure, sendChatText],
  );

  const runAgentSleep = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    const { machine, projectId, session } = target;
    const sleeping = session.isSleeping;
    // `closeWarmSessionId` closes this session's tab as part of the sleep, so
    // the screen's "no tabs left" effect returns to Sessions on its own — a
    // slept session has no surface left for this screen to show.
    await runSessionCommand(
      machine,
      sleeping
        ? wakeSessionCommand(session.sessionId, projectId)
        : sleepSessionCommand(session.sessionId, projectId),
      sleeping
        ? {
            optimisticChange: lifecycleMutation(session.sessionId, false),
            onError: (message) => Alert.alert('Wake Failed', message, [{ text: 'OK' }]),
          }
        : {
            closeWarmSessionId: session.sessionId,
            optimisticChange: lifecycleMutation(session.sessionId, true),
            onError: (message) => Alert.alert('Sleep Failed', message, [{ text: 'OK' }]),
          },
    );
  }, [agentTarget]);

  /*
   * Delayed Send / Cancel Timer are renderer commands owned by a connected
   * desktop app. On a headless machine the CLI says so; surface that instead
   * of inventing a phone-side timer that would not survive the app closing.
   */
  const runDelayedSend = useCallback(
    async (trigger: Parameters<typeof delayedSendCommand>[1], delayMs: number): Promise<void> => {
      const target = agentTarget();
      if (target === null) return;
      setAgentOverlay(AGENT_OVERLAY_NONE);
      await runSessionCommand(target.machine, delayedSendCommand(target.session.sessionId, trigger, delayMs), {
        onError: (message) => Alert.alert('Delayed Send Failed', message, [{ text: 'OK' }]),
      });
    },
    [agentTarget],
  );

  const cancelDelayedSend = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    await runSessionCommand(
      target.machine,
      cancelDelayedSendCommand(target.session.sessionId),
      { onError: (message) => Alert.alert('Delayed Send Failed', message, [{ text: 'OK' }]) },
    );
  }, [agentTarget]);

  const toggleCloseAfterDone = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    await runSessionCommand(
      target.machine,
      closeAfterDoneCommand(target.session.sessionId),
      { onError: (message) => Alert.alert('Session Automation Failed', message, [{ text: 'OK' }]) },
    );
  }, [agentTarget]);

  const runAgentFork = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    const { machine, session } = target;
    setAgentProgress(ProgressCopy.creatingTerminal(session.projectName));
    try {
      const result = await runGhostexCli(machine, forkSessionCommand(session.sessionId));
      await useInventoryStore.getState().refreshMachine(machine);
      setAgentProgress(null);
      const forkedId = createdSessionId(result);
      if (forkedId === null) return;
      // Creation-flow parity with the sessions drawer: the fork becomes the
      // visible session instead of leaving the user on the original.
      const forked = useInventoryStore
        .getState()
        .inventoriesByMachineId[machine.id]?.summary?.sessions.find(
          (entry) => entry.sessionId === forkedId,
        );
      const sessionKey = await useTerminalStore.getState().attachSession(machine, {
        sessionId: forkedId,
        projectId:
          forked !== undefined && forked.projectId.length > 0 ? forked.projectId : undefined,
        title: forked?.displayTitle,
      });
      useTerminalStore.getState().selectTab(sessionKey);
    } catch (error) {
      setAgentProgress(null);
      reportAgentFailure('Fork Failed', error);
    }
  }, [agentTarget, reportAgentFailure]);

  const runAgentFullReload = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    const { machine, projectId, session } = target;
    setAgentProgress('Reloading session…');
    try {
      await runGhostexCli(machine, reloadSessionCommand(session.sessionId));
    } catch (rendererError) {
      /*
       * Full Reload is a renderer command: it only exists while a desktop
       * Ghostex app is connected to that daemon. Headless machines (the common
       * case for a phone) have no renderer, so compose the same effect from
       * the two daemon-owned lifecycle endpoints — exactly what the web app
       * does unconditionally for this action.
       */
      try {
        await runGhostexCli(machine, sleepSessionCommand(session.sessionId, projectId));
        await runGhostexCli(machine, wakeSessionCommand(session.sessionId, projectId));
      } catch {
        setAgentProgress(null);
        reportAgentFailure('Full Reload Failed', rendererError);
        return;
      }
    }
    await useInventoryStore.getState().refreshMachineFresh(machine);
    setAgentProgress(null);
  }, [agentTarget, reportAgentFailure]);

  /*
   * Export Transcript: the daemon parses the agent's own transcript file and
   * writes the markdown next to its state, so the phone only carries the
   * selector out and the absolute path back. Unsupported agents and unreadable
   * transcripts come back as the daemon's own message.
   */
  const runExportTranscript = useCallback(async (): Promise<void> => {
    const target = agentTarget();
    if (target === null) return;
    setAgentOverlay(AGENT_OVERLAY_NONE);
    const { machine, projectId, session } = target;
    setAgentProgress('Exporting transcript…');
    try {
      const result = await runGhostexCli(
        machine,
        exportSessionTranscriptCommand(session.sessionId, projectId),
      );
      setAgentProgress(null);
      const path = typeof result.json?.path === 'string' ? result.json.path.trim() : '';
      if (path.length === 0) {
        throw new Error('gxserver exported the transcript without reporting its path.');
      }
      setStartingTranscriptConversation(false);
      setExportedTranscriptError(null);
      setExportedTranscript({
        machine,
        projectId,
        sessionTitle:
          session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle,
        agentId: session.agent.trim(),
        agentLabel: session.agentName.length > 0 ? session.agentName : session.agent,
        path,
      });
    } catch (error) {
      setAgentProgress(null);
      reportAgentFailure('Export Transcript Failed', error);
    }
  }, [agentTarget, reportAgentFailure]);

  /**
   * "Start new conversation": launch the same agent again in the same project
   * on the same machine, with the exported path staged as the new session's
   * first input. `create-agent --first-input-draft` has gxserver type that
   * mention into the agent's own input once the provider starts and stop
   * there — the phone never sends anything for the user.
   */
  const startTranscriptConversation = useCallback(async (): Promise<void> => {
    if (exportedTranscript === null || startingTranscriptConversation) return;
    const { machine, projectId, agentId, path } = exportedTranscript;
    if (agentId.length === 0) return;
    setStartingTranscriptConversation(true);
    setExportedTranscriptError(null);
    try {
      const created = await runGhostexCli(
        machine,
        createAgentCommand(agentId, projectId, transcriptMentionDraft(path)),
      );
      const sessionId = createdSessionId(created);
      if (sessionId === null) {
        throw new Error('gxserver created the session without reporting its id.');
      }
      await useInventoryStore.getState().refreshMachine(machine);
      // Creation-flow parity with Fork: the new conversation becomes the
      // visible session instead of leaving the user on the exported one.
      const record = useInventoryStore
        .getState()
        .inventoriesByMachineId[machine.id]?.summary?.sessions.find(
          (entry) => entry.sessionId === sessionId,
        );
      const sessionKey = await useTerminalStore.getState().attachSession(machine, {
        sessionId,
        projectId,
        title: record?.displayTitle,
      });
      useTerminalStore.getState().selectTab(sessionKey);
      setStartingTranscriptConversation(false);
      setExportedTranscript(null);
    } catch (error) {
      setStartingTranscriptConversation(false);
      setExportedTranscriptError(error instanceof Error ? error.message : String(error));
    }
  }, [exportedTranscript, startingTranscriptConversation]);

  const submitPromptEditor = useCallback(
    async (text: string): Promise<void> => {
      const target = agentTarget();
      if (target === null) return;
      setAgentOverlay({ kind: 'promptEditor', sending: true });
      try {
        if (chatModeActive) {
          await sendChatMessageFromUser(text);
        } else {
          // No trailing newline: the prompt lands in the TUI input for the
          // user to review and submit, matching the desktop editor's insert.
          await GhostexNative.sendText(target.tab.sessionKey, text);
        }
        setAgentOverlay(AGENT_OVERLAY_NONE);
      } catch (error) {
        setAgentOverlay(AGENT_OVERLAY_NONE);
        reportAgentFailure('Send Failed', error);
      }
    },
    [agentTarget, chatModeActive, reportAgentFailure, sendChatMessageFromUser],
  );

  const handleUpload = useCallback(async (): Promise<void> => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === store.selectedSessionKey);
    if (tab === undefined || uploading) return;
    // Chat mode has the terminal parked behind the chat surface, so the
    // reference is sent as a message and the native terminal need not be open.
    if (!chatModeActive && tab.state !== 'open') return;
    setUploading(true);
    try {
      await pickAndSendAttachment(
        tab.machineId,
        tab.sessionKey,
        chatModeActive ? sendChatMessageFromUser : undefined,
      );
    } catch {
      Alert.alert('Upload Failed', undefined, [{ text: 'OK' }]);
    } finally {
      setUploading(false);
    }
  }, [chatModeActive, sendChatMessageFromUser, uploading]);

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

  const handleMenuAction = useCallback(
    (id: TerminalMenuActionId): void => {
      // One menu, one dismissal point: every row closes the card before the
      // action opens its own overlay (or leaves the screen).
      setMenuVisible(false);
      switch (id) {
        case 'rename':
          setAgentOverlay({ kind: 'rename', error: null });
          return;
        case 'sleep':
          void runAgentSleep();
          return;
        case 'delayedActions':
          setAgentOverlay({ kind: 'delayedSend' });
          return;
        case 'fork':
          void runAgentFork();
          return;
        case 'fullReload':
          void runAgentFullReload();
          return;
        case 'promptEditor':
          setAgentOverlay({ kind: 'promptEditor', sending: false });
          return;
        case 'exportTranscript':
          void runExportTranscript();
          return;
        case 'attachPath':
          setAgentOverlay(AGENT_OVERLAY_NONE);
          void handleUpload();
          return;
        case 'newTerminal':
          void handleNewTerminal();
          return;
        case 'settings':
          navigation.navigate('Settings');
          return;
        case 'disconnect':
          if (activeTab !== null) requestCloseTab(activeTab);
          return;
      }
    },
    [
      activeTab,
      handleNewTerminal,
      handleUpload,
      navigation,
      requestCloseTab,
      runAgentFork,
      runAgentFullReload,
      runAgentSleep,
      runExportTranscript,
    ],
  );

  const uploadEnabled =
    activeTab !== null && (chatModeActive ? agentActionsCapable : activeTab.state === 'open');
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
            fontFamily={settings.sessionChatFontFamily}
            theme={settings.sessionChatTheme}
            transcriptWidthPercent={settings.sessionChatTranscriptWidthPercent}
            verboseMode={settings.sessionChatVerboseMode}
            // The page cannot see the session's live state; the 5s inventory
            // poll is the phone's equivalent of the desktop hosts' record.
            working={activeSession?.activity === 'working'}
            canSend={activeSession !== null && activeSession.isLive && !activeSession.isSleeping}
            visible={chatModeActive}
            draftTransferRequestId={chatDraftTransferIds[activeTab.sessionKey] ?? 0}
            style={styles.terminal}
          />
        ) : null}
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

      {/*
        The screen's bottom edge, always mounted and measurable: the extra-keys
        toolbar while it is up, otherwise the bottom margin.
      */}
      <View
        ref={bottomEdgeFrameRef}
        collapsable={false}
        onLayout={reconcileBottomEdgeWithVisibleWindow}
      >
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
          <View
            style={{ height: !keyboardVisible || chatModeActive ? insets.bottom : 0 }}
          />
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
        attachEnabled={uploadEnabled && !uploading}
        disconnectEnabled={activeTab !== null}
        onSelect={handleMenuAction}
        onClose={() => setMenuVisible(false)}
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
              confirmLabel="Rename"
              onSubmit={(value) => void submitAgentRename(value)}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
            />
          ) : null}
          {agentOverlay.kind === 'delayedSend' ? (
            <DelayedSendDialog
              agentIcon={activeSession.agentIcon}
              agentName={
                activeSession.agentName.length > 0
                  ? activeSession.agentName
                  : activeSession.agent
              }
              closeAfterDoneActive={activeSession.closeAfterDone}
              visible
              sessionTitle={agentSessionTitle}
              remainingLabel={activeSession.delayedSendRemainingLabel}
              sendWhenAllProjectSessionsStopActive={
                activeSession.sendWhenAllProjectSessionsStopActive
              }
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
              onSubmit={(text) => void submitPromptEditor(text)}
              onCancel={() => setAgentOverlay(AGENT_OVERLAY_NONE)}
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
