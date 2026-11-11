/**
 * Newer native app state, for every kind of install: the last check, the GitHub APK download in
 * flight, and the automatic-check schedule. A newer app only counts when its JavaScript cannot
 * arrive over the air (new native code); a release the update server already serves this binary
 * needs no install.
 *
 * Where the newest version is read: the GitHub release (GitHub APK, Google Play, TestFlight) or the
 * App Store's lookup (App Store, or an iPhone that cannot tell). What taking it does: the GitHub APK
 * downloads and opens the Android installer; every other install opens its store page.
 *
 * `initAppUpdates` checks at startup and whenever the app returns to the foreground, at most once
 * every UPDATE_CHECK_INTERVAL_MS (the timestamp persists in AsyncStorage so a relaunch does not
 * reset the clock). Check for updates (Settings › Updates) checks the update server and the app at
 * once. A development build without the update server checks nothing on the iPhone; on Android it
 * keeps the GitHub APK check, as before.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';

import { downloadUpdateApk, hasDownloadedApk, launchApkInstaller, updateApkFile } from './androidApkInstall';
import { fetchLatestRelease, installedAppVersion, isNewerVersion, UPDATE_CHECK_INTERVAL_MS } from './androidSelfUpdate';
import {
  fetchAppStoreVersion,
  installSourceSync,
  openStorePage,
  resolveInstallSource,
  type InstallSource,
} from './installSource';
import { checkForAppUpdate, overTheAirReleaseVersion, type OverTheAirCheckOutcome } from './overTheAir';

const LAST_CHECKED_STORAGE_KEY = 'androidSelfUpdate.lastCheckedAt.v1';

/** A newer app to install; `apk` only for the GitHub APK. */
export type NewApp = { version: string; apk: { url: string; size: number } | null };

export type UpdateCheckState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'checked'; newApp: NewApp | null; checkedAt: number }
  | { phase: 'error'; message: string; checkedAt: number };

export type UpdateDownloadState =
  | { phase: 'idle' }
  | { phase: 'downloading'; version: string; bytesWritten: number; totalBytes: number }
  | { phase: 'ready'; version: string; fileUri: string; installError: string | null }
  | { phase: 'error'; version: string; message: string };

/** What Check for updates found on both sides, for its one plain line. */
export type CheckForUpdatesResult = {
  at: number;
  overTheAir: OverTheAirCheckOutcome;
  app: { kind: 'off' } | { kind: 'none' } | { kind: 'newApp'; version: string } | { kind: 'error'; message: string };
};

