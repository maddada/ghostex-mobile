/**
 * Runs the rows the chat's ⋯ and the terminal's ⋯ share with the long-press session menu (Coordinator, Mark Thread
 * Done, Copy, Tag As, Close After Done, Handoff / Export, Link to, Make Coordinator, Postpone By, Close), which
 * screens/sessions-screen/sidebar-menus.ts builds for one session (`sessionMenuPlaces`). Each row carries the computer
 * and session it was built for, and acts on that session even when another tab is selected by then; the rows the
 * screen performs for its selected session (Edit Delayed Send, Handoff / Export, Close After Done) refuse when that
 * session is no longer the selected one. The words a row answers with are the long-press menu's
 * (../sessions-screen/session-menu-actions.ts), shown in this hook's own notice.
 *
 * CDXC:ContextMenus 2026-11-20 SEE-ALSO: packages/gx-core/src/sidebar_menu/layout.rs (the user's decision that every
 * session menu is one list, so these rows are in the chat's and the terminal's ⋯ too).
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  coordinatorEditCommand,
  coordinatorStatusCommand,
  setSessionWorkLinksCommand,
  workLinkCandidatesCommand,
  type WorkLinkKind,
} from '../../commands/ghostexCli';
import NoticeToast, { type Notice } from '../../components/common/NoticeToast';
import { runGhostexCli } from '../../components/sessions/cli';
import { NO_SUMMARY_CAPABILITIES, type GhostexSession } from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';
import { runSessionCommand } from '../../sessions/sessionCommands';
import { closeConfirmCopy } from '../sessions-screen/close-confirm';
import CoordinatorDetailsSheet, {
  parseCoordinatorDetails,
  type CoordinatorDetailsMode,
} from '../sessions-screen/CoordinatorDetailsSheet';
import {
  cancelDelayedSendSessionAction,
  closePutsSessionToSleep,
  closeSessionAction,
  sessionTitle,
  tagSessionAction,
  type BulkSessionAction,
} from '../sessions-screen/session-actions';
import {
  COORDINATOR_UPDATED_NOTICE,
  COPY_NOTICES,
  copyWithNotice,
  makeCoordinator,
  makeCoordinatorConfirm,
  makeMainCoordinator,
  resolveCoordinatorThread,
  sleepInactiveCoordinatorThreads,
  unlinkLead,
  type SessionMenuFeedback,
} from '../sessions-screen/session-menu-actions';
import type { SidebarMenuCommand } from '../sessions-screen/sidebar-menus';
import WorkLinkPicker, { parseWorkLinkCandidates } from '../sessions-screen/work-link-picker';
import { machineRecordFor } from './session-lookups';
import { showAlert } from '../../components/common/dialog/alert';

/** The session a shared row was built for. */
export type SessionMenuTarget = { machineId: string; sessionId: string };

type Sheet =
  | { kind: 'none' }
  | { kind: 'coordinatorDetails'; machine: MachineRecord; session: GhostexSession; mode: CoordinatorDetailsMode }
  | { kind: 'workLinkPicker'; machine: MachineRecord; session: GhostexSession; linkKind: WorkLinkKind };

const NO_SHEET: Sheet = { kind: 'none' };

export type SessionMenuRunnerDeps = {
  /** The full-screen progress line (null hides it). */
  setProgress: (message: string | null) => void;
  /** Whether `target` is the session the screen has selected, which the three rows below act on. */
  isSelected: (target: SessionMenuTarget) => boolean;
  /** Delayed Send's dialog for the selected session (Postpone By › Edit Delayed Send). */
  editDelayedSend: () => void;
  /** Handoff / Export for the selected session. */
  exportTranscript: () => void;
  /** Close After Done for the selected session. */
  toggleCloseAfterDone: () => void;
  /** The coordinator's playbook sheet, on its own computer and project (Coordinator › View Playbook). */
  viewPlaybook: (machine: MachineRecord, session: GhostexSession) => void;
  /** Where the notice stands above the screen's bottom edge. */
  noticeBottom: number;
};

