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
import { useMachinesStore } from '../../machines/store';
import { chooseVoiceComputer } from '../../voice/dictateSettings';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Linking, Platform, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { DocsCopy } from '../../copy';
import { openComputerFile, phoneOpensFile } from '../../docs/openComputerFile';
import { remotePathForChatFile } from '../../docs/openDoc';
import GhostexImageIntakeView from '../../../modules/ghostex-native/src/GhostexImageIntakeView';
import { useInventoryStore } from '../../inventory/store';
import { openStartedBoxChat } from '../../cloudBoxes/open';
import type { MachineConnectionTarget } from '../../machines/credentials';
import type { RootStackParamList } from '../../navigation/types';
import { classifyMachineLink, visualPageAddress, type ComputerAddress } from '../../webPreview/machineLinks';
import { useOpenMachineLink } from '../../webPreview/useOpenMachineLink';
import type { ChatViewRequest } from '../rust/effects';
import type { ChatDocument } from '../rust/document';
import { machineIdOfGlobalRef } from '../rust/sessionDirectory';
import { sessionChatRpc } from '../rust/transport';
import { useRustChat, type RustChat } from '../rust/useRustChat';
import { machineTargetFor } from '../../screens/terminal-screen/session-lookups';
import { callVoiceAbout } from '../../voice/callAbout';
import { useVoiceCapability } from '../../voice/VoiceButton';
import { sessionNotesOnIn } from '../../sessions/sessionNotesSwitch';
import GbotSettingsHost from '../../screens/sessions-screen/GbotSettingsHost';
import type { GbotSettingsTab } from '../../screens/sessions-screen/GbotSettingsSheet';
import { useArmedActions } from './armedActions';
import { NativeChatCards, NativeChatOverlays, PageSheet, ResourceSheet, questionReplacesComposer } from './cards';
import { ChatPlacementProvider, type ChatPlacement } from './chatPlacement';
import { PillMenuSheet } from './cards/ChatPills';
import { ConnectionLostNotice } from './cards/ConnectionLostNotice';
import { ComputerCard } from './cards/ComputerCard';
import type { BoardFocus } from './cards/CoordinatorBoard';
import { num, obj, str } from './cards/json';
import { remoteWorkerNotice, remoteWorkerOfAction } from './cards/remoteWorker';
import { PillsStrip, type PillsStripLinks } from './cards/PillsStrip';
import { SideChatBar } from './cards/SideChats';
import { useTerminalStore } from '../../terminal/sessions';
import { LoneScrollBottom, WorkingCard } from './cards/WorkingCard';
import { NativeComposer } from './composer';
import { HandoffSheet, type HandoffRequest } from './composer/HandoffSheet';
import { ModelMenuSheet } from './composer/ModelMenuSheet';
import type { MenuRow } from './composer/MenuSheet';
import { attachIntakeImages } from './composer/imageIntake';
import { SavedPromptsSheet } from './composer/SavedPromptsSheet';
import { openForkBranch, runCommandInTerminal, takeLaunchDraft } from './sessionShell';
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
  /** The session's links for the working card's Links pill and the tap that opens their sheet. */
  links?: PillsStripLinks | null;
  /**
   * In one of the iPhone Duo's pane slots (`src/panes/`): the pane ends at the keyboard or the fold, so the composer
   * lifts nothing itself, and the cards, tables and pictures are sized by this chat, not the window (`chatPlacement`).
   */
  inPane?: boolean;
  /** Bumped when the composer is to take the keyboard (the pane it stands in became the active one); 0 asks nothing. */
  focusRequestId?: number;
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
  links = null,
  inPane = false,
  focusRequestId = 0,
  style,
}: NativeChatScreenProps) {
  const chat = useRustChat({ machine, projectId, sessionId });
  const theme = useTranscriptTheme();
  const document = chat.state?.document ?? null;
  const [handoff, setHandoff] = useState<HandoffRequest | null>(null);
  // Both ways in (More actions, the model menu) arrive as their own sheet is still sliding away, and
  // iOS drops a modal presented during another's dismissal; Android's dialogs have no such wait.
  const openHandoff = useCallback((next: HandoffRequest) => {
    if (Platform.OS === 'ios') setTimeout(() => setHandoff(next), HANDOFF_OPEN_DELAY_MS);
    else setHandoff(next);
  }, []);
  // The published page a page card (or a link to one) opened, shown in the chat's page sheet.
  const [page, setPage] = useState<ComputerAddress | null>(null);
  // The GBot whose settings the "GBot added" card's Open settings opened (the core's `openGbotSettings`).
  // A "Routine set" card's Edit opens the same sheet on its Routines tab (`editGbotRoutine`).
  const [gbotSettings, setGbotSettings] = useState<{ botId: string; tab?: GbotSettingsTab } | null>(null);
  const { toast, show } = useChatViewRequests(
    chat,
    machine,
    projectId,
    sessionId,
    onSwitchToTerminal,
    openHandoff,
    setPage,
    setGbotSettings,
  );
  const openMachineLink = useOpenMachineLink();
  /**
   * A link the page followed: another page replaces it, a web address goes to the phone's browser
   * with the page left open, and an address or file on the computer closes the sheet and opens
   * where the chat would open it (the desktop's page window does the same).
   */
  const openPageLink = useCallback(
    (url: string) => {
      const next = visualPageAddress(url);
      if (next !== null) {
        setPage(next);
        return;
      }
      if (classifyMachineLink(url).kind === 'web') {
        void Linking.openURL(url).catch(() => undefined);
        return;
      }
      setPage(null);
      openMachineLink(machine.id, url, { projectId, notify: show });
    },
    [machine.id, openMachineLink, projectId, show],
  );
  const closePage = useCallback(() => setPage(null), []);
  const menuHost = useTranscriptMenuHost(machine.id, projectId, show);

  // The session title the core names saved files after and shows in the context meter.
  const title = useInventoryStore(
    (store) =>
      store.inventoriesByMachineId[machine.id]?.summary?.sessions.find((entry) => entry.sessionId === sessionId)
        ?.displayTitle ?? '',
  );
  const { setTitle } = chat;
  useEffect(() => {
    setTitle(title.length > 0 ? title : null);
  }, [setTitle, title]);

  // More actions' "Voice call about this chat", on a computer whose gxserver has the voice agent.
  const voiceNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const voiceCallable = useVoiceCapability(machine) && sessionId.length > 0 && projectId.length > 0;
  // More actions' Session note, while the computer has Session notes on (Settings > Extensions).
  const sessionNotesOn = useInventoryStore((store) =>
    sessionNotesOnIn(store.inventoriesByMachineId[machine.id]?.summary),
  );

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
    () =>
      hostActions.includes('delayedActions') && onHostAction !== undefined
        ? () => onHostAction('delayedActions', {})
        : undefined,
    [hostActions, onHostAction],
  );

  // The notice card's Switch account opens the composer's Accounts & limits panel.
  const [accountsRequestId, setAccountsRequestId] = useState(0);
  // The held-messages card's Pick model opens the composer's model sheet, the one the model pill opens (while a
  // question takes the composer's place, the same sheet hosted by `QuestionModelSheet`).
  const [modelRequestId, setModelRequestId] = useState(0);
  // The Stash button's Saved prompts (empty draft, or a long press), like desktop's Stashed Prompts modal.
  const [savedPromptsOpen, setSavedPromptsOpen] = useState(false);
  // More actions > Handoff / Export opens the chat's own dialog, the one the model menu's handoff opens.
  const exportCount = useRef(0);
  const hostAction = useCallback(
    (action: string, params: Record<string, unknown> = {}) => {
      if (action === 'terminalView' || action === 'switchToTerminal') onSwitchToTerminal();
      else if (action === 'pickModel') setModelRequestId((current) => current + 1);
      else if (action === 'switchAccount' && Object.keys(params).length === 0)
        setAccountsRequestId((current) => current + 1);
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
      } else if (action === 'toast') show(String(params.message ?? ''), params.level === 'error');
      else if (action === 'autopilotSettings') {
        // The Autopilot pill's "Autopilot settings…": Settings › Autopilot, on this chat's computer.
        useMachinesStore.getState().selectMachine(machine.id);
        voiceNavigation.navigate('SettingsPage', { page: 'autopilot' });
      } else if (action === 'voiceSettings') {
        // The Dictate menu's Voice settings: Settings › Voice, already on this chat's computer.
        chooseVoiceComputer(machine.id);
        voiceNavigation.navigate('SettingsPage', { page: 'voice' });
      } else if (action === 'voiceCall') {
        callVoiceAbout(machine, { projectId, sessionId, title: title.length > 0 ? title : 'this chat' }, () =>
          voiceNavigation.navigate('Voice'),
        );
      } else if (action === 'exportTranscript') {
        exportCount.current += 1;
        openHandoff({ id: -exportCount.current, target: null });
      } else if (action === 'stashedPrompts') {
        // Stash folded into More actions opens this from that sheet, which iOS must finish closing first.
        if (Platform.OS === 'ios') setTimeout(() => setSavedPromptsOpen(true), HANDOFF_OPEN_DELAY_MS);
        else setSavedPromptsOpen(true);
      } else if (hostActions.includes(action)) onHostAction?.(action, params);
    },
    [
      hostActions,
      machine,
      onHostAction,
      onSwitchToTerminal,
      openHandoff,
      projectId,
      sessionId,
      show,
      title,
      voiceNavigation,
    ],
  );
  const composerHostActions = useMemo(
    () => [
      'terminalView',
      ...(sessionId.length > 0 && projectId.length > 0 ? ['exportTranscript', 'stashedPrompts', 'switchAccount'] : []),
      ...(voiceCallable ? ['voiceCall'] : []),
      ...(sessionNotesOn ? ['sessionNote'] : []),
      ...hostActions.filter((action) => action !== 'exportTranscript'),
    ],
    [hostActions, projectId, sessionId, sessionNotesOn, voiceCallable],
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
    if (openSessionNoteRequestId > 0 && sessionNotesOn && document?.note.open !== true) {
      chat.dispatch({ type: 'toggleNote' });
    }
  }, [chat, document?.note.open, openSessionNoteRequestId, sessionNotesOn]);

  const queueSupported = document?.queue.capabilities.supported === true;
  const queueCount = document?.queue.prompts.length ?? 0;
  useEffect(() => {
    if (queueSupported) onQueueCountChange?.(queueCount);
  }, [onQueueCountChange, queueCount, queueSupported]);

  // An image dropped anywhere on the chat view joins the draft, as the attach button adds one.
  const composerShown = !questionReplacesComposer(document);
  // The sheet outlives the composer when a live question replaces it, including during modal dismissal.
  const [pillMenu, setPillMenu] = useState<string | null>(null);
  // The card a board pill in the chat asked to see (gx-chat-core `show_item`): the board opens at
  // it once per tap. The first document a chat shows leaves an older tap alone.
  const [boardFocus, setBoardFocus] = useState<BoardFocus | null>(null);
  const closePillMenu = useCallback(() => {
    setPillMenu(null);
    setBoardFocus(null);
  }, []);
  const focus = obj(obj(document?.coordinatorBoard)?.focus);
  const focusKey = str(focus, 'key');
  const focusSeq = num(focus, 'seq') ?? null;
  const seenFocus = useRef<number | null | undefined>(undefined);
  // Before the chat has a document there is no tap to see yet; the first document's focus counts as seen.
  const hasDocument = document !== null;
  useEffect(() => {
    if (!hasDocument) return;
    if (seenFocus.current === undefined || focusSeq === null || focusSeq === seenFocus.current) {
      seenFocus.current = focusSeq;
      return;
    }
    seenFocus.current = focusSeq;
    setBoardFocus({ key: focusKey, seq: focusSeq });
    setPillMenu('board');
  }, [focusKey, focusSeq, hasDocument]);
  const [dropActive, setDropActive] = useState(false);
  const receiveImages = useCallback(
    (event: { nativeEvent: unknown }) => attachIntakeImages(chat, event.nativeEvent, (message) => show(message, true)),
    [chat, show],
  );

  /**
   * Where the transcript and the composer sit in the chat column, for the composer's `room`: the
   * column's height less what sits above the transcript, a strip of transcript kept in view and the
   * rows between the transcript and the composer (the working card, the cards, the pills). None of
   * these move while the composer's card tweens its height, so the room does not chase it.
   */
  const [composerFrame, setComposerFrame] = useState({
    height: -1,
    transcriptTop: -1,
    transcriptBottom: -1,
    composerTop: -1,
  });
  // In a pane, the chat's own size stands for the window's (`chatPlacement`).
  const [paneSize, setPaneSize] = useState<{ width: number; height: number } | null>(null);
  const placement = useMemo<ChatPlacement>(() => ({ inPane, size: inPane ? paneSize : null }), [inPane, paneSize]);
  const composerRoom =
    composerFrame.height < 0 || composerFrame.transcriptTop < 0 || composerFrame.composerTop < 0
      ? undefined
      : Math.round(
          composerFrame.height -
            composerFrame.transcriptTop -
            TRANSCRIPT_KEPT_IN_VIEW -
            (composerFrame.composerTop - composerFrame.transcriptBottom),
        );

  const renderSubagentRow = useSubagentRowRenderer(chat);
  // While the subagent viewer is open its modal carries the transcript menu (see `TranscriptMenuSheet`).
  const subagentOpen = document?.subagent !== undefined && document.subagent !== null;

  return (
    <NativeChatUiProvider chat={chat}>
      <ChatPlacementProvider value={placement}>
        {/* An Expo view takes no `pointerEvents`, so the preloading chat's stays on the view inside. */}
        <GhostexImageIntakeView
          style={[styles.root, style, !visible && styles.preloading]}
          dropTarget={visible && composerShown}
          onImages={receiveImages}
          onDropActive={(event) => setDropActive(event.nativeEvent.active)}
        >
          <View
            style={[styles.root, { backgroundColor: theme.background }]}
            pointerEvents={visible ? 'auto' : 'none'}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setComposerFrame((now) => ({ ...now, height }));
              if (inPane)
                setPaneSize((now) => (now?.width === width && now.height === height ? now : { width, height }));
            }}
          >
            {chat.state?.error ? <Text style={[styles.error, { color: theme.error }]}>{chat.state.error}</Text> : null}
            {document ? <SideChatBar chat={chat} document={document} /> : null}
            <TranscriptSearchBar chat={chat} />
            <View
              style={styles.transcript}
              onLayout={(event) => {
                const { y, height } = event.nativeEvent.layout;
                setComposerFrame((now) => ({ ...now, transcriptTop: y, transcriptBottom: y + height }));
              }}
            >
              <NativeTranscript chat={chat} active={visible} />
              {/* Scroll-to-bottom alone while no card carries it. */}
              {document === null ? null : <LoneScrollBottom document={document} armed={armed} links={links} />}
            </View>
            {/* The offline computer's card tops the stack, above the working card; it names the
                computer itself, so "Reconnecting to …" steps aside while it shows. */}
            <ComputerCard document={document} onRetry={() => chat.dispatch({ type: 'computerRetry' })} />
            {document?.computerNotice != null ? null : (
              <ConnectionLostNotice machine={machine} active={visible} document={document} />
            )}
            {/* The working card in its own row above the cards and the composer: the transcript ends above it. */}
            {document === null ? null : <WorkingCard document={document} />}
            <NativeChatCards chat={chat} onHostAction={hostAction} />
            {!composerShown ? null : (
              <View
                onLayout={(event) => {
                  const composerTop = event.nativeEvent.layout.y;
                  setComposerFrame((now) => ({ ...now, composerTop }));
                }}
              >
                <NativeComposer
                  projectId={projectId}
                  sessionId={sessionId}
                  chat={chat}
                  onHostAction={hostAction}
                  hostActions={composerHostActions}
                  openAccountsRequestId={accountsRequestId}
                  openModelRequestId={modelRequestId}
                  focusRequestId={focusRequestId}
                  voiceCallTitle={title}
                  {...(composerRoom !== undefined ? { room: composerRoom } : {})}
                  {...(document !== null
                    ? {
                        strip: (
                          <PillsStrip
                            chat={chat}
                            document={document}
                            menu={pillMenu}
                            onMenuChange={setPillMenu}
                            armed={armed}
                            links={links}
                            {...(sessionId.length > 0 && projectId.length > 0
                              ? { onStashedPress: () => hostAction('stashedPrompts') }
                              : {})}
                            {...(openDelayedActions !== undefined ? { onArmedPress: openDelayedActions } : {})}
                          />
                        ),
                      }
                    : {})}
                />
              </View>
            )}
            {composerShown || document === null ? null : (
              <QuestionModelSheet chat={chat} document={document} openRequestId={modelRequestId} />
            )}
            {document !== null ? (
              <PillMenuSheet
                chat={chat}
                document={document}
                open={pillMenu}
                onClose={closePillMenu}
                onHost={hostAction}
                boardFocus={boardFocus}
              />
            ) : null}
            <RewindDialog chat={chat} />
            <SaveMarkdownDialog chat={chat} />
            <TranscriptMenuSheet chat={chat} host={menuHost} enabled={!subagentOpen} />
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
            <NativeChatOverlays
              chat={chat}
              renderTranscriptItem={renderSubagentRow}
              subagentMenu={<TranscriptMenuSheet chat={chat} host={menuHost} />}
            />
            <PageSheet chat={chat} machine={machine} page={page} onClose={closePage} onOpenLink={openPageLink} />
            <ResourceSheet chat={chat} document={document} />
            {gbotSettings !== null ? (
              <GbotSettingsHost
                target={machine}
                botId={gbotSettings.botId}
                name={gbotNameOn(machine.id, gbotSettings.botId)}
                initialTab={gbotSettings.tab}
                onClose={() => setGbotSettings(null)}
                onSaved={(name) => show('Chats opened from now on start with the changes.', false, `${name} saved`)}
              />
            ) : null}
            <ChatToast toast={toast} />
            {dropActive ? (
              <View
                pointerEvents="none"
                style={[styles.dropHighlight, { borderColor: theme.ring, backgroundColor: theme.ringGlow }]}
              >
                <Text style={[styles.dropLabel, { color: theme.foreground, backgroundColor: theme.cardBackground }]}>
                  Drop to attach
                </Text>
              </View>
            ) : null}
          </View>
        </GhostexImageIntakeView>
      </ChatPlacementProvider>
    </NativeChatUiProvider>
  );
}

