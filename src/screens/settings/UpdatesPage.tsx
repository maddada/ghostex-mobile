/**
 * Settings > Updates: what runs now and what is waiting, each said once.
 *
 * App: the installed app's version and build, where it came from (GitHub, Google Play, TestFlight,
 * App Store) and, when there is one, the newer app with the right action for that install
 * (Download and install for the GitHub APK, the store page for the others).
 * Over-the-air update: the JavaScript running now (the app's own, "Built in", or an update with its
 * date in the phone's time zone, its short id, the main and phone commits and its what's new, when
 * the update carries them), then a newer update downloading or ready with Restart to update.
 * Check for updates asks the update server and the app's source at once and says what it found.
 * A build without the update server (development) shows only the app.
 *
 * CDXC:Updates 2026-11-12 DECISION: the user, on the GitHub APK 11.4.0 with two updates applied:
 * "I can't see the actual OTA update version here. I see the same version three times. This is
 * useless." The page names the running update (date, id, commits, what's new) instead of repeating
 * the app version, and offers the action that fits where the app came from.
 * SEE-ALSO: src/updates/updateNotice.ts (the Sessions screen's Update button),
 * tooling/release-mobile/ota-publish.mjs (what an update carries in `extra.ghostex`).
 */

import * as Application from 'expo-application';
import { useUpdates } from 'expo-updates';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SetupButton } from '../../components/onboarding/SetupPrimitives';
import { SetupPalette } from '../../theme/palette';
import { readableSecondaryText } from '../../theme/sidebarAppearance';
import { useAppearance } from '../../theme/useAppearance';
import { formatByteSize, installedAppVersion } from '../../updates/androidSelfUpdate';
import {
  availableUpdate,
  checksForNewApp,
  useAppUpdateStore,
  type CheckForUpdatesResult,
  type UpdateDownloadState,
} from '../../updates/appUpdateStore';
import { InstallSourceCopy, StoreButtonCopy } from '../../updates/installSource';
import {
  OTA_ENABLED,
  restartToApplyUpdate,
  useDownloadedUpdate,
  useRunningUpdate,
  type UpdateDetails,
} from '../../updates/overTheAir';
import { SettingsSection } from './SectionBoundary';
import { SectionHeader, SettingsScreenLayout, useSettingsStyles } from './SettingsControls';

const UpdatesCopy = {
  appHeader: 'App',
  versionLabel: 'Version',
  sourceLabel: 'Installed from',
  updateHeader: 'Over-the-air update',
  runningLabel: 'Running',
  builtIn: 'Built in',
  builtInHint: 'The code inside the app. An update replaces it on the next start.',
  update: (at: Date | null) => (at === null ? 'An update' : `Update of ${formatDateTime(at)}`),
  idLabel: 'Update id',
  commitsLabel: 'Built from',
  whatsNew: "What's new",
  noServer: 'This build has no update server: it runs the code it was built with.',
  downloading: (percent: number | null) =>
    percent === null ? 'Downloading a newer update…' : `Downloading a newer update… ${percent}%`,
  ready: (details: UpdateDetails) => `${UpdatesCopy.update(details.createdAt)} is ready.`,
  restartButton: 'Restart to update',
  updateError: (message: string | null) =>
    message === null ? 'The last update check failed.' : `The last update check failed: ${message}`,
  newApp: (version: string) => `Ghostex ${version} needs a new app: its changes cannot arrive over the air.`,
  downloadButton: (version: string, size: number) => `Download and install Ghostex ${version} (${formatByteSize(size)})`,
  downloadingApp: (percent: number) => `Downloading… ${percent}%`,
  cancelButton: 'Cancel download',
  installButton: (version: string) => `Install Ghostex ${version}`,
  installHint: 'Android asks once to allow installs from Ghostex, then shows the installer.',
  checkButton: 'Check for updates',
  checking: 'Checking the update server and for a newer app…',
} as const;

