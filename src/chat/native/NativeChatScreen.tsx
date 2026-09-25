/**
 * The native chat screen: the Rust chat core's document drawn with React Native views. It is the
 * default chat view; Settings > Chat view > Web (previous) shows the WebView chat instead.
 *
 * Layout follows desktop's `native_chat/render.rs`: a host-level error line, the transcript search
 * bar, the transcript (or the empty/welcome state standing in for it), the cards stacked above the
 * composer, then the composer; overlays (account switch, subagent viewer, image viewer, table
 * preview, rewind confirmation) go over everything. The screen also performs the view requests the
 * core hands the phone (copy, toast, open, Save to Markdown, app-shell actions), the way desktop's
 * `apply_output` and the app shell do.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { docPathForChatFile } from '../../docs/openDoc';
import { useInventoryStore } from '../../inventory/store';
import type { MachineConnectionTarget } from '../../machines/credentials';
import type { RootStackParamList } from '../../navigation/types';
import { useOpenMachineLink } from '../../webPreview/useOpenMachineLink';
import type { ChatViewRequest } from '../rust/effects';
import { useRustChat, type RustChat } from '../rust/useRustChat';
import { NativeChatCards, NativeChatOverlays, questionReplacesComposer } from './cards';
import { NativeComposer } from './composer';
import {
  NativeChatUiProvider,
  NativeTranscript,
  RewindDialog,
  TranscriptSearchBar,
  useSubagentRowRenderer,
  useTranscriptTheme,
} from './transcript';

export type NativeChatScreenProps = {
  machine: MachineConnectionTarget;
  projectId: string;
  sessionId: string;
  /** Shows the session's terminal (the Terminal View buttons, the core's `switchToTerminal`). */
  onSwitchToTerminal: () => void;
  /**
   * The app-shell actions the host screen performs for the composer's More actions rows and the
   * cards (desktop's `sessionChatHostAction`: `rename`, `sleep`, `fork`, ...). `terminalView` is
   * always served, through `onSwitchToTerminal`.
   */
  hostActions?: readonly string[];
  onHostAction?: (action: string, params: Record<string, unknown>) => void;
  /** Keeps the chat loading offscreen until chat mode is selected. */
  visible: boolean;
  /** Bumped by the terminal header's Search Conversation; each new value opens the search bar. */
  openSearchRequestId?: number;
  /** Bumped by the header's Session Note; each new value opens the note. */
  openSessionNoteRequestId?: number;
  /** The Ghostex queue's length, for the terminal view's "Queued: N" button. Never called before
   * the machine reports a queue at all. */
  onQueueCountChange?: (count: number) => void;
  style?: StyleProp<ViewStyle>;
};

