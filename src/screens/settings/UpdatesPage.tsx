/**
 * Settings > Updates: the installed version, a "Check for updates" button,
 * and, when GitHub has a newer release, one primary button that walks
 * Download (with percent) → Install (opens the Android package installer).
 * Listed on the Settings home only while ANDROID_SELF_UPDATE_ENABLED is on.
 */

import * as Application from 'expo-application';
import { StyleSheet, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { SetupPalette } from '../../theme/palette';
import { useAppearance } from '../../theme/useAppearance';
import { formatByteSize, installedAppVersion } from '../../updates/androidSelfUpdate';
import {
  availableUpdate,
  useAndroidSelfUpdateStore,
  type UpdateCheckState,
  type UpdateDownloadState,
} from '../../updates/androidSelfUpdateStore';
import { SettingsScreenLayout, ValueRow } from './SettingsControls';

const UpdatesCopy = {
  installedLabel: 'Installed',
  latestLabel: 'Latest release',
  notChecked: 'Ghostex has not checked GitHub for a newer release yet.',
  checking: 'Checking GitHub…',
  upToDate: (checkedAt: number) => `Up to date. Checked ${formatRelativeTime(checkedAt)}.`,
  available: (version: string, size: number) => `Update available: Ghostex ${version} (${formatByteSize(size)}).`,
  checkButton: 'Check for updates',
  downloadButton: (version: string) => `Download Ghostex ${version}`,
  downloading: (percent: number) => `Downloading… ${percent}%`,
  cancelButton: 'Cancel download',
  installButton: (version: string) => `Install Ghostex ${version}`,
  installHint: 'Android will ask you to allow installs from Ghostex once, then shows the installer.',
} as const;

function formatRelativeTime(at: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} h ago`;
  return new Date(at).toLocaleDateString();
}

function checkStatusLine(check: UpdateCheckState): { text: string; tone: 'muted' | 'accent' | 'error' } {
  switch (check.phase) {
    case 'idle':
      return { text: UpdatesCopy.notChecked, tone: 'muted' };
    case 'checking':
      return { text: UpdatesCopy.checking, tone: 'muted' };
    case 'checked':
      return check.updateAvailable
        ? { text: UpdatesCopy.available(check.latest.version, check.latest.apkSize), tone: 'accent' }
        : { text: UpdatesCopy.upToDate(check.checkedAt), tone: 'muted' };
    case 'error':
      return { text: check.message, tone: 'error' };
  }
}

function downloadPercent(download: UpdateDownloadState): number {
  if (download.phase !== 'downloading' || download.totalBytes <= 0) return 0;
  return Math.min(100, Math.floor((download.bytesWritten / download.totalBytes) * 100));
}

export default function UpdatesPage() {
  const appearance = useAppearance();
  const check = useAndroidSelfUpdateStore((state) => state.check);
  const download = useAndroidSelfUpdateStore((state) => state.download);
  const checkForUpdates = useAndroidSelfUpdateStore((state) => state.checkForUpdates);
  const downloadUpdate = useAndroidSelfUpdateStore((state) => state.downloadUpdate);
  const cancelDownload = useAndroidSelfUpdateStore((state) => state.cancelDownload);
  const installUpdate = useAndroidSelfUpdateStore((state) => state.installUpdate);

  const installedVersion = installedAppVersion();
  const buildNumber = Application.nativeBuildVersion;
  const update = availableUpdate(check);
  const status = checkStatusLine(check);
  const mutedText = { color: appearance.muted };
  const secondaryButton = { backgroundColor: appearance.card, borderColor: appearance.border };

  return (
    <SettingsScreenLayout>
      <ValueRow
        label={UpdatesCopy.installedLabel}
        value={buildNumber === null ? installedVersion : `${installedVersion} (${buildNumber})`}
      />
      {check.phase === 'checked' ? <ValueRow label={UpdatesCopy.latestLabel} value={check.latest.version} /> : null}

      <Text
        style={[
          styles.status,
          mutedText,
          status.tone === 'accent' ? styles.statusAccent : null,
          status.tone === 'error' ? styles.statusError : null,
        ]}
      >
        {status.text}
      </Text>

      {update !== null ? (
        <View style={styles.actions}>
          {download.phase === 'ready' ? (
            <SetupButton
              variant='primary'
              label={UpdatesCopy.installButton(download.version)}
              accessibilityLabel={UpdatesCopy.installButton(download.version)}
              onPress={() => void installUpdate()}
            />
          ) : download.phase === 'downloading' ? (
            <>
              <SetupButton
                variant='primary'
                disabled
                label={UpdatesCopy.downloading(downloadPercent(download))}
                onPress={() => undefined}
              />
              <SetupButton label={UpdatesCopy.cancelButton} onPress={cancelDownload} />
            </>
          ) : (
            <SetupButton
              variant='primary'
              label={UpdatesCopy.downloadButton(update.version)}
              accessibilityLabel={UpdatesCopy.downloadButton(update.version)}
              onPress={() => void downloadUpdate()}
            />
          )}
          {download.phase === 'error' ? (
            <Text style={[styles.status, styles.statusError]}>{download.message}</Text>
          ) : null}
          {download.phase === 'ready' && download.installError !== null ? (
            <Text style={[styles.status, styles.statusError]}>{download.installError}</Text>
          ) : null}
          <Text style={[styles.status, mutedText]}>{UpdatesCopy.installHint}</Text>
        </View>
      ) : null}

      <SetupButton
        label={UpdatesCopy.checkButton}
        accessibilityLabel={UpdatesCopy.checkButton}
        busy={check.phase === 'checking'}
        style={secondaryButton}
        onPress={() => void checkForUpdates()}
      />
    </SettingsScreenLayout>
  );
}

const styles = StyleSheet.create({
  status: {
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  statusAccent: {
    color: SetupPalette.ACCENT,
  },
  statusError: {
    color: SetupPalette.ERROR,
  },
  actions: {
    gap: 8,
  },
});
