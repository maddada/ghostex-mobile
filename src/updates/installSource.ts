/**
 * Where the installed app came from, and where its next version comes from.
 *
 * Android: the GitHub APK is built with the in-app updater on (ANDROID_SELF_UPDATE_ENABLED), the Play
 * build without it, so the flag tells the two apart. iPhone: expo-application's App Store environment
 * (StoreKit's AppTransaction, already inside every 11.x app) says `sandbox` for TestFlight and
 * `production` for the App Store. A build without the update server (a local or development build)
 * says so instead.
 */

import * as Application from 'expo-application';
import { Linking, Platform } from 'react-native';

import { ANDROID_SELF_UPDATE_ENABLED } from '../config/featureFlags';
import { OTA_ENABLED } from './overTheAir';

export type InstallSource = 'github' | 'play' | 'testflight' | 'appStore' | 'iphone' | 'development';

/** The App Store's id of com.maddada.ghostex.ios (apps.apple.com/app/id6771707394). */
const APP_STORE_ID = '6771707394';
const APP_STORE_LOOKUP_URL = 'https://itunes.apple.com/lookup?bundleId=com.maddada.ghostex.ios';
const PLAY_PACKAGE = 'io.ghostex';

export const InstallSourceCopy: Record<InstallSource, string> = {
  github: 'GitHub',
  play: 'Google Play',
  testflight: 'TestFlight',
  appStore: 'App Store',
  iphone: 'App Store or TestFlight',
  development: 'Development build',
};

/** What a newer app's button says, per source. */
export const StoreButtonCopy: Record<Exclude<InstallSource, 'github' | 'development'>, string> = {
  play: 'Open Google Play',
  testflight: 'Open TestFlight',
  appStore: 'Open the App Store',
  iphone: 'Open the App Store',
};

/** The source known without asking the system (Android, and builds without the update server). */
export function installSourceSync(): InstallSource {
  if (Platform.OS === 'android') return ANDROID_SELF_UPDATE_ENABLED ? 'github' : OTA_ENABLED ? 'play' : 'development';
  return OTA_ENABLED ? 'iphone' : 'development';
}

/** The source, asking iOS whether this is TestFlight or the App Store. */
export async function resolveInstallSource(): Promise<InstallSource> {
  const known = installSourceSync();
  if (known !== 'iphone') return known;
  try {
    const environment = await Application.getAppleStoreEnvironmentAsync();
    if (environment === 'sandbox') return 'testflight';
    if (environment === 'production') return 'appStore';
  } catch {
    // No StoreKit answer (offline at first launch, or an older iOS): the page says "App Store or TestFlight".
  }
  return 'iphone';
}

/** The version the App Store offers, or null when it has none. */
export async function fetchAppStoreVersion(): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(APP_STORE_LOOKUP_URL, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(`Could not reach the App Store (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (!response.ok) throw new Error(`The App Store responded with HTTP ${response.status}.`);
  const body = (await response.json()) as { results?: { version?: unknown }[] };
  const version = body.results?.[0]?.version;
  return typeof version === 'string' ? version : null;
}

/** Opens the store page the next app comes from; throws with a readable message when nothing opens. */
export async function openStorePage(source: InstallSource): Promise<void> {
  const [app, web] =
    source === 'play'
      ? [`market://details?id=${PLAY_PACKAGE}`, `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`]
      : source === 'testflight'
        ? [`itms-beta://beta.itunes.apple.com/v1/app/${APP_STORE_ID}`, `https://beta.itunes.apple.com/v1/app/${APP_STORE_ID}`]
        : [`itms-apps://apps.apple.com/app/id${APP_STORE_ID}`, `https://apps.apple.com/app/id${APP_STORE_ID}`];
  try {
    await Linking.openURL(app);
  } catch {
    try {
      await Linking.openURL(web);
    } catch {
      throw new Error(`Could not open ${InstallSourceCopy[source]}. Open it yourself to install the new app.`);
    }
  }
}
