/**
 * Logs › Export: the phone's event log as a text file through the share sheet (AirDrop, Files, Mail), with the same
 * personal details replaced as Send to developer (`logReport.ts`). It needs no new native code: the file goes through
 * `GhostexNative.shareFile`, which the iPhone app has had since 11.2.1; Android, which has no file share sheet, shares
 * the text itself.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { Platform, Share } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { formatLogDateTime, type AppLogEntry } from '../app/appLog';
import { privateTerms } from './crashReports';
import { scrubPersonalData } from './crashReportScrub';

const EXPORT_FOLDER = 'logs-export';

/** The exported text: a header line, then one "YYYY-MM-DD HH:MM:SS message" line per entry, personal details replaced. */
export function exportedLogText(entries: readonly AppLogEntry[], now = Date.now()): string {
  const lines = entries.map((entry) => `${formatLogDateTime(entry.at)} ${entry.message}`).join('\n');
  const header = `Ghostex phone logs (${Platform.OS} ${String(Platform.Version)}), exported ${formatLogDateTime(now)}; personal details replaced.`;
  return `${header}\n\n${scrubPersonalData(lines, privateTerms())}\n`;
}

/** Shares the log; settles once the share sheet is closed, shared or not. */
export async function exportLogs(entries: readonly AppLogEntry[]): Promise<void> {
  const text = exportedLogText(entries);
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
