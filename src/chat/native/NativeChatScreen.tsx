/**
 * The native chat screen: the Rust chat core's document drawn with React Native views. It is the
 * phone's only chat view.
 *
 * Layout follows desktop's `native_chat/render.rs`: a host-level error line, the transcript search
 * bar, the transcript (or the empty/welcome state standing in for it), the cards stacked above the
 * composer, then the composer; overlays (account switch, subagent viewer, image viewer, table
 * preview, rewind confirmation) go over everything. The screen also performs the view requests the
 * core hands the phone (copy, toast, open, Save to Markdown, app-shell actions), the way desktop's
 * `apply_output` and the app shell do.
 *
 * CDXC:SessionChat 2026-09-25 DECISION:
 * User: "Ok i want parity between the chat in gpui and mobile." Every feature of the GPUI chat view
 * (`apps/desktop/src/app/native_chat/`) has its phone form here, drawn from the same core document
 * and sending the same actions; only the gesture changes where desktop uses hover, a right press or
 * a keyboard (long presses and sheets). A desktop feature the phone leaves out is one tied to the
 * desktop itself (hover, keyboard shortcuts, windows and glass), or one that needs an
 * app-level screen or setting the chat cannot add on its own.
 */

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { docPathForChatFile, remotePathForChatFile } from '../../docs/openDoc';
import { isGpuiAvailable } from '../../../modules/gx-chat-core/src/gpui';
import { useInventoryStore } from '../../inventory/store';
import type { MachineConnectionTarget } from '../../machines/credentials';
import type { RootStackParamList } from '../../navigation/types';
import { webPreviewTargetForUrl } from '../../webPreview/routing';
import { useOpenMachineLink } from '../../webPreview/useOpenMachineLink';
import type { ChatViewRequest } from '../rust/effects';
import { sessionChatRpc } from '../rust/transport';
import { useRustChat, type RustChat } from '../rust/useRustChat';
import GpuiTranscript from '../gpui/GpuiTranscript';
import { useGpuiChat } from '../gpui/useGpuiChat';
import { useSettingsStore } from '../../settings/store';
import { useArmedActions } from './armedActions';
import { ForkBranchBadge, NativeChatCards, NativeChatOverlays, questionReplacesComposer } from './cards';
import { NativeComposer } from './composer';
import { HandoffSheet, type HandoffRequest } from './composer/HandoffSheet';
import type { MenuRow } from './composer/MenuSheet';
import { SavedPromptsSheet } from './composer/SavedPromptsSheet';
import { openForkBranch, takeLaunchDraft } from './sessionShell';
import {
  NativeChatUiProvider,
  NativeTranscript,
  RewindDialog,
  TranscriptSearchBar,
  useSubagentRowRenderer,
  useTranscriptTheme,
} from './transcript';
import { SaveMarkdownDialog } from './transcript/SaveMarkdownDialog';
import { TranscriptMenuSheet, type TranscriptMenuHost } from './transcript/TranscriptMenu';

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
  // The transcript's engine is picked once per chat screen: the GPUI one runs the chat in the Rust
  // host inside the phone library, the React Native one in the TypeScript host, and one chat must
  // not run in both.
  const gpuiSetting = useSettingsStore((state) => state.settings.sessionChatGpuiTranscript);
  const [gpui] = useState(() => gpuiSetting && isGpuiAvailable());
  const rustChat = useRustChat(gpui ? null : { machine, projectId, sessionId });
  const gpuiChat = useGpuiChat(gpui ? { machine, projectId, sessionId } : null);
  const chat = gpui ? gpuiChat : rustChat;
  const theme = useTranscriptTheme();
  const document = chat.state?.document ?? null;
  const [handoff, setHandoff] = useState<HandoffRequest | null>(null);
  // Both ways in (More actions, the model menu) arrive as their own sheet is still sliding away, and
  // iOS drops a modal presented during another's dismissal; Android's dialogs have no such wait.
  const openHandoff = useCallback((next: HandoffRequest) => {
    if (Platform.OS === 'ios') setTimeout(() => setHandoff(next), HANDOFF_OPEN_DELAY_MS);
    else setHandoff(next);
  }, []);
  const { toast, show } = useChatViewRequests(chat, machine, projectId, onSwitchToTerminal, openHandoff);
  const menuHost = useTranscriptMenuHost(machine.id, projectId, show);

  // The session title the core names saved files after and shows in the context meter.
  const title = useInventoryStore(
    (store) => store.inventoriesByMachineId[machine.id]?.summary?.sessions.find((entry) => entry.sessionId === sessionId)?.displayTitle ?? ''
  );
  const { setTitle } = chat;
  useEffect(() => {
    setTitle(title.length > 0 ? title : null);
  }, [setTitle, title]);

  // A Handoff's new conversation opens with the handover link gxserver staged for it.
  const composerReady = chat.state?.composer.ready === true;
  const composerInput = chat.composer;
  useEffect(() => {
    if (!composerReady || composerInput === null) return;
    const draft = takeLaunchDraft(machine.id, projectId, sessionId);
    if (draft !== null) composerInput.replace(draft);
  }, [composerInput, composerReady, machine.id, projectId, sessionId]);

  // Armed Delayed Send / Close After Done on the working row; a tap opens Delayed Actions.
  const armed = useArmedActions(machine.id, sessionId);
  const openDelayedActions = useMemo(
    () => (hostActions.includes('delayedActions') && onHostAction !== undefined ? () => onHostAction('delayedActions', {}) : undefined),
    [hostActions, onHostAction]
  );

  // The notice card's Switch account opens the composer's Accounts & limits panel.
  const [accountsRequestId, setAccountsRequestId] = useState(0);
  // The Stash button's Saved prompts (empty draft, or a long press), like desktop's Stashed Prompts modal.
  const [savedPromptsOpen, setSavedPromptsOpen] = useState(false);
  // More actions > Handoff / Export opens the chat's own dialog, the one the model menu's handoff opens.
  const exportCount = useRef(0);
  const hostAction = useCallback(
    (action: string, params: Record<string, unknown> = {}) => {
      if (action === 'terminalView' || action === 'switchToTerminal') onSwitchToTerminal();
      else if (action === 'switchAccount' && Object.keys(params).length === 0) setAccountsRequestId((current) => current + 1);
      else if (action === 'switchAccount') {
        // A switchable-agent row (agents without the Accounts panel): rewrite the session's agent,
        // then Full Reload so it resumes under the new one, as desktop's `switchSessionAgent` does.
        const agentId = typeof params.agentId === 'string' ? params.agentId : '';
        if (agentId.length === 0) return;
        void sessionChatRpc(machine, 'switchSessionAgent', { projectId, sessionId, agentId }).then((answer) => {
          if (answer.error === null) {
            if (hostActions.includes('fullReload')) onHostAction?.('fullReload', {});
            return;
          }
          show(answer.error.message, true, 'Switch Account failed');
        });
      }
      else if (action === 'exportTranscript') {
        exportCount.current += 1;
        openHandoff({ id: -exportCount.current, target: null });
      } else if (action === 'stashedPrompts') {
        // Stash folded into More actions opens this from that sheet, which iOS must finish closing first.
        if (Platform.OS === 'ios') setTimeout(() => setSavedPromptsOpen(true), HANDOFF_OPEN_DELAY_MS);
        else setSavedPromptsOpen(true);
      } else if (hostActions.includes(action)) onHostAction?.(action, params);
    },
    [hostActions, machine, onHostAction, onSwitchToTerminal, openHandoff, projectId, sessionId, show]
  );
  const composerHostActions = useMemo(
    () => [
      'terminalView',
      ...(sessionId.length > 0 && projectId.length > 0 ? ['exportTranscript', 'stashedPrompts', 'switchAccount'] : []),
      ...hostActions.filter((action) => action !== 'exportTranscript'),
    ],
    [hostActions, projectId, sessionId]
  );

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
        {gpui ? null : <TranscriptSearchBar chat={chat} />}
        <View style={styles.transcript}>
          {gpui ? (
            // GPUI draws the whole transcript region itself: search, the fork badge, the subagent
            // viewer and the account switch card included.
            <GpuiTranscript style={StyleSheet.absoluteFill} />
          ) : (
            <>
              <NativeTranscript chat={chat} />
              <ForkBranchBadge chat={chat} />
            </>
          )}
        </View>
        <NativeChatCards chat={chat} onHostAction={hostAction} armed={armed} {...(openDelayedActions !== undefined ? { onArmedPress: openDelayedActions } : {})} />
        {questionReplacesComposer(document) ? null : <NativeComposer chat={chat} onHostAction={hostAction} hostActions={composerHostActions} openAccountsRequestId={accountsRequestId} />}
        <RewindDialog chat={chat} />
        <SaveMarkdownDialog chat={chat} />
        {gpui ? null : <TranscriptMenuSheet chat={chat} host={menuHost} />}
        <SavedPromptsSheet
          visible={savedPromptsOpen}
          machine={machine}
          projectId={projectId}
          sessionId={sessionId}
          onClose={() => setSavedPromptsOpen(false)}
          onInsert={(content) => chat.composer?.replace(content)}
          onChanged={() => chat.dispatch({ type: 'refreshComposerChrome', sessionId })}
        />
        <HandoffSheet
          request={handoff}
          machine={machine}
          projectId={projectId}
          sessionId={sessionId}
          onClose={() => setHandoff(null)}
          onFailure={(failure, message) => show(message, true, failure)}
        />
        {gpui ? null : <NativeChatOverlays chat={chat} renderTranscriptItem={renderSubagentRow} />}
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
  machine: MachineConnectionTarget,
  projectId: string,
  onSwitchToTerminal: () => void,
  onHandoff: (request: HandoffRequest) => void
): { toast: Toast; show: (message: string, error: boolean, title?: string) => void } {
  const machineId = machine.id;
  const openMachineLink = useOpenMachineLink();
  const handoffs = useRef(0);
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
              // Markdown, HTML, text and pictures open in the file viewer; a relative path is the session project's.
              const projectPath = projectPathFor(machineId, projectId);
              const docPath = docPathForChatFile(request.target.path, projectPath);
              if (docPath !== null) {
                navigation.push('DocViewer', { machineId, path: docPath });
                return;
              }
              // Any other file has no viewer on the phone; the path is what it can offer.
              const path = remotePathForChatFile(request.target.path, projectPath) ?? request.target.path;
              void Clipboard.setStringAsync(path);
              show(`${path} (path copied)`, false, "Can't preview this file on the phone");
            }
            return;
          case 'markdownSaved':
            void Clipboard.setStringAsync(request.path);
            show('Saved to Markdown', false);
            return;
          case 'hostAction': {
            if (request.action === 'switchToTerminal' || request.action === 'terminalView') onSwitchToTerminal();
            else if (request.action === 'selectForkBranch') {
              void openForkBranch(machine, request.params).catch(() =>
                show('The session could not be resumed. Try again from the sessions list.', true, 'Could not open that branch')
              );
            } else if (request.action === 'openCoordinatorThread') {
              // A coordinator's thread opens like a fork branch, as its tab. gxserver already resumed it when it was
              // closed (`openCoordinatorThread`), so the action carries no lifecycleState and nothing is woken here.
              void openForkBranch(machine, request.params).catch(() =>
                show('The thread could not be opened. Try again from the sessions list.', true, 'Could not open that thread')
              );
            } else if (request.action === 'handoffToModel') {
              const params = (typeof request.params === 'object' && request.params !== null ? request.params : {}) as Record<string, unknown>;
              const text = (key: string): string => (typeof params[key] === 'string' ? (params[key] as string).trim() : '');
              if (text('provider').length === 0 || text('model').length === 0) return;
              handoffs.current += 1;
              const next: HandoffRequest = {
                id: handoffs.current,
                target: { provider: text('provider'), model: text('model'), effort: text('effort') },
              };
              onHandoff(next);
            }
            return;
          }
          case 'focusComposer':
            return;
        }
      }),
    [chat.onViewRequest, machine, machineId, navigation, onHandoff, onSwitchToTerminal, openMachineLink, projectId, show] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { toast, show };
}