function formatDateTime(at: Date): string {
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const date = at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${date}, ${time}`;
}

function formatRelativeTime(at: number): string {
  const elapsedMinutes = Math.max(0, Math.round((Date.now() - at) / 60_000));
  if (elapsedMinutes < 1) return 'just now';
  if (elapsedMinutes < 60) return `${elapsedMinutes} min ago`;
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} h ago`;
  return new Date(at).toLocaleDateString();
}

/** The text of an error-like value; expo-updates hands errors over as plain `{ message }` objects (or null on iOS). */
function errorText(error: unknown): string | null {
  if (error === null || error === undefined || error === false) return null;
  if (typeof error === 'string') return error.length > 0 ? error : null;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.length > 0 ? message : null;
}

function hasError(error: unknown): boolean {
  return error !== null && error !== undefined && error !== false;
}

/** The one plain line Check for updates leaves. */
function checkSummary(result: CheckForUpdatesResult): { text: string; tone: Tone } {
  const parts: string[] = [];
  let tone: Tone = 'muted';
  const { overTheAir, app } = result;
  if (overTheAir.kind === 'downloaded') {
    parts.push('a newer update is ready');
    tone = 'accent';
  } else if (overTheAir.kind === 'rollback') {
    parts.push('the app goes back to its built-in code at the next start');
  } else if (overTheAir.kind === 'error') {
    parts.push(`could not reach the update server (${overTheAir.message})`);
    tone = 'error';
  } else if (overTheAir.kind === 'none') {
    parts.push('no newer update');
  }
  if (app.kind === 'newApp') {
    parts.push(`Ghostex ${app.version} needs a new app`);
    if (tone !== 'error') tone = 'accent';
  } else if (app.kind === 'error') {
    parts.push(`could not look for a newer app (${app.message})`);
    tone = 'error';
  } else if (app.kind === 'none') {
    parts.push('no newer app');
  }
  const checked = `Checked ${formatRelativeTime(result.at)}`;
  if (parts.length === 0) return { text: `${checked}.`, tone };
  const allClear = tone === 'muted' && parts.every((part) => part.startsWith('no newer'));
  if (allClear) return { text: `${checked}: you have the newest update and app.`, tone };
  return { text: `${checked}: ${parts.join(', and ')}.`, tone };
}

type Tone = 'muted' | 'accent' | 'error';

function StatusText({ text, tone }: { text: string; tone: Tone }) {
  const appearance = useAppearance();
  const color =
    tone === 'muted'
      ? appearance.muted
      : readableSecondaryText(tone === 'accent' ? SetupPalette.ACCENT : SetupPalette.ERROR, appearance.foreground, [
          appearance.background,
        ]);
  return <Text style={[styles.status, { color }]}>{text}</Text>;
}

