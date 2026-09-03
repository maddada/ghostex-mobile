/**
 * Android self-update: APK download and installer hand-off.
 *
 * The APK downloads into the app's cache directory with expo-file-system's
 * `File.downloadFileAsync`, then the system package installer is opened with
 * an ACTION_VIEW intent on the FileProvider `content://` URI expo-file-system
 * exposes for that file. Android 8+ additionally needs the
 * REQUEST_INSTALL_PACKAGES permission (declared by app.config.js while the
 * self-update flag is on); the first time, the installer itself shows the
 * "allow installs from this source" screen, so no runtime permission prompt
 * is needed here.
 */

import { File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';

import { APK_ASSET_NAME } from './androidSelfUpdate';

const APK_MIME_TYPE = 'application/vnd.android.package-archive';
/** `Intent.FLAG_GRANT_READ_URI_PERMISSION`: lets the installer read the content URI. */
const FLAG_GRANT_READ_URI_PERMISSION = 0x00000001;

export type ApkDownloadProgress = { bytesWritten: number; totalBytes: number };

/** Where the downloaded update lives: `<cache>/ghostex-android.apk`. */
export function updateApkFile(): File {
  return new File(Paths.cache, APK_ASSET_NAME);
}

/** True when a complete APK of the expected size is already in the cache. */
export function hasDownloadedApk(expectedSize: number): boolean {
  const file = updateApkFile();
  return file.exists && file.size === expectedSize;
}

export async function downloadUpdateApk(
  url: string,
  expectedSize: number,
  onProgress: (progress: ApkDownloadProgress) => void,
  signal: AbortSignal,
): Promise<File> {
  const destination = updateApkFile();
  if (destination.exists) destination.delete();
  const file = await File.downloadFileAsync(url, destination, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // GitHub's CDN sends Content-Length, but the release asset size is the
      // authoritative total either way.
      onProgress({ bytesWritten, totalBytes: totalBytes > 0 ? totalBytes : expectedSize });
    },
  });
  if (file.size !== expectedSize) {
    const actual = file.size;
    file.delete();
    throw new Error(`The download was incomplete (${actual} of ${expectedSize} bytes). Try again.`);
  }
  return file;
}

/** Open the system package installer for the downloaded APK. */
export async function launchApkInstaller(file: File): Promise<void> {
  if (!file.exists) {
    throw new Error('The downloaded update is no longer in the cache. Download it again.');
  }
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: file.contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}
