/**
 * The box actions as menu rows, for the header pill's long press and a box session row's long
 * press: what the desktop's box chip menu offers that the phone can do (Q1017 "chip and settings";
 * Q1033 D7: saving snapshots stays on the computer).
 */


import type { ContextMenuItem } from '../components/sessions/ContextMenu';
import { deleteBox, openBoxPullRequest, pullBoxBranch, stopBox, type BoxActionOutcome } from './actions';
import { boxBranch, chipDetail } from './chip';
import type { CloudBoxEntry } from './store';
import { cloudBoxStateLabel, isReachable } from './types';
import { showAlert } from '../components/common/dialog/alert';

function confirmDelete(entry: CloudBoxEntry, force: boolean, report: (outcome: BoxActionOutcome) => void): void {
  showAlert(
    force ? `Delete ${entry.box.name} anyway?` : `Delete ${entry.box.name}?`,
    force
      ? 'Its uncommitted and unpushed work is lost with it.'
      : entry.box.snapshotId
        ? 'The box and its disk are deleted. Its snapshot is kept.'
        : 'The box and its disk are deleted.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: force ? 'Delete anyway' : 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteBox(entry, force).then((outcome) => {
            report(outcome);
            if (!outcome.ok && outcome.unpushed === true) confirmDelete(entry, true, report);
          });
        },
      },
    ],
  );
}

/** The box's rows: what it is, then Stop, Pull branch, Open PR and Delete. */
export function cloudBoxMenuItems(
  entry: CloudBoxEntry,
  sessionId: string | null,
  report: (outcome: BoxActionOutcome) => void,
  close: () => void,
): ContextMenuItem[] {
  const { box } = entry;
  const branch = boxBranch(box, sessionId);
  const run = (action: () => Promise<BoxActionOutcome>) => () => {
    close();
    void action().then(report, (error: unknown) =>
      report({ ok: false, message: error instanceof Error ? error.message : String(error) }),
    );
  };
  const unpushed = box.hasUnpushedWork === true;
  return [
    { kind: 'note', key: 'cloudBox.detail', label: `${cloudBoxStateLabel(box.state)} · ${chipDetail(box)}` },
    { kind: 'separator', key: 'cloudBox.sep1' },
    {
      kind: 'item',
      key: 'cloudBox.stop',
      label: 'Stop',
      disabled: !isReachable(box.state),
      onPress: run(() => stopBox(entry)),
    },
    {
      kind: 'item',
      key: 'cloudBox.pull',
      label: 'Pull branch',
      info: 'Brings the branch into a worktree of this project on your computer.',
      disabled: branch === null,
      onPress: run(() => pullBoxBranch(entry, sessionId)),
    },
    {
      kind: 'item',
      key: 'cloudBox.openPr',
      label: 'Open PR',
      disabled: branch === null,
      onPress: run(() => openBoxPullRequest(entry, sessionId)),
    },
    { kind: 'separator', key: 'cloudBox.sep2' },
    {
      kind: 'item',
      key: 'cloudBox.delete',
      label: unpushed ? 'Delete anyway (unpushed work)…' : 'Delete…',
      destructive: true,
      onPress: () => {
        close();
        confirmDelete(entry, unpushed, report);
      },
    },
  ];
}