/** One label and value inside a card. */
function Line({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const settings = useSettingsStyles();
  const appearance = useAppearance();
  return (
    <View style={styles.line}>
      <View style={styles.lineRow}>
        <Text style={settings.rowLabel}>{label}</Text>
        <Text selectable style={[settings.value, styles.lineValue]}>
          {value}
        </Text>
      </View>
      {hint !== undefined ? <Text style={[styles.hint, { color: appearance.muted }]}>{hint}</Text> : null}
    </View>
  );
}

function Card({ children }: { children: ReactNode }) {
  const settings = useSettingsStyles();
  return <View style={settings.card}>{children}</View>;
}

function WhatsNew({ lines }: { lines: string[] }) {
  const appearance = useAppearance();
  if (lines.length === 0) return null;
  return (
    <View style={styles.whatsNew}>
      <Text style={[styles.whatsNewTitle, { color: appearance.foreground }]}>{UpdatesCopy.whatsNew}</Text>
      {lines.map((line, index) => (
        <View key={index} style={styles.bulletRow}>
          <Text style={[styles.bullet, { color: appearance.muted }]}>•</Text>
          <Text style={[styles.bulletText, { color: appearance.foreground }]}>{line}</Text>
        </View>
      ))}
    </View>
  );
}

function commitsText(details: UpdateDetails): string | null {
  const parts = [
    details.mainSha === null ? null : `main ${details.mainSha.slice(0, 8)}`,
    details.phoneSha === null ? null : `phone ${details.phoneSha.slice(0, 8)}`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? null : parts.join(' · ');
}

function downloadPercent(download: UpdateDownloadState): number {
  if (download.phase !== 'downloading' || download.totalBytes <= 0) return 0;
  return Math.min(100, Math.floor((download.bytesWritten / download.totalBytes) * 100));
}

/** The newer app and its action, or the reason the last check failed. */
function NewAppActions() {
  const appearance = useAppearance();
  const source = useAppUpdateStore((state) => state.source);
  const check = useAppUpdateStore((state) => state.check);
  const download = useAppUpdateStore((state) => state.download);
  const storeError = useAppUpdateStore((state) => state.storeError);
  const takeNewApp = useAppUpdateStore((state) => state.takeNewApp);
  const cancelDownload = useAppUpdateStore((state) => state.cancelDownload);
  const installUpdate = useAppUpdateStore((state) => state.installUpdate);
  const newApp = availableUpdate(check);

  if (check.phase === 'error') return <StatusText text={check.message} tone="error" />;
  if (newApp === null) return null;

  if (source !== 'github') {
    const label = source === 'development' ? null : StoreButtonCopy[source];
    return (
      <View style={styles.actions}>
        <StatusText text={UpdatesCopy.newApp(newApp.version)} tone="accent" />
        {label !== null ? (
          <SetupButton variant="primary" label={label} accessibilityLabel={label} onPress={() => void takeNewApp()} />
        ) : null}
        {storeError !== null ? <StatusText text={storeError} tone="error" /> : null}
      </View>
    );
  }

  return (
    <View style={styles.actions}>
      <StatusText text={UpdatesCopy.newApp(newApp.version)} tone="accent" />
      {download.phase === 'ready' ? (
        <SetupButton
          variant="primary"
          label={UpdatesCopy.installButton(download.version)}
          accessibilityLabel={UpdatesCopy.installButton(download.version)}
          onPress={() => void installUpdate()}
        />
      ) : download.phase === 'downloading' ? (
        <>
          <SetupButton
            variant="primary"
            disabled
            label={UpdatesCopy.downloadingApp(downloadPercent(download))}
            onPress={() => undefined}
          />
          <SetupButton label={UpdatesCopy.cancelButton} onPress={cancelDownload} />
        </>
      ) : newApp.apk !== null ? (
        <SetupButton
          variant="primary"
          label={UpdatesCopy.downloadButton(newApp.version, newApp.apk.size)}
          accessibilityLabel={UpdatesCopy.downloadButton(newApp.version, newApp.apk.size)}
          onPress={() => void takeNewApp()}
        />
      ) : null}
      {download.phase === 'error' ? <StatusText text={download.message} tone="error" /> : null}
      {download.phase === 'ready' && download.installError !== null ? (
        <StatusText text={download.installError} tone="error" />
      ) : null}
      <Text style={[styles.status, { color: appearance.muted }]}>{UpdatesCopy.installHint}</Text>
    </View>
  );
}

function AppSection() {
  const source = useAppUpdateStore((state) => state.source);
  const buildNumber = Application.nativeBuildVersion;
  const version = installedAppVersion();
  return (
    <>
      <SectionHeader title={UpdatesCopy.appHeader} />
      <Card>
        <Line label={UpdatesCopy.versionLabel} value={buildNumber === null ? version : `${version} (${buildNumber})`} />
        <Line label={UpdatesCopy.sourceLabel} value={InstallSourceCopy[source]} />
        {checksForNewApp(source) ? <NewAppActions /> : null}
      </Card>
    </>
  );
}

/** The update running now, and a newer one downloading or ready. Reads expo-updates, which can throw. */
function OverTheAirSection() {
  const { isDownloading, downloadProgress, checkError, downloadError } = useUpdates();
  const running = useRunningUpdate();
  const ready = useDownloadedUpdate();
  const installed = Application.nativeApplicationVersion;
  const runningVersion =
    running.details.version !== null && running.details.version !== installed ? ` (Ghostex ${running.details.version})` : '';
  const commits = commitsText(running.details);
  const error = hasError(downloadError) ? downloadError : checkError;
  const percent = typeof downloadProgress === 'number' ? Math.round(downloadProgress * 100) : null;

  return (
    <>
      <SectionHeader title={UpdatesCopy.updateHeader} />
      <Card>
        {running.builtIn ? (
          <Line label={UpdatesCopy.runningLabel} value={UpdatesCopy.builtIn} hint={UpdatesCopy.builtInHint} />
        ) : (
          <>
            <Line
              label={UpdatesCopy.runningLabel}
              value={`${UpdatesCopy.update(running.details.createdAt)}${runningVersion}`}
            />
            {running.details.id !== null ? (
              <Line label={UpdatesCopy.idLabel} value={running.details.id.slice(0, 8)} />
            ) : null}
            {commits !== null ? <Line label={UpdatesCopy.commitsLabel} value={commits} /> : null}
            <WhatsNew lines={running.details.whatsNew} />
          </>
        )}
      </Card>
      {ready !== null ? (
        <Card>
          <StatusText text={UpdatesCopy.ready(ready)} tone="accent" />
          {commitsText(ready) !== null ? <Line label={UpdatesCopy.commitsLabel} value={commitsText(ready) ?? ''} /> : null}
          <WhatsNew lines={ready.whatsNew} />
          <SetupButton
            variant="primary"
            label={UpdatesCopy.restartButton}
            accessibilityLabel={UpdatesCopy.restartButton}
            onPress={() => void restartToApplyUpdate()}
          />
        </Card>
      ) : isDownloading ? (
        <StatusText text={UpdatesCopy.downloading(percent)} tone="muted" />
      ) : hasError(error) ? (
        <StatusText text={UpdatesCopy.updateError(errorText(error))} tone="error" />
      ) : null}
    </>
  );
}

function CheckForUpdates() {
  const running = useAppUpdateStore((state) => state.manualCheck.running);
  const result = useAppUpdateStore((state) => state.manualCheck.result);
  const checkEverything = useAppUpdateStore((state) => state.checkEverything);
  const summary = running ? { text: UpdatesCopy.checking, tone: 'muted' as Tone } : result === null ? null : checkSummary(result);
  return (
    <View style={styles.actions}>
      <SetupButton
        label={UpdatesCopy.checkButton}
        accessibilityLabel={UpdatesCopy.checkButton}
        busy={running}
        onPress={() => void checkEverything()}
      />
      {summary !== null ? <StatusText text={summary.text} tone={summary.tone} /> : null}
    </View>
  );
}

export default function UpdatesPage() {
  const source = useAppUpdateStore((state) => state.source);
  return (
    <SettingsScreenLayout>
      <SettingsSection name="settings:updates:app">
        <AppSection />
      </SettingsSection>

      {OTA_ENABLED ? (
        <SettingsSection name="settings:updates:ota">
          <OverTheAirSection />
        </SettingsSection>
      ) : (
        <StatusText text={UpdatesCopy.noServer} tone="muted" />
      )}

      {OTA_ENABLED || checksForNewApp(source) ? (
        <SettingsSection name="settings:updates:check">
          <CheckForUpdates />
        </SettingsSection>
      ) : null}
    </SettingsScreenLayout>
  );
}

const styles = StyleSheet.create({
  status: {
    fontSize: 12.5,
    lineHeight: 18,
    paddingHorizontal: 4,
  },
  actions: {
    gap: 8,
  },
  line: {
    gap: 2,
  },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  lineValue: {
    flexShrink: 1,
    textAlign: 'right',
  },
  hint: {
    fontSize: 12,
    lineHeight: 17,
  },
  whatsNew: {
    gap: 4,
  },
  whatsNewTitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  bulletRow: {
    flexDirection: 'row',
    gap: 6,
  },
  bullet: {
    fontSize: 13,
    lineHeight: 18,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
});