const NO_HOST_ACTIONS: readonly string[] = [];

/**
 * The composer's model sheet while a question takes the composer's place: the held-messages card's Pick model
 * (`openRequestId`, the request the composer answers otherwise) opens it here, the same sheet with the same
 * actions, and only requests made while it is mounted count.
 *
 * CDXC:SessionChat WHY: The sheet's own host is the composer, which a question unmounts, and Pick
 * model has to open the model sheet in that state too (desktop's Pick model works there). Hosting the same sheet
 * here keeps the question in the composer's place and leaves the composer's path untouched.
 */
function QuestionModelSheet({
  chat,
  document,
  openRequestId,
}: {
  chat: RustChat;
  document: ChatDocument;
  openRequestId: number;
}) {
  const [open, setOpen] = useState(false);
  const handledRequest = useRef(openRequestId);
  useEffect(() => {
    if (openRequestId === handledRequest.current) return;
    handledRequest.current = openRequestId;
    if (openRequestId > 0) setOpen(true);
  }, [openRequestId]);
  const close = useCallback(() => setOpen(false), []);
  return (
    <ModelMenuSheet
      menu={obj(document.modelMenu)}
      visible={open}
      ownProvider={str(document.modelMenuContext, 'provider')}
      onClose={close}
      dispatch={chat.dispatch}
    />
  );
}

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
  sessionId: string,
  onSwitchToTerminal: () => void,
  onHandoff: (request: HandoffRequest) => void,
  onOpenPage: (page: ComputerAddress) => void,
  onOpenGbotSettings: (settings: { botId: string; tab?: GbotSettingsTab }) => void,
): { toast: Toast; show: (message: string, error: boolean, title?: string) => void } {
  const machineId = machine.id;
  const openMachineLink = useOpenMachineLink();
  const handoffs = useRef(0);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [toast, setToast] = useState<Toast>(null);
  const counter = useRef(0);
  // The Workers sheet's rows as they are now, for a worker on another computer (read when it is asked
  // to open one, not a dependency of the listener below).
  const workerRows = useRef<unknown>(null);
  workerRows.current = obj(chat.state?.document?.coordinatorThreadsPanel)?.rows ?? null;
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
            if (request.target.kind === 'url') {
              // A page card's Open (or a link to a published page) opens the chat's page sheet.
              const page = visualPageAddress(request.target.url);
              if (page !== null) {
                onOpenPage(page);
                return;
              }
              // An address the session printed is the computer's (`webPreview/machineLinks.ts`).
              openMachineLink(machineId, request.target.url, { projectId, notify: show });
            } else {
              // A relative path is the session project's; `openComputerFile` picks where it opens.
              const projectPath = projectPathFor(machineId, projectId);
              const path = remotePathForChatFile(request.target.path, projectPath);
              if (path === null) {
                void Clipboard.setStringAsync(request.target.path);
                show(DocsCopy.pathCopiedNote(request.target.path), false, DocsCopy.cantPreview);
                return;
              }
              openComputerFile(navigation, machineId, path, { projectId, notify: show, openPage: onOpenPage });
            }
            return;
          case 'markdownSaved':
            void Clipboard.setStringAsync(request.path);
            show('Saved to Markdown', false);
            return;
          case 'hostAction': {
            if (request.action === 'switchToTerminal' || request.action === 'terminalView') onSwitchToTerminal();
            // Copy Report's last step (gx-chat-core `extras/report.rs`): Send Bug / Feedback with its agent switch on.
            // The "GBot added" card's Open settings (gx-chat-core `gbot_cards.rs`): the bot is on this chat's computer.
            else if (request.action === 'openGbotSettings') {
              const botId = (request.params as { botId?: unknown } | null)?.botId;
              if (typeof botId === 'string' && botId.length > 0) onOpenGbotSettings({ botId });
            } else if (request.action === 'editGbotRoutine') {
              // The phone has no Automate view: Edit opens the GBot's Routines (gx-chat-core `routine_cards.rs`).
              const botId = (request.params as { botId?: unknown } | null)?.botId;
              if (typeof botId === 'string' && botId.length > 0) onOpenGbotSettings({ botId, tab: 'routines' });
            } else if (request.action === 'sendFeedback')
              navigation.navigate('Feedback', { machineId, collectWithAgent: true });
            else if (request.action === 'selectForkBranch') {
              void openForkBranch(machine, request.params).catch(() =>
                show(
                  'The session could not be resumed. Try again from the sessions list.',
                  true,
                  'Could not open that branch',
                ),
              );
            } else if (
              request.action === 'openAgentSession' &&
              typeof (request.params as { machineId?: unknown } | null)?.machineId === 'string'
            ) {
              // A Cloud Box start finished: its chat now runs on the box (`cloudbox:<boxId>`) and opens there.
              const opened = request.params as { machineId: string; projectId?: unknown; sessionId?: unknown };
              // The draft's own title (its first message) until the box's session reports its own.
              const draftTitle =
                useInventoryStore
                  .getState()
                  .inventoriesByMachineId[machineId]?.summary?.sessions.find(
                    (session) => session.sessionId === sessionId,
                  )?.title ?? 'Cloud Box';
              void openStartedBoxChat(
                machineId,
                opened.machineId,
                typeof opened.sessionId === 'string' ? opened.sessionId : '',
                typeof opened.projectId === 'string' ? opened.projectId : '',
                draftTitle,
                (params) => navigation.navigate('Terminal', params),
              ).then((done) => {
                if (!done)
                  show('The chat now runs on its cloud box. Open it from the sessions list.', false, 'Cloud box ready');
              });
            } else if (request.action === 'openSettingsPage') {
              // Connecting a provider and managing snapshots stay on the computer (D7).
              show('Open Settings › Cloud Boxes in Ghostex on your computer.', false, 'Cloud Boxes');
            } else if (request.action === 'openAgentSession') {
              // An agent message card's Go to session: the other session, as its tab. A mention of a
              // session on another computer (`serverId`, a `+` pick) opens on that computer when the
              // phone polls it too.
              const fields = (request.params ?? {}) as { serverId?: unknown; projectId?: unknown; sessionId?: unknown };
              let target = machine;
              if (typeof fields.serverId === 'string' && fields.serverId.length > 0) {
                const otherId = machineIdOfGlobalRef(
                  `${fields.serverId}:${String(fields.projectId)}:${String(fields.sessionId)}`,
                );
                const other = otherId !== null ? machineTargetFor(otherId) : null;
                if (other === null) {
                  show(
                    'That session runs on a computer this phone is not connected to.',
                    false,
                    'Could not open that session',
                  );
                  return;
                }
                target = other;
              }
              void openForkBranch(target, request.params).catch(() =>
                show(
                  'The session could not be opened. Try again from the sessions list.',
                  true,
                  'Could not open that session',
                ),
              );
            } else if (request.action === 'openCoordinatorThread') {
              // A worker on another computer (`serverId`) cannot be opened from here: say where it runs
              // (cards/remoteWorker.ts). The sheet's row says so before asking; this covers any other way in.
              const elsewhere = remoteWorkerOfAction(request.params, workerRows.current);
              if (elsewhere !== null) {
                const notice = remoteWorkerNotice(elsewhere);
                show(notice.message, false, notice.title);
                return;
              }
              // A coordinator's thread opens like a fork branch, as its tab. gxserver already resumed it when it was
              // closed (`openCoordinatorThread`), so the action carries no lifecycleState and nothing is woken here.
              void openForkBranch(machine, request.params).catch(() =>
                show(
                  'The thread could not be opened. Try again from the sessions list.',
                  true,
                  'Could not open that worker',
                ),
              );
            } else if (request.action === 'openSideChat') {
              // A side chat (gx-chat-core `extras/side_chats.rs`) opens as its own chat tab, like a worker.
              void openForkBranch(machine, request.params).catch(() =>
                show('The side chat could not be opened. Try again.', true, 'Could not open that side chat'),
              );
            } else if (request.action === 'sideChatDeleted') {
              // A deleted side chat's tab goes; deleted from its own chat, its main session's chat comes back.
              const params = (
                typeof request.params === 'object' && request.params !== null ? request.params : {}
              ) as Record<string, unknown>;
              const deleted = typeof params.sessionId === 'string' ? params.sessionId : '';
              const parent = typeof params.parentSessionId === 'string' ? params.parentSessionId : '';
              const leave =
                deleted === sessionId && parent.length > 0
                  ? openForkBranch(machine, { projectId, sessionId: parent }).catch(() => undefined)
                  : Promise.resolve();
              void leave.then(() => {
                if (deleted.length > 0) void useTerminalStore.getState().closeWarmSessionFor(machineId, deleted);
              });
            } else if (request.action === 'runInTerminal' || request.action === 'pasteInTerminal') {
              // A command in a reply: the project's Commands panel terminal on the computer (or a new
              // terminal in this session's folder) runs it (or, for Paste, only types it), opened as
              // its tab so the user can answer what it asks (`ghostex run-in-terminal`).
              const params = (
                typeof request.params === 'object' && request.params !== null ? request.params : {}
              ) as Record<string, unknown>;
              const command = typeof params.command === 'string' ? params.command : '';
              if (command.trim().length === 0) return;
              const paste = request.action === 'pasteInTerminal';
              void runCommandInTerminal(machine, projectId, sessionId, command, paste).catch((error: unknown) =>
                show(
                  error instanceof Error && /unknown command|run-in-terminal/i.test(error.message)
                    ? 'Update Ghostex on the computer to run commands from the chat.'
                    : 'The terminal could not be started. Try again.',
                  true,
                  'Could not run the command',
                ),
              );
            } else if (request.action === 'handoffToModel') {
              const params = (
                typeof request.params === 'object' && request.params !== null ? request.params : {}
              ) as Record<string, unknown>;
              const text = (key: string): string =>
                typeof params[key] === 'string' ? (params[key] as string).trim() : '';
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
    [
      chat.onViewRequest,
      machine,
      machineId,
      navigation,
      onHandoff,
      onOpenGbotSettings,
      onOpenPage,
      onSwitchToTerminal,
      openMachineLink,
      projectId,
      sessionId,
      show,
    ], // eslint-disable-line react-hooks/exhaustive-deps
  );
  return { toast, show };
}

/** How long the Handoff sheet waits on iOS for the sheet it was opened from to finish going away. */
const HANDOFF_OPEN_DELAY_MS = 450;

/** A GBot's name on a computer, from the sessions list it last read; "GBot" until it has one. */
function gbotNameOn(machineId: string, botId: string): string {
  return (
    useInventoryStore
      .getState()
      .inventoriesByMachineId[machineId]?.summary?.projects.find((project) => project.gbotsBot?.id === botId)?.gbotsBot
      ?.name ?? 'GBot'
  );
}

/** The project's folder on the machine, which a relative chat file path is under. */
function projectPathFor(machineId: string, projectId: string): string {
  return (
    useInventoryStore
      .getState()
      .inventoriesByMachineId[machineId]?.summary?.projects.find((project) => project.projectId === projectId)?.path ??
    ''
  );
}

/**
 * What the transcript menu's rows do on the phone (desktop's `handle_action` and the app shell's
 * `openLink` / `openFile` / `locateFile`). Rows the phone cannot perform are left out: Open in
 * Code (the phone has no code editor), Open File/Folder Location (the file is on the computer), and
 * Open in Files or Open Image for a file the phone cannot open (`phoneOpensFile`).
 */
function useTranscriptMenuHost(
  machineId: string,
  projectId: string,
  show: (message: string, error: boolean, title?: string) => void,
): TranscriptMenuHost {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openMachineLink = useOpenMachineLink();
  return useMemo<TranscriptMenuHost>(() => {
    const filePath = (command: MenuRow): string | null => {
      const path =
        typeof command.path === 'string'
          ? remotePathForChatFile(command.path, projectPathFor(machineId, projectId))
          : null;
      return path !== null && phoneOpensFile(path) ? path : null;
    };
    return {
      serves: (command) => {
        const type = command.type;
        if (type === 'copyText') return true;
        if (type !== 'host') return false;
        if (command.action === 'openLink') return typeof command.url === 'string';
        // "Open in Files", and "Open Image" (no `view`: the host picks where a picture opens).
        if (command.action === 'openFile')
          return (command.view === 'docs' || command.view === undefined) && filePath(command) !== null;
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
          const link = classifyMachineLink(url);
          /*
           * An address on the computer opens in the Web preview whichever browser was asked for:
           * the phone's own browser cannot reach the computer's loopback.
           */
          if (link.kind !== 'web') {
            openMachineLink(machineId, url, { projectId, notify: show });
            return;
          }
          if (command.external === true) {
            void Linking.openURL(url).catch(() => undefined);
            return;
          }
          navigation.navigate('WebPreview', { machineId, url });
          return;
        }
        if (command.action === 'openFile') {
          const path = filePath(command);
          if (path !== null) openComputerFile(navigation, machineId, path, { projectId, notify: show });
        }
      },
    };
  }, [machineId, navigation, openMachineLink, projectId, show]);
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
    <Animated.View pointerEvents="none" style={[styles.toastRow, { opacity }]} accessibilityLiveRegion="polite">
      <View
        style={[
          styles.toast,
          {
            backgroundColor: theme.light ? '#ffffff' : '#1f1f1f',
            borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)',
          },
        ]}
      >
        {shown.title !== undefined ? (
          <Text style={[styles.toastTitle, { color: shown.error ? theme.error : theme.foreground }]}>
            {shown.title}
          </Text>
        ) : null}
        <Text
          style={[
            styles.toastText,
            { color: shown.error && shown.title === undefined ? theme.error : theme.cardMuted },
          ]}
        >
          {shown.message}
        </Text>
      </View>
    </Animated.View>
  );
}

/** The transcript strip the composer leaves in view when its field has to give up lines. */
const TRANSCRIPT_KEPT_IN_VIEW = 48;

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 },
  transcript: { flex: 1, minHeight: 0 },
  error: { padding: 16, fontSize: 14 },
  preloading: { position: 'absolute', top: -2, left: -2, width: 1, height: 1, opacity: 0 },
  toastRow: { position: 'absolute', top: 8, left: 16, right: 16, alignItems: 'center' },
  toast: { maxWidth: 420, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, gap: 2 },
  toastTitle: { fontSize: 13, fontWeight: '600' },
  toastText: { fontSize: 13, lineHeight: 18 },
  dropHighlight: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    bottom: 6,
    borderWidth: 2,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropLabel: {
    fontSize: 14,
    fontWeight: '500',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    overflow: 'hidden',
  },
});
