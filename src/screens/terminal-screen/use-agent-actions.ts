/**
 * TerminalScreen Agent Actions (desktop terminal-overlay parity, minus the
 * stash entries gxserver exposes no CLI verb for), moved verbatim from
 * src/screens/TerminalScreen.tsx. The hooks inside (twenty useCallbacks and
 * the promptEditorDraft useState) run in their original relative order.
 */

import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Alert, Platform } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { createdSessionId, runGhostexCli } from '../../components/sessions/cli';
import { type TerminalMenuActionId } from '../../components/terminal/TerminalMenu';
import {
  pickAndSendAttachment,
  pickAndSendImageAttachment,
} from '../../components/terminal/uploads';
import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  createAgentCommand,
  delayedSendCommand,
  exportSessionTranscriptCommand,
  forkSessionCommand,
  killSessionCommand,
  reloadSessionCommand,
  requestSessionRenameCommand,
  sendSessionChatMessageCommand,
  sleepSessionCommand,
  wakeSessionCommand,
} from '../../commands/ghostexCli';
import {
  readSessionChatSyncedDraft,
  writeSessionChatSyncedDraft,
  type SessionChatSyncedDraft,
} from '../../chat/session-chat-helpers';
import type { GhostexSession } from '../../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import type { MachineConnectionTarget } from '../../machines/credentials';
import { useMachinesStore, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import {
  lifecycleMutation,
  renameMutation,
  runSessionCommand,
} from '../../sessions/sessionCommands';
import { acknowledgeSessionAttention } from '../../terminal/attention';
import { useTerminalStore, type TerminalTab } from '../../terminal/sessions';
import {
  AGENT_OVERLAY_NONE,
  machineRecordFor,
  machineTargetFor,
  sessionFolderFor,
  transcriptMentionDraft,
  type AgentOverlay,
  type ExportedTranscript,
} from './session-lookups';

type TerminalNavigation = NativeStackScreenProps<RootStackParamList, 'Terminal'>['navigation'];

export type TerminalAgentActionsDeps = {
  activeTab: TerminalTab | null;
  activeProjectId: string;
  activeSession: GhostexSession | null;
  activeAgentId: string;
  chatModeActive: boolean;
  uploading: boolean;
  setUploading: (uploading: boolean) => void;
  setAgentOverlay: (overlay: AgentOverlay) => void;
  setAgentProgress: (progress: string | null) => void;
  exportedTranscript: ExportedTranscript | null;
  setExportedTranscript: (exported: ExportedTranscript | null) => void;
  startingTranscriptConversation: boolean;
  setStartingTranscriptConversation: (starting: boolean) => void;
  setExportedTranscriptError: (error: string | null) => void;
  setMenuVisible: (visible: boolean) => void;
  setChatSearchRequestId: Dispatch<SetStateAction<number>>;
  navigation: TerminalNavigation;
  requestCloseTab: (tab: TerminalTab) => void;
  openShellTab: (
    machine: MachineConnectionTarget,
    options?: { title?: string; cwd?: string },
  ) => Promise<string>;
};

export function useTerminalAgentActions({
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
}: TerminalAgentActionsDeps) {
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
      reportAgentFailure('Handoff / Export Failed', error);
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
    const { machine, projectId, agentId, path, sessionTitle } = exportedTranscript;
    if (agentId.length === 0) return;
    setStartingTranscriptConversation(true);
    setExportedTranscriptError(null);
    try {
      const created = await runGhostexCli(
        machine,
        createAgentCommand(agentId, projectId, transcriptMentionDraft(path, sessionTitle)),
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

  /*
   * CDXC:SessionChatPromptQueue 2026-08-21:
   * The synced draft the Prompt Editor opens on, and writes back to, in chat
   * mode. `null` while the read is still in flight (the sheet is already on
   * screen by then, and seeds when it lands); `supported: false` is a machine
   * whose Ghostex predates the draft endpoint, and there the sheet behaves
   * exactly as it did before rather than writing into a verb that does not
   * exist.
   */
  const [promptEditorDraft, setPromptEditorDraft] = useState<SessionChatSyncedDraft | null>(null);

  const seedPromptEditorDraft = useCallback((): void => {
    setPromptEditorDraft(null);
    if (!chatModeActive) return;
    const target = agentTarget();
    if (target === null) return;
    void readSessionChatSyncedDraft(
      target.machine,
      target.projectId,
      target.session.sessionId,
    ).then(setPromptEditorDraft);
  }, [agentTarget, chatModeActive]);

  /**
   * Publish what the Prompt Editor is leaving behind. Only in chat mode, only
   * on a machine that answered the seeding read, and only when the text
   * actually changed — an unchanged draft is not worth an SSH round trip.
   */
  const pushPromptEditorDraft = useCallback(
    (content: string): void => {
      const draft = promptEditorDraft;
      if (draft === null || !draft.supported || content === draft.content) return;
      const target = agentTarget();
      if (target === null) return;
      setPromptEditorDraft({ content, supported: true });
      void writeSessionChatSyncedDraft(
        target.machine,
        target.projectId,
        target.session.sessionId,
        content,
      ).catch((error: unknown) => reportAgentFailure('Draft Not Saved', error));
    },
    [agentTarget, promptEditorDraft, reportAgentFailure],
  );

  const submitPromptEditor = useCallback(
    async (text: string): Promise<void> => {
      const target = agentTarget();
      if (target === null) return;
      setAgentOverlay({ kind: 'promptEditor', sending: true });
      try {
        if (chatModeActive) {
          await sendChatMessageFromUser(text);
          // The text left the composer, so the session's draft is empty now —
          // the same thing sending from the chat composer does.
          pushPromptEditorDraft('');
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
    [
      agentTarget,
      chatModeActive,
      pushPromptEditorDraft,
      reportAgentFailure,
      sendChatMessageFromUser,
    ],
  );

  /** Attach from the Files browser ('file') or the photo library ('image'). */
  const handleUpload = useCallback(async (source: 'file' | 'image'): Promise<void> => {
    const store = useTerminalStore.getState();
    const tab = store.tabs.find((entry) => entry.sessionKey === store.selectedSessionKey);
    if (tab === undefined || uploading) return;
    // Chat mode has the terminal parked behind the chat surface, so the
    // reference is sent as a message and the native terminal need not be open.
    if (!chatModeActive && tab.state !== 'open') return;
    setUploading(true);
    try {
      const pick = source === 'image' ? pickAndSendImageAttachment : pickAndSendAttachment;
      await pick(
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

  const requestKillSession = useCallback((): void => {
    if (activeTab === null || activeSession === null) return;
    const machine = machineRecordFor(activeTab.machineId);
    if (machine === null) return;
    const session = activeSession;
    const projectId = session.projectId.length > 0 ? session.projectId : undefined;
    const title =
      session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
    Alert.alert(
      'Kill Session?',
      `This permanently ends "${title}" on the connected machine.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Kill Session',
          style: 'destructive',
          onPress: () => {
            void runSessionCommand(
              machine,
              killSessionCommand(session.sessionId, projectId),
              {
                closeWarmSessionId: session.sessionId,
                optimisticChange: { kind: 'sessionClose', sessionId: session.sessionId },
                onError: (message) =>
                  Alert.alert('Kill Session Failed', message, [{ text: 'OK' }]),
              },
            );
          },
        },
      ],
    );
  }, [activeSession, activeTab]);

  /**
   * Work a menu row deferred until the menu modal has finished dismissing.
   * See the `attachPath` case below for why anything needs to wait.
   */
  const pendingAfterMenuDismiss = useRef<(() => void) | null>(null);

  /**
   * "Send & Attach File" covers both sources: iOS's Files browser cannot see
   * the photo library, so the row asks which one to open instead of hard-wiring
   * the document picker.
   */
  const promptAttachmentSource = useCallback((): void => {
    Alert.alert('Send & Attach File', undefined, [
      { text: 'Photo Library', onPress: () => void handleUpload('image') },
      { text: 'Choose File', onPress: () => void handleUpload('file') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleUpload]);

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
          seedPromptEditorDraft();
          return;
        case 'exportTranscript':
          void runExportTranscript();
          return;
        case 'searchConversation':
          setChatSearchRequestId((current) => current + 1);
          return;
        case 'attachPath':
          /*
           * iOS presents the document picker, the photo picker, and the source
           * chooser alert from the top view controller, and the menu modal
           * closed just above is still that controller until its dismissal
           * completes: picking then either rejects ("Calling the
           * 'getDocumentAsync' function has failed") or hangs on a promise that
           * never settles, so no picker appears at all (reproduced on iOS
           * 26/27); an alert presented that early is silently dropped the same
           * way. So the whole chooser flow — not just the picker — waits for
           * the menu's `onDismiss`. Android's pickers are Activity intents and
           * its alert is a Dialog, so neither is affected.
           */
          if (Platform.OS === 'ios') {
            pendingAfterMenuDismiss.current = () => {
              setAgentOverlay(AGENT_OVERLAY_NONE);
              promptAttachmentSource();
            };
            return;
          }
          setAgentOverlay(AGENT_OVERLAY_NONE);
          promptAttachmentSource();
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
        case 'killSession':
          requestKillSession();
          return;
      }
    },
    [
      activeTab,
      handleNewTerminal,
      navigation,
      promptAttachmentSource,
      requestCloseTab,
      requestKillSession,
      runAgentFork,
      runAgentFullReload,
      runAgentSleep,
      runExportTranscript,
      seedPromptEditorDraft,
    ],
  );

  /** Runs whatever the last menu row deferred until the card was fully gone. */
  const handleMenuDismissed = useCallback((): void => {
    const pending = pendingAfterMenuDismiss.current;
    pendingAfterMenuDismiss.current = null;
    if (pending !== null) pending();
  }, []);

  return {
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
  };
}
