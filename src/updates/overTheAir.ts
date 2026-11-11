/**
 * Over-the-air updates of the app's JavaScript (expo-updates), from Ghostex's own update server.
 *
 * expo-updates checks at every launch and downloads in the background; the update runs from the
 * next launch, or at once when the reader taps Restart (Settings › Updates, or the Update button on
 * the Sessions screen). A phone keeps the app
 * alive for days, so `initOverTheAirUpdates` also checks when the app comes back to the
 * foreground, at most every CHECK_INTERVAL_MS. Release builds turn updates on (app.config.js);
 * development builds and Metro leave `OTA_ENABLED` false and everything here does nothing.
 *
 * An update only reaches a binary with the same runtime version (scripts/ota-runtime-version.js),
 * so new native code still needs a new APK, TestFlight build or store release.
 * SEE-ALSO: app.config.js (CDXC:Release 2026-10-23 DECISION), tooling/release-mobile/ota-server/.
 */

import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useUpdates } from 'expo-updates';
import { AppState, Platform, type AppStateStatus } from 'react-native';

export const OTA_ENABLED = Updates.isEnabled;

const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/** `https://ota.ghostex.dev/v1/manifest/production` → that server's status URL for `runtime`. */
function statusUrl(runtimeVersion: string): string | null {
  const manifestUrl = Constants.expoConfig?.updates?.url;
  const match = manifestUrl === undefined ? null : /^(.*)\/v1\/manifest\/([^/]+)$/u.exec(manifestUrl);
  if (match === null) return null;
  return `${match[1]}/v1/status/${match[2]}/${Platform.OS}/${encodeURIComponent(runtimeVersion)}`;
}

/** The release the running JavaScript came from: an update's, or the binary's own when none applied. */
export function runningAppVersion(): string | null {
  return Constants.expoConfig?.version ?? Application.nativeApplicationVersion;
}

/** The release an update manifest was built from (the app config travels in `extra.expoClient`). */
export function manifestAppVersion(manifest: Partial<Updates.Manifest> | undefined): string | null {
  const extra = (manifest as { extra?: { expoClient?: { version?: unknown } } } | undefined)?.extra;
  const version = extra?.expoClient?.version;
  return typeof version === 'string' ? version : null;
}

let lastCheckAt = Date.now();

/** What one over-the-air check found. */
export type OverTheAirCheckOutcome =
  | { kind: 'off' }
  | { kind: 'none' }
  | { kind: 'downloaded' }
  | { kind: 'rollback' }
  | { kind: 'error'; message: string };

let checkInFlight: Promise<OverTheAirCheckOutcome> | null = null;

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === 'string' ? message : String(error);
}

/** Ask the server for an update and download it when there is one. Errors also land in useUpdates(). */
export function checkForAppUpdate(): Promise<OverTheAirCheckOutcome> {
  if (!OTA_ENABLED) return Promise.resolve({ kind: 'off' });
  if (checkInFlight !== null) return checkInFlight;
  lastCheckAt = Date.now();
  checkInFlight = (async (): Promise<OverTheAirCheckOutcome> => {
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isRollBackToEmbedded) return { kind: 'rollback' };
      if (!result.isAvailable) return { kind: 'none' };
      await Updates.fetchUpdateAsync();
      return { kind: 'downloaded' };
    } catch (error) {
      return { kind: 'error', message: errorText(error) };
    } finally {
      checkInFlight = null;
    }
  })();
  return checkInFlight;
}

/** Run the downloaded update now. */
export function restartToApplyUpdate(): Promise<void> {
  return Updates.reloadAsync();
}

let installed = false;

/** Foreground checks on top of expo-updates' own check at launch. */
export function initOverTheAirUpdates(): void {
  if (!OTA_ENABLED || installed) return;
  installed = true;
  AppState.addEventListener('change', (status: AppStateStatus) => {
    if (status === 'active' && Date.now() - lastCheckAt >= CHECK_INTERVAL_MS) void checkForAppUpdate();
  });
}

/**
 * The release the update server serves this binary over the air (it keeps the newest one per
 * runtime version), or null when it serves none. A newer release at or below it needs no new app:
 * its JavaScript arrives over the air.
 */
export async function overTheAirReleaseVersion(): Promise<string | null> {
  const runtimeVersion = Updates.runtimeVersion;
  if (!OTA_ENABLED || runtimeVersion === null) return null;
  const url = statusUrl(runtimeVersion);
  if (url === null) throw new Error('This build has no update server address.');
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(
      `Could not reach the Ghostex update server (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`The Ghostex update server responded with HTTP ${response.status}.`);
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === 'string' ? body.version : null;
}

/**
 * What an update carries about itself: `extra.ghostex` of the manifest ota-publish.mjs signs
 * (tooling/release-mobile/ota-publish.mjs). `version` and `gitSha` (the main repo commit) are in
 * every update; `mobileSha` (the phone app commit) and `whatsNew` (one short line per phone change
 * since the update before) only in updates published after 2026-11-12.
 */
export type UpdateDetails = {
  id: string | null;
  createdAt: Date | null;
  version: string | null;
  mainSha: string | null;
  phoneSha: string | null;
  whatsNew: string[];
};

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function updateDetails(
  manifest: Partial<Updates.Manifest> | undefined,
  id: string | undefined | null,
  createdAt: Date | undefined | null,
): UpdateDetails {
  const ghostex = (manifest as { extra?: { ghostex?: Record<string, unknown> } } | undefined)?.extra?.ghostex ?? {};
  const whatsNew = Array.isArray(ghostex.whatsNew)
    ? ghostex.whatsNew.filter((line): line is string => typeof line === 'string' && line.length > 0)
    : [];
  return {
    id: id ?? null,
    createdAt: createdAt instanceof Date && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
    version: stringOrNull(ghostex.version) ?? manifestAppVersion(manifest),
    mainSha: stringOrNull(ghostex.gitSha),
    phoneSha: stringOrNull(ghostex.mobileSha),
    whatsNew,
  };
}

/** The JavaScript running now: the app's own (`builtIn`), or a downloaded update and what it carries. */
export function useRunningUpdate(): { builtIn: boolean; details: UpdateDetails } {
  const { currentlyRunning } = useUpdates();
  return {
    builtIn: currentlyRunning.isEmbeddedLaunch,
    details: updateDetails(currentlyRunning.manifest, currentlyRunning.updateId, currentlyRunning.createdAt),
  };
}

/** A downloaded update waiting for a restart, with what it carries, or null. */
export function useDownloadedUpdate(): UpdateDetails | null {
  const { isUpdatePending, downloadedUpdate } = useUpdates();
  if (!isUpdatePending) return null;
  return updateDetails(downloadedUpdate?.manifest, downloadedUpdate?.updateId, downloadedUpdate?.createdAt);
}