type AppUpdateState = {
  source: InstallSource;
  check: UpdateCheckState;
  download: UpdateDownloadState;
  /** The last tap on Check for updates, while it runs (`running`) and after. */
  manualCheck: { running: boolean; result: CheckForUpdatesResult | null };
  /** Why the store page did not open. */
  storeError: string | null;
  checkForUpdates: () => Promise<void>;
  checkEverything: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  cancelDownload: () => void;
  installUpdate: () => Promise<void>;
  /** The GitHub APK: download (when needed) and open the installer. Any other install: open its store. */
  takeNewApp: () => Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The newer app from the last successful check, or null. */
export function availableUpdate(check: UpdateCheckState): NewApp | null {
  return check.phase === 'checked' ? check.newApp : null;
}

/** Whether this install looks for a newer app at all. */
export function checksForNewApp(source: InstallSource): boolean {
  return source !== 'development';
}

/** The newest app version where this install's next app comes from, with its APK for the GitHub APK. */
async function newestApp(source: InstallSource): Promise<NewApp | null> {
  if (source === 'appStore' || source === 'iphone') {
    const version = await fetchAppStoreVersion();
    return version === null ? null : { version, apk: null };
  }
  const latest = await fetchLatestRelease();
  if (source === 'github' && latest.apk === null) {
    throw new Error(`Release ${latest.tag} has no Android app to download yet.`);
  }
  return { version: latest.version, apk: source === 'github' ? latest.apk : null };
}

/** The newer app this install should take, or null when there is none or it arrives over the air. */
async function findNewApp(source: InstallSource): Promise<NewApp | null> {
  const newest = await newestApp(source);
  if (newest === null || !isNewerVersion(newest.version, installedAppVersion())) return null;
  const served = await overTheAirReleaseVersion();
  const arrivesOverTheAir = served !== null && !isNewerVersion(newest.version, served);
  return arrivesOverTheAir ? null : newest;
}

let checkInFlight: Promise<void> | null = null;
let downloadAbort: AbortController | null = null;

async function rememberCheckedAt(checkedAt: number): Promise<void> {
  await AsyncStorage.setItem(LAST_CHECKED_STORAGE_KEY, String(checkedAt));
}

export const useAppUpdateStore = create<AppUpdateState>()((set, get) => ({
  source: installSourceSync(),
  check: { phase: 'idle' },
  download: { phase: 'idle' },
  manualCheck: { running: false, result: null },
  storeError: null,

  checkForUpdates: () => {
    if (!checksForNewApp(get().source)) return Promise.resolve();
    if (checkInFlight !== null) return checkInFlight;
    checkInFlight = (async () => {
      set({ check: { phase: 'checking' } });
      const checkedAt = Date.now();
      try {
        const newApp = await findNewApp(get().source);
        set({ check: { phase: 'checked', newApp, checkedAt }, storeError: null });
        // A previously downloaded copy of this same release is still installable, so offer Install
        // directly instead of a second download.
        const { download } = get();
        if (newApp?.apk != null && download.phase !== 'downloading' && hasDownloadedApk(newApp.apk.size)) {
          set({
            download: { phase: 'ready', version: newApp.version, fileUri: updateApkFile().uri, installError: null },
          });
        } else if (newApp === null && download.phase !== 'downloading') {
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

  checkEverything: async () => {
    if (get().manualCheck.running) return;
    set((state) => ({ manualCheck: { running: true, result: state.manualCheck.result } }));
    const [overTheAir] = await Promise.all([checkForAppUpdate(), get().checkForUpdates()]);
    const { check, source } = get();
    const app: CheckForUpdatesResult['app'] = !checksForNewApp(source)
      ? { kind: 'off' }
      : check.phase === 'error'
        ? { kind: 'error', message: check.message }
        : check.phase === 'checked' && check.newApp !== null
          ? { kind: 'newApp', version: check.newApp.version }
          : { kind: 'none' };
    set({ manualCheck: { running: false, result: { at: Date.now(), overTheAir, app } } });
  },

  downloadUpdate: async () => {
    const latest = availableUpdate(get().check);
    const apk = latest?.apk ?? null;
    if (latest === null || apk === null) {
      throw new Error('No update is available to download.');
    }
    if (get().download.phase === 'downloading') return;
    downloadAbort?.abort();
    const abort = new AbortController();
    downloadAbort = abort;
    set({ download: { phase: 'downloading', version: latest.version, bytesWritten: 0, totalBytes: apk.size } });
    try {
      const file = await downloadUpdateApk(
        apk.url,
        apk.size,
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

  takeNewApp: async () => {
    const { source, check } = get();
    if (availableUpdate(check) === null) return;
    if (source !== 'github') {
      try {
        set({ storeError: null });
        await openStorePage(source);
      } catch (error) {
        set({ storeError: errorMessage(error) });
      }
      return;
    }
    if (get().download.phase === 'downloading') return;
    if (get().download.phase !== 'ready') await get().downloadUpdate();
    if (get().download.phase === 'ready') await get().installUpdate();
  },
}));

async function checkIfDue(): Promise<void> {
  const raw = await AsyncStorage.getItem(LAST_CHECKED_STORAGE_KEY);
  const lastCheckedAt = raw === null ? null : Number(raw);
  const due =
    lastCheckedAt === null || Number.isNaN(lastCheckedAt) || Date.now() - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
  if (!due) return;
  await useAppUpdateStore.getState().checkForUpdates();
}

let installed = false;

/** Learn where the app came from, then start the throttled automatic checks for a newer app. */
export function initAppUpdates(): void {
  if (installed) return;
  installed = true;
  void (async () => {
    const source = await resolveInstallSource();
    useAppUpdateStore.setState({ source });
    if (!checksForNewApp(source)) return;
    await checkIfDue();
    AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') void checkIfDue();
    });
  })();
}
