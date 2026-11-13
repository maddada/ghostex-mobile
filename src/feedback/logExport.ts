/**
 * Logs › Export (and the Connections sheet's Send logs): the phone's event log as a text file through the share sheet
 * (AirDrop, Files, Mail), with the same personal details replaced as Send to developer (`logReport.ts`). It needs no
 * new native code: the file goes through `GhostexNative.shareFile`, which the iPhone app has had since 11.2.1;
 * Android, which has no file share sheet, shares the text itself. Nothing here goes to GitHub: Send to developer is
 * the only path that files an issue.
 *
 * CDXC:RemoteMachines 2026-11-13 DECISION: Sebastian asked that Export give a file to save or send, never a GitHub
 * upload, and that the logs explain a drop on their own. So the file opens with what the lines can't say themselves
 * (the app build and over-the-air update it ran, the phone, Tailscale, each computer's route and gxserver version) and
 * ends with what logs can and can't tell. Never tokens, keys, addresses or message text.
 */

import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import * as Updates from 'expo-updates';
import { Platform, Share } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { formatLogDateTime, logEntryText, type AppLogEntry } from '../app/appLog';
import { formatDuration, whereTheAppIs } from '../app/foregroundClock';
import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { isDemoMachine } from '../demo/identity';
import { tailscaleOnPhone } from '../machines/easyConnectRoute';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import { connectionTrace, routeLabel } from '../remote/connectionTrace';
import { privateTerms } from './crashReports';
import { scrubPersonalData } from './crashReportScrub';

const EXPORT_FOLDER = 'logs-export';

/** "Ghostex 11.6.0 (110600), update 1a2b… published 2026-11-13 03:31:00, runtime f6da…, ios 18.6". */
export function appBuildLine(): string {
  const version = Application.nativeApplicationVersion ?? 'unknown';
  const build = Application.nativeBuildVersion;
  return `Ghostex ${version}${build ? ` (${build})` : ''}, ${updateLine()}, ${Platform.OS} ${String(Platform.Version)}`;
}

function updateLine(): string {
  const runtime = Updates.runtimeVersion ?? 'unknown';
  if (!Updates.isEnabled) return `updates off, runtime ${runtime}`;
  if (Updates.isEmbeddedLaunch || Updates.updateId === null) return `the update built into the app, runtime ${runtime}`;
  const created = Updates.createdAt instanceof Date ? formatLogDateTime(Updates.createdAt.getTime()) : 'unknown';
  return `update ${Updates.updateId} published ${created}, runtime ${runtime}`;
}

function transportLabel(machine: MachineRecord): string {
  return machine.transport === 'tailcat' ? 'Easy Connect' : 'SSH';
}

function computerLines(machines: readonly MachineRecord[], now: number): string[] {
  return machines
    .filter((machine) => !isDemoMachine(machine) && !isCloudBoxMachineId(machine.id))
    .map((machine) => {
      const trace = connectionTrace(machine.id);
      const lastConnected =
        trace?.lastConnectedAt != null
          ? formatLogDateTime(trace.lastConnectedAt)
          : machine.lastConnectedAt !== null
            ? formatLogDateTime(Date.parse(machine.lastConnectedAt))
            : 'never';
      const upFor = trace?.connectedAt != null ? `, up for ${formatDuration(now - trace.connectedAt)}` : '';
      return (
        `- ${computerLabel(machine.id)}${machine.disabled === true ? ' (hidden)' : ''}: ${transportLabel(machine)} ` +
        `over ${trace?.route ?? routeLabel(machine)} (address not shown), gxserver ${trace?.gxserverVersion ?? 'unknown'}, ` +
        `last connected ${lastConnected}${upFor}`
      );
    });
}

export type ExportContext = {
  tailscale: boolean | null;
  machines: readonly MachineRecord[];
};

/**
 * A computer's id as the log shows it: "computer 7f3a", the id's first characters. The full id has the shape of a
 * key, which the scrubber replaces, and then lines of two computers could not be told apart.
 */
export function computerLabel(machineId: string): string {
  return `computer ${machineId.slice(0, 4)}`;
}

/** The log text as it may leave the phone or be kept: computer ids shortened, then personal details replaced. */
export function scrubLogText(
  text: string,
  machines: readonly Pick<MachineRecord, 'id'>[] = useMachinesStore.getState().machines,
): string {
  let labelled = text;
  for (const machine of machines) {
    if (machine.id.length > 4) labelled = labelled.split(machine.id).join(computerLabel(machine.id));
  }
  return scrubPersonalData(labelled, privateTerms());
}

/** The lines above the log; the app line goes in after the scrub (an update id has the shape of a key). */
export function exportHeader(context: ExportContext, now = Date.now()): string[] {
  const computers = computerLines(context.machines, now);
  return [
    `Ghostex phone logs, exported ${formatLogDateTime(now)}; personal details replaced.`,
    `Tailscale on this phone: ${context.tailscale === null ? 'unknown' : context.tailscale ? 'on' : 'off'}`,
    `App right now: ${whereTheAppIs(now)}`,
    `Computers (${computers.length}):`,
    ...(computers.length === 0 ? ['- none'] : computers),
    "Channel counts are what this phone admitted, not what the computer counts. Times are the phone's local time.",
  ];
}

/** The closing paragraph: what the log can and can't tell. */
export const EXPORT_LIMITS = [
  'What these logs can tell: when the phone dropped or replaced a connection and why it did, whether the app was in',
  'front and how long it had been away, what the phone had open, whether the computer refused a channel, round trips,',
  'routes and versions, and which update the phone ran.',
  'What they can\'t tell: how many channels the computer itself counts, why OpenSSH refused one (it only says "open',
  'failed"), what Tailscale did inside its tunnel, or a socket iOS froze without telling the app. For those, the',
  "computer's side is the evidence: sample its SSH sessions during a session and line them up with this file by time.",
].join(' ');

/** The exported text: the header, one "YYYY-MM-DD HH:MM:SS message" line per entry, then what logs can't tell. */
export function exportedLogText(entries: readonly AppLogEntry[], context: ExportContext, now = Date.now()): string {
  const lines = entries.map((entry) => `${formatLogDateTime(entry.at)} ${logEntryText(entry)}`);
  const body = scrubLogText(
    [...exportHeader(context, now), '', ...lines, '', EXPORT_LIMITS].join('\n'),
    context.machines,
  );
  const [title, ...rest] = body.split('\n');
  return `${[title, `App: ${appBuildLine()}`, ...rest].join('\n')}\n`;
}

/** Shares the log; settles once the share sheet is closed, shared or not, and throws when it couldn't be shown. */
export async function exportLogs(entries: readonly AppLogEntry[]): Promise<void> {
  const context: ExportContext = {
    tailscale: await tailscaleOnPhone(),
    machines: useMachinesStore.getState().machines,
  };
  const text = exportedLogText(entries, context);
  if (Platform.OS !== 'ios') {
    await Share.share({ message: text });
    return;
  }
  const folder = new Directory(Paths.cache, EXPORT_FOLDER);
  if (folder.exists) folder.delete();
  folder.create({ intermediates: true });
  const stamp = formatLogDateTime(Date.now()).replace(/[: ]/gu, '-');
  const file = new File(folder, `ghostex-phone-logs-${stamp}.txt`);
  file.create();
  file.write(text);
  try {
    await GhostexNative.shareFile(file.uri);
  } finally {
    if (folder.exists) folder.delete();
  }
}