export default function NativeChatScreen({
  machine,
  projectId,
  sessionId,
  onSwitchToTerminal,
  hostActions = NO_HOST_ACTIONS,
  onHostAction,
  visible,
  openSearchRequestId = 0,
  openSessionNoteRequestId = 0,
  onQueueCountChange,
  style,
}: NativeChatScreenProps) {
  const chat = useRustChat({ machine, projectId, sessionId });
  const theme = useTranscriptTheme();
  const document = chat.state?.document ?? null;
  const toast = useChatViewRequests(chat, machine.id, projectId, onSwitchToTerminal);

  // The notice card's Switch account opens the composer's Accounts & limits panel.
  const [accountsRequestId, setAccountsRequestId] = useState(0);
  const hostAction = useCallback(
    (action: string, params: Record<string, unknown> = {}) => {
      if (action === 'terminalView' || action === 'switchToTerminal') onSwitchToTerminal();
      else if (action === 'switchAccount' && Object.keys(params).length === 0) setAccountsRequestId((current) => current + 1);
      else if (hostActions.includes(action)) onHostAction?.(action, params);
    },
    [hostActions, onHostAction, onSwitchToTerminal]
  );
  const composerHostActions = useMemo(() => ['terminalView', ...hostActions], [hostActions]);

  // The header's requests, one per new value (0 runs nothing).
  const handledSearch = useRef(openSearchRequestId);
  useEffect(() => {
    if (openSearchRequestId === handledSearch.current) return;
    handledSearch.current = openSearchRequestId;
    if (openSearchRequestId > 0) chat.dispatch({ type: 'searchOpen' });
  }, [chat, openSearchRequestId]);
  const handledNote = useRef(openSessionNoteRequestId);
  useEffect(() => {
    if (openSessionNoteRequestId === handledNote.current) return;
    handledNote.current = openSessionNoteRequestId;
    if (openSessionNoteRequestId > 0 && document?.note.open !== true) chat.dispatch({ type: 'toggleNote' });
  }, [chat, document?.note.open, openSessionNoteRequestId]);

  const queueSupported = document?.queue.capabilities.supported === true;
  const queueCount = document?.queue.prompts.length ?? 0;
  useEffect(() => {
    if (queueSupported) onQueueCountChange?.(queueCount);
  }, [onQueueCountChange, queueCount, queueSupported]);

  const renderSubagentRow = useSubagentRowRenderer(chat);

  return (
    <NativeChatUiProvider chat={chat}>
      <View
        style={[styles.root, { backgroundColor: theme.background }, style, !visible && styles.preloading]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        {chat.state?.error ? <Text style={[styles.error, { color: theme.error }]}>{chat.state.error}</Text> : null}
        <TranscriptSearchBar chat={chat} />
        <View style={styles.transcript}>
          <NativeTranscript chat={chat} />
        </View>
        <NativeChatCards chat={chat} onHostAction={hostAction} />
        {questionReplacesComposer(document) ? null : <NativeComposer chat={chat} onHostAction={hostAction} hostActions={composerHostActions} openAccountsRequestId={accountsRequestId} />}
        <RewindDialog chat={chat} />
        <NativeChatOverlays chat={chat} renderTranscriptItem={renderSubagentRow} />
        <ChatToast toast={toast} />
      </View>
    </NativeChatUiProvider>
  );
}

const NO_HOST_ACTIONS: readonly string[] = [];

type Toast = { id: number; title?: string; message: string; error: boolean } | null;

/**
 * Performs what the core asks of the screen (`ChatViewRequest`): the clipboard, a toast, opening a
 * link through the machine-aware opener (loopback links go to the Web preview), Save to Markdown's
 * result, and the app-shell actions this screen can serve. `focusComposer` is the composer's.
 */
function useChatViewRequests(
  chat: RustChat,
  machineId: string,
  projectId: string,
  onSwitchToTerminal: () => void
): Toast {
  const openMachineLink = useOpenMachineLink();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [toast, setToast] = useState<Toast>(null);
  const counter = useRef(0);
  const show = useCallback((message: string, error: boolean, title?: string) => {
    counter.current += 1;
    setToast({ id: counter.current, message, error, ...(title !== undefined ? { title } : {}) });
  }, []);
  useEffect(
    () =>
      chat.onViewRequest((request: ChatViewRequest) => {
        switch (request.kind) {
          case 'copy':
            void Clipboard.setStringAsync(request.text);
            show('Copied', false);
            return;
          case 'toast':
            show(request.message, request.level === 'error', request.title);
            return;
          case 'open':
            if (request.target.kind === 'url') openMachineLink(machineId, request.target.url);
            else {
              // Markdown and HTML open in the Docs viewer; a relative path is the session project's.
              const projectPath =
                useInventoryStore
                  .getState()
                  .inventoriesByMachineId[machineId]?.summary?.projects.find((project) => project.projectId === projectId)
                  ?.path ?? '';
              const docPath = docPathForChatFile(request.target.path, projectPath);
              if (docPath !== null) {
                navigation.push('DocViewer', { machineId, path: docPath });
                return;
              }
              // Any other file has no viewer on the phone; the path is what it can offer.
              void Clipboard.setStringAsync(request.target.path);
              show(`${request.target.path} (path copied)`, false, 'File');
            }
            return;
          case 'markdownSaved':
            void Clipboard.setStringAsync(request.path);
            show('Saved to Markdown', false);
            return;
          case 'hostAction':
            if (request.action === 'switchToTerminal' || request.action === 'terminalView') onSwitchToTerminal();
            return;
          case 'focusComposer':
            return;
        }
      }),
    [chat.onViewRequest, machineId, navigation, onSwitchToTerminal, openMachineLink, projectId, show] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return toast;
}

/** A short-lived toast at the top of the chat. */
function ChatToast({ toast }: { toast: Toast }) {
  const theme = useTranscriptTheme();
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Toast>(null);
  useEffect(() => {
    if (toast === null) return undefined;
    setShown(toast);
    opacity.setValue(0);
    Animated.timing(opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => setShown(null));
    }, 2600);
    return () => clearTimeout(timer);
  }, [opacity, toast]);
  if (shown === null) return null;
  return (
    <Animated.View pointerEvents='none' style={[styles.toastRow, { opacity }]} accessibilityLiveRegion='polite'>
      <View style={[styles.toast, { backgroundColor: theme.light ? '#ffffff' : '#1f1f1f', borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)' }]}>
        {shown.title !== undefined ? <Text style={[styles.toastTitle, { color: shown.error ? theme.error : theme.foreground }]}>{shown.title}</Text> : null}
        <Text style={[styles.toastText, { color: shown.error && shown.title === undefined ? theme.error : theme.cardMuted }]}>{shown.message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  transcript: { flex: 1, minHeight: 0 },
  error: { padding: 16, fontSize: 14 },
  preloading: { position: 'absolute', top: -2, left: -2, width: 1, height: 1, opacity: 0 },
  toastRow: { position: 'absolute', top: 8, left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: 420, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  toastTitle: { fontSize: 13, fontWeight: '600' },
  toastText: { fontSize: 13, lineHeight: 18 },
});
