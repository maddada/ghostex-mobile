/**
 * Android self-update state: the last check result, the download in flight,
 * and the automatic-check schedule. `initAndroidSelfUpdate` runs a check at
 * startup and whenever the app returns to the foreground, at most once every
 * UPDATE_CHECK_INTERVAL_MS (the timestamp persists in AsyncStorage so a
 * relaunch does not reset the clock). The Settings button checks on demand.
 * Everything is a no-op unless ANDROID_SELF_UPDATE_ENABLED is on.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { ANDROID_SELF_UPDATE_ENABLED } from '../config/featureFlags';
import { downloadUpdateApk, hasDownloadedApk, launchApkInstaller, updateApkFile } from './androidApkInstall';
import {
  fetchLatestRelease,
  installedAppVersion,
  isNewerVersion,
  UPDATE_CHECK_INTERVAL_MS,
  type LatestRelease,
} from './androidSelfUpdate';

const LAST_CHECKED_STORAGE_KEY = 'androidSelfUpdate.lastCheckedAt.v1';

export type UpdateCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'checked'; latest: LatestRelease; updateAvailable: boolean; checkedAt: number }
  | { phase: 'error'; message: string; checkedAt: number };

export type UpdateDownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; bytesWritten: number; totalBytes: number }
  | { phase: 'ready'; version: string; fileUri: string; installError: string | null }
  | { phase: 'error'; version: string; message: string };

type AndroidSelfUpdateState = {
  check: UpdateCheckState;
  download: UpdateDownloadState;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  cancelDownload: () => void;
  installUpdate: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The newer release from the last successful check, or null. */
export function availableUpdate(check: UpdateCheckState): LatestRelease | null {
  return check.phase === 'checked' && check.updateAvailable ? check.latest : null;
}

let checkInFlight: Promise<void> | null = null;
let downloadAbort: AbortController | null = null;

async function rememberCheckedAt(checkedAt: number): Promise<void> {
  await AsyncStorage.setItem(LAST_CHECKED_STORAGE_KEY, String(checkedAt));
}

export const useAndroidSelfUpdateStore = create<AndroidSelfUpdateState>()((set, get) => ({
  check: { phase: 'idle' },
  download: { phase: 'idle' },

  checkForUpdates: () => {
    if (checkInFlight !== null) return checkInFlight;
    checkInFlight = (async () => {
      set({ check: { phase: 'checking' } });
      const checkedAt = Date.now();
      try {
        const latest = await fetchLatestRelease();
        const updateAvailable = isNewerVersion(latest.version, installedAppVersion());
        set({ check: { phase: 'checked', latest, updateAvailable, checkedAt } });
        // A previously downloaded copy of this same release is still
        // installable, so offer Install directly instead of a second 190 MB
        // download.
        const { download } = get();
        if (updateAvailable && download.phase !== 'downloading' && hasDownloadedApk(latest.apkSize)) {
          set({
            download: { phase: 'ready', version: latest.version, fileUri: updateApkFile().uri, installError: null },
          });
        } else if (!updateAvailable && download.phase !== 'downloading') {
          set({ download: { phase: 'idle' } });
        }
      } catch (error) {
        set({ check: { phase: 'error', message: errorMessage(error), checkedAt } });
      } finally {
        checkInFlight = null;
      }
      await rememberCheckedAt(checkedAt);
    })();
    return checkInFlight;
  },

  downloadUpdate: async () => {
    const latest = availableUpdate(get().check);
    if (latest === null) {
      throw new Error('No update is available to download.');
    }
    if (get().download.phase === 'downloading') return;
    downloadAbort?.abort();
    const abort = new AbortController();
    downloadAbort = abort;
    set({ download: { phase: 'downloading', version: latest.version, bytesWritten: 0, totalBytes: latest.apkSize } });
    try {
      const file = await downloadUpdateApk(
        latest.apkUrl,
        latest.apkSize,
        ({ bytesWritten, totalBytes }) => {
          if (abort.signal.aborted) return;
          set({ download: { phase: 'downloading', version: latest.version, bytesWritten, totalBytes } });
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      set({ download: { phase: 'ready', version: latest.version, fileUri: file.uri, installError: null } });
    } catch (error) {
      if (abort.signal.aborted) return;
      set({ download: { phase: 'error', version: latest.version, message: errorMessage(error) } });
    } finally {
      if (downloadAbort === abort) downloadAbort = null;
    }
  },

  cancelDownload: () => {
    downloadAbort?.abort();
    downloadAbort = null;
    set({ download: { phase: 'idle' } });
  },

  installUpdate: async () => {
    const { download } = get();
    if (download.phase !== 'ready') {
      throw new Error('The update has not finished downloading.');
    }
    try {
      await launchApkInstaller(new File(download.fileUri));
    } catch (error) {
      set({ download: { ...download, installError: errorMessage(error) } });
    }
  },
}));

async function checkIfDue(): Promise<void> {
  const raw = await AsyncStorage.getItem(LAST_CHECKED_STORAGE_KEY);
  const lastCheckedAt = raw === null ? null : Number(raw);
  const due =
    lastCheckedAt === null || Number.isNaN(lastCheckedAt) || Date.now() - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
  if (!due) return;
  await useAndroidSelfUpdateStore.getState().checkForUpdates();
}

let installed = false;

/** Start the throttled automatic checks. No-op when the feature flag is off. */
export function initAndroidSelfUpdate(): void {
  if (!ANDROID_SELF_UPDATE_ENABLED || installed) return;
  installed = true;
  void checkIfDue();
  AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active') void checkIfDue();
  });
}
