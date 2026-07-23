import { Linking, Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';

const TAILSCALE_URL = 'tailscale://';
const TAILSCALE_DOWNLOAD_URL = 'https://tailscale.com/download';

/**
 * Opens the installed Tailscale app.
 *
 * Android's Tailscale launcher does not register a tailscale:// URL scheme, so
 * the native module launches its package directly. iOS does register the
 * scheme and can use the platform URL launcher.
 */
async function openTailscaleApp(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      return await GhostexNative.openTailscale();
    } catch {
      return false;
    }
  }

  if (Platform.OS === 'ios') {
    try {
      if (!(await Linking.canOpenURL(TAILSCALE_URL))) return false;
      await Linking.openURL(TAILSCALE_URL);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/** Open Tailscale when installed, otherwise open its download page. */
export async function openTailscaleOrDownload(): Promise<void> {
  if (await openTailscaleApp()) return;
  try {
    await Linking.openURL(TAILSCALE_DOWNLOAD_URL);
  } catch {
    // The platform has no handler for either destination.
  }
}