export function useSessionMenuRunner({
  setProgress,
  isSelected,
  editDelayedSend,
  exportTranscript,
  toggleCloseAfterDone,
  viewPlaybook,
  noticeBottom,
}: SessionMenuRunnerDeps): {
  run: (target: SessionMenuTarget, command: SidebarMenuCommand) => void;
  sheets: ReactNode;
} {
  const [sheet, setSheet] = useState<Sheet>(NO_SHEET);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeCounter = useRef(0);
  const notify = useCallback((message: string, error: boolean): void => {
    noticeCounter.current += 1;
    setNotice({ id: noticeCounter.current, message, error });
  }, []);
  const feedback = useMemo<SessionMenuFeedback>(() => ({ setProgress, notify }), [notify, setProgress]);

  const runAction = useCallback(
    (machine: MachineRecord, action: BulkSessionAction): void => {
      void runSessionCommand(machine, action.command, {
        closeWarmSessionId: action.closeWarmSession ? action.sessionId : undefined,
        optimisticChange: action.optimisticChange,
        onError: (message) => notify(message, true),
      });
    },
    [notify],
  );

  const confirmClose = useCallback(
    (machine: MachineRecord, session: GhostexSession): void => {
      const summary = useInventoryStore.getState().inventoriesByMachineId[machine.id]?.summary;
      const copy = closePutsSessionToSleep(session)
        ? { title: 'Close session?', body: SessionCopy.claudeCloudCloseSleeps }
        : (closeConfirmCopy(session, summary?.sessions ?? [], summary?.capabilities ?? NO_SUMMARY_CAPABILITIES) ?? {
            title: 'Close session?',
            body: 'This closes the selected Ghostex session on the connected machine.',
          });
      showAlert(copy.title, `${sessionTitle(session)}\n\n${copy.body}`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close Session',
          style: 'destructive',
          onPress: () => runAction(machine, closeSessionAction(session, 'phone.sessionMenu')),
        },
      ]);
    },
    [runAction],
  );

  const run = useCallback(
    (target: SessionMenuTarget, command: SidebarMenuCommand): void => {
      const machine = machineRecordFor(target.machineId);
      const session =
        useInventoryStore
          .getState()
          .inventoriesByMachineId[target.machineId]?.summary?.sessions.find(
            (entry) => entry.sessionId === target.sessionId,
          ) ?? null;
      if (machine === null || session === null) {
        notify('That session is no longer on the computer.', true);
        return;
      }
      /** A row the screen performs for its selected session, only while this is still it. */
      const onSelected = (perform: () => void): void => {
        if (isSelected(target)) perform();
        else notify('That session is no longer selected.', true);
      };
      switch (command.type) {
        case 'command': {
          const message = command.message;
          switch (message.type) {
            case 'copyText':
              copyWithNotice(message.text, COPY_NOTICES.text, feedback);
              return;
            case 'copySessionDetails':
              copyWithNotice(message.text, COPY_NOTICES.details, feedback);
              return;
            case 'setSessionTag':
              runAction(machine, tagSessionAction(session, message.sessionTag));
              return;
            case 'toggleCloseAfterDone':
              onSelected(toggleCloseAfterDone);
              return;
            case 'exportSessionTranscript':
              onSelected(exportTranscript);
              return;
            case 'cancelDelayedSend':
              runAction(machine, cancelDelayedSendSessionAction(session));
              return;
            case 'closeSession':
              confirmClose(machine, session);
              return;
            case 'makeCoordinator': {
              const confirm = makeCoordinatorConfirm(session);
              showAlert(confirm.title, confirm.body, [
                { text: 'Cancel', style: 'cancel' },
                { text: confirm.confirmLabel, onPress: () => void makeCoordinator(machine, session, feedback) },
              ]);
              return;
            }
            case 'sleepInactiveCoordinatorThreads':
              void sleepInactiveCoordinatorThreads(machine, session, feedback);
              return;
            case 'setSessionWorkLinks':
              void runSessionCommand(
                machine,
                setSessionWorkLinksCommand(session.sessionId, session.projectId, message.links),
                { onError: (text) => notify(text, true) },
              );
              return;
            default:
              // The shared places make no other message (sidebar-menus.ts `sessionMenuPlaces`).
              return;
          }
        }
        case 'sessionAction':
          if (command.action === 'linkWork') {
            setSheet({ kind: 'workLinkPicker', machine, session, linkKind: command.kind });
          } else if (command.action === 'delayedSend') {
            onSelected(editDelayedSend);
          }
          return;
        case 'coordinatorSessionAction':
          switch (command.action) {
            case 'goal':
            case 'memory':
              setSheet({ kind: 'coordinatorDetails', machine, session, mode: command.action });
              return;
            case 'viewPlaybook':
              viewPlaybook(machine, session);
              return;
            case 'makeMain':
              void makeMainCoordinator(machine, session, feedback);
              return;
            case 'unlinkLead':
            case 'stopLeading':
              void unlinkLead(machine, session, command.action === 'stopLeading', feedback);
              return;
            case 'markDone':
            case 'reopen':
              void resolveCoordinatorThread(machine, session, command.action === 'markDone', feedback);
              return;
          }
          return;
        default:
          return;
      }
    },
    [
      confirmClose,
      editDelayedSend,
      exportTranscript,
      feedback,
      isSelected,
      notify,
      runAction,
      toggleCloseAfterDone,
      viewPlaybook,
    ],
  );

  const close = useCallback(() => setSheet(NO_SHEET), []);

  let sheetView: ReactNode = null;
  if (sheet.kind === 'coordinatorDetails') {
    const { machine, session } = sheet;
    sheetView = (
      <CoordinatorDetailsSheet
        mode={sheet.mode}
        load={async () =>
          parseCoordinatorDetails((await runGhostexCli(machine, coordinatorStatusCommand(session.globalRef))).json)
        }
        onSave={async (edit) => {
          await runGhostexCli(machine, coordinatorEditCommand(session.globalRef, edit));
          close();
          notify(COORDINATOR_UPDATED_NOTICE, false);
        }}
        onCancel={close}
      />
    );
  } else if (sheet.kind === 'workLinkPicker') {
    const { machine, session, linkKind } = sheet;
    sheetView = (
      <WorkLinkPicker
        kind={linkKind}
        sessionTitle={sessionTitle(session)}
        load={async (query) =>
          parseWorkLinkCandidates(
            (
              await runGhostexCli(
                machine,
                workLinkCandidatesCommand(session.sessionId, session.projectId, linkKind, query),
                { timeoutMs: 45_000 },
              )
            ).json,
          )
        }
        onPick={(values) => {
          close();
          // The chosen values replace what that kind linked to (use-sessions-screen-menus.tsx `saveWorkLinks`).
          const links =
            linkKind === 'pullRequest'
              ? { pullRequest: values[0] ?? 'none' }
              : linkKind === 'linearProject'
                ? { linearProject: values[0] ?? '' }
                : linkKind === 'githubProject'
                  ? { githubProject: values[0] ?? 'none' }
                  : linkKind === 'linearIssue'
                    ? { linearIssues: values }
                    : { githubIssues: values };
          void runSessionCommand(machine, setSessionWorkLinksCommand(session.sessionId, session.projectId, links), {
            onError: (text) => notify(text, true),
          });
        }}
        onCancel={close}
      />
    );
  }
  return {
    run,
    sheets: (
      <>
        {sheetView}
        <NoticeToast notice={notice} bottom={noticeBottom} />
      </>
    ),
  };
}
