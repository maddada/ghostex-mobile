/**
 * Build-time feature flags. Each value comes from the `extra` block that
 * app.config.js computes from the environment when the app is built or served
 * by Metro, so a flag flip is a config change plus `expo prebuild`, never a
 * code edit.
 *
 * ANDROID_SELF_UPDATE_ENABLED — the Android in-app updater that checks GitHub
 * Releases and installs the newer APK through the system package installer.
 * Turn it off before a Play Store submission: run every build step with
 * `GHOSTEX_ANDROID_SELF_UPDATE=0`. app.config.js then omits the
 * REQUEST_INSTALL_PACKAGES permission from the generated manifest and this flag
 * becomes false, which removes the update check, the Settings section, the
 * Sessions menu notice, and the installer prompt entirely.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra: Record<string, unknown> = Constants.expoConfig?.extra ?? {};

export const ANDROID_SELF_UPDATE_ENABLED: boolean =
  Platform.OS === 'android' && extra.androidSelfUpdate === true;
