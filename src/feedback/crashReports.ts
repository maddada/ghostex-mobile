/**
 * The crash reports the phone kept (modules/ghostex-native GhostexCrashReports), read back for the
 * next-launch prompt and Send Bug / Feedback, and the cleaned text a report adds to the issue.
 *
 * CDXC:Feedback 2026-10-21 DECISION:
 * User (Q372): "Yes, add crash reports", "should be able to send it to github issues please after agent cleans up any personal data. same as what we have in the modal for Send Bug/Feedback". A report stays on the phone until the user sends it: the next launch offers it once, Send report opens Send Bug / Feedback with the report attached, and it posts only through that screen's Review step (or the feedback agent, which cleans it again).
 * SEE-ALSO: src/feedback/crashReportScrub.ts, src/app/crashReports.ts, src/screens/FeedbackScreen.tsx.
 */

import GhostexCrashReports from '../../modules/ghostex-native/src/GhostexCrashReports';
import { useMachinesStore } from '../machines/store';
import { FEEDBACK_BODY_MAX_UNITS } from './feedbackDraft';
import { scrubPersonalData } from './crashReportScrub';

export type CrashKind = 'javascript' | 'java' | 'native' | 'anr' | 'nsexception';

export type StoredCrashReport = {
  id: string;
  kind: CrashKind;
  /** Epoch milliseconds of the crash. */
  at: number;
  fatal: boolean;
  platform: 'android' | 'ios';
  appVersion: string;
  appBuild: string;
  os: string;
  device: string;
  route: string;
  thread?: string;
  error: string;
  stack: string;
  log: string;
};

const KIND_LABEL: Record<CrashKind, string> = {
  javascript: 'JavaScript error',
  java: 'Android (Java/Kotlin) exception',
  native: 'Native crash',
  anr: 'App not responding',
  nsexception: 'iOS exception',
};

/** Room the report may take in the issue, leaving the rest of the relay's body limit to the message. */
const REPORT_MAX_UNITS = 13_000;
const LOG_MAX_UNITS = 3_000;

function parse(json: string): StoredCrashReport | null {
  try {
    const value = JSON.parse(json) as Partial<StoredCrashReport>;
    if (typeof value.id !== 'string' || typeof value.at !== 'number') return null;
    return {
      id: value.id,
      kind: (value.kind ?? 'javascript') as CrashKind,
      at: value.at,
      fatal: value.fatal !== false,
      platform: value.platform === 'ios' ? 'ios' : 'android',
      appVersion: String(value.appVersion ?? ''),
      appBuild: String(value.appBuild ?? ''),
      os: String(value.os ?? ''),
      device: String(value.device ?? ''),
      route: String(value.route ?? ''),
      thread: typeof value.thread === 'string' ? value.thread : undefined,
      error: String(value.error ?? ''),
      stack: String(value.stack ?? ''),
      log: String(value.log ?? ''),
    };
  } catch {
    return null;
  }
}

/** Every stored report, newest first. */
export async function listCrashReports(): Promise<StoredCrashReport[]> {
  if (GhostexCrashReports === null) return [];
  const raw = await GhostexCrashReports.listReports();
  return raw
    .map(parse)
    .filter((report): report is StoredCrashReport => report !== null)
    .sort((a, b) => b.at - a.at);
}

export async function deleteCrashReport(id: string): Promise<void> {
  await GhostexCrashReports?.deleteReport(id);
}

export async function deleteAllCrashReports(): Promise<void> {
  for (const report of await listCrashReports()) await deleteCrashReport(report.id);
}

/** "Oct 21, 14:03" for the prompt and the Attach row. */
export function crashTimeLabel(at: number): string {
  const date = new Date(at);
  const month = date.toLocaleString('en-US', { month: 'short' });
  const pad = (value: number) => (value < 10 ? `0${value}` : String(value));
  return `${month} ${date.getDate()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The saved computers' names, addresses and SSH usernames, which a report must never show. */
/** What the phone knows that names its owner or computers: their names, hosts, user names and ids. */
export function privateTerms(): string[] {
  return useMachinesStore
    .getState()
    .machines.flatMap((machine) => [
      machine.name,
      machine.host,
      machine.username,
      machine.computerName ?? '',
      machine.deviceId ?? '',
    ]);
}

function cut(text: string, maxUnits: number, keep: 'start' | 'end'): string {
  if (text.length <= maxUnits) return text;
  return keep === 'start' ? `${text.slice(0, maxUnits)}\n… (cut)` : `(cut) …\n${text.slice(-maxUnits)}`;
}

/** The report as plain text, with personal data already stripped. */
export function crashReportText(report: StoredCrashReport): string {
  const terms = privateTerms();
  const clean = (text: string) => scrubPersonalData(text, terms);
  const lines = [
    `Crash: ${KIND_LABEL[report.kind] ?? report.kind}${report.fatal ? '' : ' (not fatal)'}`,
    `When: ${new Date(report.at).toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `App: Ghostex ${report.appVersion || 'unknown'}${report.appBuild ? ` (${report.appBuild})` : ''}`,
    `Device: ${[report.os, report.device].filter(Boolean).join(' · ')}`,
  ];
  if (report.route) lines.push(`Screen: ${clean(report.route)}`);
  if (report.thread) lines.push(`Thread: ${clean(report.thread)}`);
  lines.push('', 'Error:', clean(report.error).trim() || '(no message)');
  const log = report.log.trim() ? cut(clean(report.log).trim(), LOG_MAX_UNITS, 'end') : '';
  const head = lines.join('\n');
  const stackRoom = Math.max(1_000, REPORT_MAX_UNITS - head.length - log.length - 100);
  if (report.stack.trim()) lines.push('', 'Stack:', cut(clean(report.stack).trim(), stackRoom, 'start'));
  if (log) lines.push('', 'Recent app log:', log);
  return lines.join('\n');
}

/** The first line of the cleaned error, for the message the feedback screen starts with. */
export function crashSummary(report: StoredCrashReport): string {
  const first = scrubPersonalData(report.error, privateTerms()).split('\n')[0]?.trim() ?? '';
  const short = first.length > 90 ? `${first.slice(0, 89)}…` : first;
  return short ? `Ghostex closed unexpectedly: ${short}` : 'Ghostex closed unexpectedly.';
}

/** The message plus the report, collapsed on GitHub, as the issue's text after the reporter line. */
export function messageWithCrashReport(message: string, reportText: string): string {
  const fence = reportText.includes('```') ? '~~~~' : '```';
  const section = `<details>\n<summary>Crash report</summary>\n\n${fence}text\n${reportText}\n${fence}\n\n</details>`;
  // The relay refuses a longer body (the reporter line takes the rest); a very long message is cut, never the report.
  const room = Math.max(0, FEEDBACK_BODY_MAX_UNITS - 200 - section.length);
  return `${cut(message.trim(), room, 'start')}\n\n${section}`;
}