/** How long the Handoff sheet waits on iOS for the sheet it was opened from to finish going away. */
const HANDOFF_OPEN_DELAY_MS = 450;

/** The project's folder on the machine, which a relative chat file path is under. */
function projectPathFor(machineId: string, projectId: string): string {
  return (
    useInventoryStore
      .getState()
      .inventoriesByMachineId[machineId]?.summary?.projects.find((project) => project.projectId === projectId)
      ?.path ?? ''
  );
}

/**
 * What the transcript menu's rows do on the phone (desktop's `handle_action` and the app shell's
 * `openLink` / `openFile` / `locateFile`). Rows the phone cannot perform are left out: Open in
 * Code (the phone has no code editor), Open File/Folder Location (the file is on the computer), and
 * Open in Files or Open Image for a file the phone's viewer cannot show.
 */
function useTranscriptMenuHost(
  machineId: string,
  projectId: string,
  show: (message: string, error: boolean, title?: string) => void
): TranscriptMenuHost {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return useMemo<TranscriptMenuHost>(() => {
    const docPath = (command: MenuRow): string | null =>
      typeof command.path === 'string' ? docPathForChatFile(command.path, projectPathFor(machineId, projectId)) : null;
    return {
      serves: (command) => {
        const type = command.type;
        if (type === 'copyText') return true;
        if (type !== 'host') return false;
        if (command.action === 'openLink') return typeof command.url === 'string';
        // "Open in Files", and "Open Image" (no `view`: the host picks where a picture opens).
        if (command.action === 'openFile') return (command.view === 'docs' || command.view === undefined) && docPath(command) !== null;
        return false;
      },
      perform: (command) => {
        if (command.type === 'copyText') {
          void Clipboard.setStringAsync(typeof command.text === 'string' ? command.text : '');
          show('Copied', false);
          return;
        }
        if (command.action === 'openLink' && typeof command.url === 'string') {
          const url = command.url;
          if (command.external === true) {
            void Linking.openURL(url).catch(() => undefined);
            return;
          }
          navigation.navigate('WebPreview', { machineId, ...(webPreviewTargetForUrl(url) ?? { url }) });
          return;
        }
        if (command.action === 'openFile') {
          const path = docPath(command);
          if (path !== null) navigation.push('DocViewer', { machineId, path });
        }
      },
    };
  }, [machineId, navigation, projectId, show]);
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
