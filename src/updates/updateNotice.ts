/**
 * The one update there is to take, for the Sessions screen's Update button and the Settings row: a
 * downloaded over-the-air update (taking it restarts into it), or a newer app (the GitHub APK
 * downloads and opens the installer; Google Play, TestFlight and the App Store open their page).
 * A ready update comes first: it is a restart away, and the newer app still shows after it.
 */

import { availableUpdate, useAppUpdateStore } from './appUpdateStore';
import { InstallSourceCopy, type InstallSource } from './installSource';
import { restartToApplyUpdate, useDownloadedUpdate } from './overTheAir';

export type UpdateAction =
  | { kind: 'restart' }
  | { kind: 'newApp'; version: string; source: InstallSource; downloadPercent: number | null };

export function useUpdateAction(): UpdateAction | null {
  const ready = useDownloadedUpdate();
  const newApp = useAppUpdateStore((state) => availableUpdate(state.check));
  const source = useAppUpdateStore((state) => state.source);
  const downloadPercent = useAppUpdateStore((state) =>
    state.download.phase === 'downloading' && state.download.totalBytes > 0
      ? Math.min(100, Math.floor((state.download.bytesWritten / state.download.totalBytes) * 100))
      : null,
  );
  if (ready !== null) return { kind: 'restart' };
  if (newApp !== null) return { kind: 'newApp', version: newApp.version, source, downloadPercent };
  return null;
}

export function takeUpdateAction(action: UpdateAction): void {
  if (action.kind === 'restart') void restartToApplyUpdate();
  else void useAppUpdateStore.getState().takeNewApp();
}

/** What the button says to a screen reader, and the Settings row's one line. */
export function updateActionLabel(action: UpdateAction): string {
  if (action.kind === 'restart') return 'Restart to update';
  if (action.downloadPercent !== null) return `Downloading Ghostex ${action.version}, ${action.downloadPercent}%`;
  return action.source === 'github'
    ? `Install Ghostex ${action.version}`
    : `Ghostex ${action.version} is on ${InstallSourceCopy[action.source]}`;
}

export function useUpdateNotice(): string | null {
  const action = useUpdateAction();
  return action === null ? null : updateActionLabel(action);
}
