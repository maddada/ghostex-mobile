/**
 * SessionsScreen actions: opening a session on its terminal or chat, running session commands and
 * batches, the creation flows, Rename and Session note, quick actions and restoring a recent
 * project. Moved verbatim from src/screens/SessionsScreen.tsx; the overlays and menus they serve
 * stay there and in ./use-sessions-screen-menus.tsx.
 */

import { useCallback } from 'react';
import { Linking } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';

import {
  answerWorkCleanupCommand,
  renameCommandCommand,
  restoreRecentProjectCommand,
  runActionCommand,
  sessionNoteSaveCommand,
} from '../../commands/ghostexCli';
import { createdSessionId, runGhostexCli } from '../../components/sessions/cli';
import type { WorkChipActions } from '../../components/sessions/WorkChips';
import { claudeCloudPageUrl } from '../../contract/claudeCloud';
import { projectKeyForSession, type ProjectHeaderItem } from '../../contract/grouping';
import type { GhostexQuickAction, GhostexSession } from '../../contract/mobileSummary';
import { ProgressCopy, RenameCopy, SessionCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import { useInventoryStore } from '../../inventory/store';
import { machineDisplayLabel, type MachineRecord } from '../../machines/store';
import type { RootStackParamList } from '../../navigation/types';
import {
  enqueueRemoteMutation,
  renameMutation,
  RENAME_CONFIRM_REFRESH_MS,
  runSessionCommand as runSessionCommandOnMachine,
  sessionNoteMutation,
} from '../../sessions/sessionCommands';
import { acknowledgeSessionAttention } from '../../terminal/attention';
import { markSessionOpen, markSessionOpenTap } from '../../terminal/openTiming';
import { attachSessionKey, useTerminalStore } from '../../terminal/sessions';
import { webPreviewTargetForUrl } from '../../webPreview/routing';
import { sessionOpensInChatView } from '../terminal-screen/session-lookups';
import {
  killSessionAction,
  lifecycleSessionAction,
  NONE,
  quickActionDisplayName,
  sessionTitle,
  type BulkSessionAction,
  type Overlay,
  type ProjectContext,
  type SessionContext,
} from './session-actions';

type SessionsNavigation = NativeStackScreenProps<RootStackParamList, 'Sessions'>['navigation'];

export type SessionsScreenActionsDeps = {
  navigation: SessionsNavigation;
  setOverlay: (overlay: Overlay) => void;
  /** Full-screen progress line (null hides it). */
  setProgress: (message: string | null) => void;
  setTransientStatus: (message: string | null) => void;
  refreshMachine: (machine: MachineRecord) => Promise<void>;
  retryMachine: (machineId: string) => Promise<void>;
};

export function useSessionsScreenActions({
  navigation,
  setOverlay,
  setProgress,
  setTransientStatus,
  refreshMachine,
  retryMachine,
}: SessionsScreenActionsDeps) {
  const attach = useCallback(
    async (target: MachineRecord, session: GhostexSession, options?: { terminal?: boolean }): Promise<void> => {
      setOverlay(NONE);
      // Desktop parity: opening a session from the list acknowledges its
      // attention status.
      acknowledgeSessionAttention(target.id, session.sessionId);
      const openKey = attachSessionKey(target.id, session.sessionId);
      if (options?.terminal === true) {
        // Long-press Open Terminal: the terminal, even where a tap opens claude.ai or the chat.
        useTerminalStore.getState().setSessionViewMode(openKey, 'terminal');
      } else {
        // A Claude cloud session running on claude.ai opens its page there (claudeCloud.ts).
        const cloudPage = claudeCloudPageUrl(session.claudeCloud);
        if (cloudPage !== null) {
          void Linking.openURL(cloudPage).catch(() => setTransientStatus(SessionCopy.claudeCloudOpenFailed));
          return;
        }
      }
      markSessionOpenTap(openKey);
      if (options?.terminal !== true && sessionOpensInChatView(openKey, session)) {
        /**
         * CDXC:SessionChat 2026-10-08 DECISION:
         * User: "Clicking on a chat on the Android app to show takes a long time … Terminal is much less useful on phone", picking "Phone opens chat first", with the rule "pls dont break things for users who set default to terminal at all". A session that opens in Chat View navigates at once and paints its cached transcript. Since 2026-10-08 ("Chat-only, no terminal", `openChatTab` in terminal/sessions.ts) it attaches no terminal at all until the user switches to Terminal, where the Terminal view's own overlay shows the attach and its errors. A session that opens in Terminal View still waits for the attach before navigating, exactly as before.
         */
        useTerminalStore.getState().openChatTab(target, {
          sessionId: session.sessionId,
          projectId: session.projectId.length > 0 ? session.projectId : undefined,
          title: sessionTitle(session),
        });
        navigation.navigate('Terminal', {
          sessionKey: openKey,
          machineId: target.id,
          title: sessionTitle(session),
        });
        markSessionOpen(openKey, 'navigate');
        return;
      }
      setTransientStatus(ProgressCopy.preparingAttach(session.alias));
      try {
        const sessionKey = await useTerminalStore.getState().attachSession(target, {
          sessionId: session.sessionId,
          projectId: session.projectId.length > 0 ? session.projectId : undefined,
          title: sessionTitle(session),
        });
        markSessionOpen(sessionKey, 'terminalOpen');
        setTransientStatus(ProgressCopy.attached(session.alias, machineDisplayLabel(target)));
        navigation.navigate('Terminal', {
          sessionKey,
          machineId: target.id,
          title: sessionTitle(session),
        });
        markSessionOpen(sessionKey, 'navigate');
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [navigation, setTransientStatus],
  );

  /** Attach a session that only exists as an id (creation flows, §6). */
  const attachCreated = useCallback(
    async (
      target: MachineRecord,
      sessionId: string,
      chatLaunch?: { agentId: string; projectId: string; title: string },
    ): Promise<void> => {
      const created = useInventoryStore
        .getState()
        .inventoriesByMachineId[target.id]?.summary?.sessions.find((session) => session.sessionId === sessionId);
      const sessionKey = attachSessionKey(target.id, sessionId);
      if (chatLaunch) useTerminalStore.getState().setSessionViewMode(sessionKey, 'chat');
      const attaching = useTerminalStore.getState().attachSession(target, {
        sessionId,
        projectId:
          chatLaunch?.projectId ??
          (created !== undefined && created.projectId.length > 0 ? created.projectId : undefined),
        title: chatLaunch?.title ?? (created !== undefined ? sessionTitle(created) : undefined),
        agentId: chatLaunch?.agentId,
      });
      // CDXC:SessionChat 2026-09-09 DECISION:
      // User: open chat immediately while the terminal starts in the background. Creation supplies the identity, so inventory and SSH attachment do not gate navigation.
      if (!chatLaunch) await attaching;
      navigation.navigate('Terminal', {
        sessionKey,
        machineId: target.id,
        title: chatLaunch?.title ?? (created !== undefined ? sessionTitle(created) : undefined),
      });
      if (chatLaunch)
        void attaching.catch((error: unknown) => {
          setTransientStatus(error instanceof Error ? error.message : String(error));
        });
    },
    [navigation, setTransientStatus],
  );

  const runSessionCommand = useCallback(
    async (
      target: MachineRecord,
      command: string,
      options?: {
        closeWarmSessionId?: string;
        optimisticChange?: OptimisticInventoryChange;
      },
    ): Promise<void> => {
      setOverlay(NONE);
      await runSessionCommandOnMachine(target, command, {
        ...options,
        onError: setTransientStatus,
      });
    },
    [setTransientStatus],
  );

  /**
   * What a work-mode card's chips do: a tap opens the link on the phone, a long press copies it,
   * and Clean up / Keep answer the merged-PR offer on the computer (`ghostex work-mode cleanup`).
   */
  const workChipActions = useCallback(
    (target: MachineRecord | null, session: GhostexSession): WorkChipActions | undefined => {
      if (target === null) return undefined;
      return {
        openLink: (url) => {
          void Linking.openURL(url).catch(() => setTransientStatus(`Could not open ${url}`));
        },
        copyLink: (url) => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          void Clipboard.setStringAsync(url)
            .then(() => setTransientStatus('Link copied'))
            .catch((error: unknown) => setTransientStatus(error instanceof Error ? error.message : String(error)));
        },
        answerCleanup: (answer) => {
          if (answer === 'cleanUp') setTransientStatus('Cleaning up…');
          void runSessionCommand(target, answerWorkCleanupCommand(session.sessionId, session.projectId, answer));
        },
      };
    },
    [runSessionCommand, setTransientStatus],
  );

  /** Run a session batch sequentially, retaining per-session rollback. */
  const runBulkSessionActions = useCallback(
    async (target: MachineRecord, actions: readonly BulkSessionAction[]): Promise<void> => {
      setOverlay(NONE);
      const changes = actions.flatMap((action) =>
        action.optimisticChange === undefined ? [] : [action.optimisticChange],
      );
      const mutationIds = useInventoryStore.getState().beginOptimisticMutations(target.id, changes);
      let mutationIndex = 0;
      const prepared = actions.map((action) => {
        const mutationId = action.optimisticChange === undefined ? null : mutationIds[mutationIndex++];
        return { action, mutationId };
      });
      const failures: string[] = [];
      let successCount = 0;

      for (const { action, mutationId } of prepared) {
        const actionMutationIds = mutationId === null ? [] : [mutationId];
        try {
          await enqueueRemoteMutation(target.id, `session:${action.sessionId}`, async (): Promise<void> => {
            if (action.closeWarmSession) {
              await useTerminalStore.getState().closeWarmSessionFor(target.id, action.sessionId);
            }
            await runGhostexCli(target, action.command);
            if (actionMutationIds.length > 0) {
              useInventoryStore.getState().commitOptimisticMutations(target.id, actionMutationIds);
            }
          });
          successCount++;
        } catch (error) {
          if (actionMutationIds.length > 0) {
            useInventoryStore.getState().rollbackOptimisticMutations(target.id, actionMutationIds);
          }
          failures.push(error instanceof Error ? error.message : String(error));
        }
      }

      if (successCount > 0) {
        await useInventoryStore.getState().refreshMachineFresh(target);
      }
      if (failures.length > 0) {
        const prefix = failures.length === 1 ? '1 session action failed' : `${failures.length} session actions failed`;
        setTransientStatus(`${prefix}: ${failures[0]}`);
      }
    },
    [setTransientStatus],
  );

  /** Chat creation opens from the returned identity; inventory and attachment finish in the background. */
  const runCreationFlow = useCallback(
    async (
      target: MachineRecord,
      command: string,
      message: string,
      chatLaunch?: { agentId: string; projectId: string; title: string },
    ): Promise<void> => {
      setOverlay(NONE);
      setProgress(message);
      try {
        const result = await runGhostexCli(target, command);
        if (!chatLaunch) await refreshMachine(target);
        setProgress(null);
        const sessionId = createdSessionId(result);
        if (sessionId !== null) {
          await attachCreated(target, sessionId, chatLaunch);
        }
        if (chatLaunch)
          void refreshMachine(target).catch((error: unknown) => {
            setTransientStatus(error instanceof Error ? error.message : String(error));
          });
      } catch (error) {
        setProgress(null);
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [attachCreated, refreshMachine, setTransientStatus],
  );

  /**
   * Drop the machine's SSH connection and reconnect it. This is what the old
   * header Refresh button did, narrowed to one machine because it is now
   * reached from that machine's own tab menu.
   */
  const reconnectMachine = useCallback(
    async (target: MachineRecord): Promise<void> => {
      await retryMachine(target.id);
    },
    [retryMachine],
  );

  const submitRename = useCallback(
    async (ctx: SessionContext, value: string): Promise<void> => {
      const title = value.trim();
      if (title.length === 0) {
        setOverlay({ kind: 'rename', ctx, error: RenameCopy.emptyTitleError });
        return;
      }
      const { session } = ctx.item;
      const result = await runSessionCommand(
        ctx.machine,
        renameCommandCommand(session.sessionId, title, session.projectId.length > 0 ? session.projectId : undefined),
        { optimisticChange: renameMutation(session.sessionId, title) },
      );
      // gxserver shows the new name until the agent confirms it or the window runs out; one
      // refresh right after the window brings a refused name back (and its shake) without
      // waiting for the next poll.
      if (result !== null) {
        setTimeout(() => void refreshMachine(ctx.machine), RENAME_CONFIRM_REFRESH_MS);
      }
    },
    [refreshMachine, runSessionCommand],
  );

  /**
   * Save (or, with all-whitespace text, clear) the note on the session's agent
   * conversation. An empty value is a real edit here, so unlike Rename it is
   * submitted rather than rejected.
   */
  const submitSessionNote = useCallback(
    async (ctx: SessionContext, value: string): Promise<void> => {
      const { session } = ctx.item;
      const note = value.trim();
      await runSessionCommand(ctx.machine, sessionNoteSaveCommand(session.sessionId, session.projectId, note), {
        optimisticChange: sessionNoteMutation(session.sessionId, note),
      });
    },
    [runSessionCommand],
  );

  const runQuickAction = useCallback(
    (target: MachineRecord, projectId: string, projectTitle: string, action: GhostexQuickAction): void => {
      const name = quickActionDisplayName(action);
      if (action.actionType === 'browser') {
        const url = action.url ?? '';
        if (url.length === 0) return;
        /*
         * The action's URL was written for the computer, so a loopback address
         * names a listener there and not on the phone. Those open in the Web
         * preview, which forwards the port; every other address is a real
         * internet address and goes to the phone's browser as before.
         */
        const previewTarget = webPreviewTargetForUrl(url);
        if (previewTarget !== null) {
          setOverlay(NONE);
          navigation.navigate('WebPreview', {
            machineId: target.id,
            remotePort: previewTarget.remotePort,
            path: previewTarget.path,
            scheme: previewTarget.scheme,
            host: previewTarget.host,
          });
          return;
        }
        void Linking.openURL(url)
          .then(() => setTransientStatus(ProgressCopy.openedInBrowser(name)))
          .catch(() => setTransientStatus(ProgressCopy.openedInBrowser(name)));
        return;
      }
      const commandId = action.commandId ?? '';
      if (commandId.length === 0) return;
      void runCreationFlow(
        target,
        runActionCommand(commandId, projectId),
        ProgressCopy.startingAgent(name, projectTitle),
      );
    },
    [navigation, runCreationFlow, setTransientStatus],
  );

  const restoreRecentProject = useCallback(
    async (target: MachineRecord, projectId: string, title: string): Promise<void> => {
      setOverlay(NONE);
      setTransientStatus(ProgressCopy.restoringProject(title));
      try {
        await runGhostexCli(target, restoreRecentProjectCommand(projectId));
        await refreshMachine(target);
        setTransientStatus(ProgressCopy.restoredProject(title));
      } catch (error) {
        setTransientStatus(error instanceof Error ? error.message : String(error));
      }
    },
    [refreshMachine, setTransientStatus],
  );

  const sessionsForProject = useCallback((target: MachineRecord, header: ProjectHeaderItem): GhostexSession[] => {
    const summary = useInventoryStore.getState().inventoriesByMachineId[target.id]?.summary;
    if (summary === null || summary === undefined) return [];
    return summary.sessions.filter((session) => projectKeyForSession(session) === header.projectKey);
  }, []);

  const runProjectSessionsAction = useCallback(
    async (ctx: ProjectContext, action: 'wake' | 'sleep' | 'kill'): Promise<void> => {
      const sessions = sessionsForProject(ctx.machine, ctx.header);
      await runBulkSessionActions(
        ctx.machine,
        sessions.map((session) =>
          action === 'kill' ? killSessionAction(session) : lifecycleSessionAction(session, action === 'sleep'),
        ),
      );
    },
    [runBulkSessionActions, sessionsForProject],
  );

  return {
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
  };
}
