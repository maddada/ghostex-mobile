/**
 * The issue Logs › Send to developer files: the phone's event log with personal details replaced, under the sender's
 * note, through the same feedback relay as Send Bug / Feedback (`feedbackRelay.ts`).
 *
 * CDXC:Feedback 2026-11-12 DECISION:
 * User (Q2743): Logs has Copy and Send to developer, which "sends to github issues please", through a review step that
 * says what is in the logs, what is replaced and what is never sent, with a note box and the exact text, before
 * anything leaves the phone. The relay files the issue in the public Ghostex repository, so the review says so.
 */

import { formatAppLog, type AppLogEntry } from '../app/appLog';
import { scrubPersonalData } from './crashReportScrub';
import { privateTerms } from './crashReports';
import { draftTitle, FEEDBACK_BODY_MAX_UNITS, reporterLine } from './feedbackDraft';

/** Where the relay files the issue (anyone can read it). */
export const FEEDBACK_ISSUES_REPOSITORY = 'github.com/maddada/Ghostex';

const DEFAULT_TITLE = 'Phone connection logs';
const LOG_FENCE = '```';

export type LogReport = { title: string; body: string; lineCount: number };

export function logReport(entries: readonly AppLogEntry[], note: string, reporter: string | null): LogReport {
  const terms = privateTerms();
  const cleanNote = scrubPersonalData(note.trim(), terms);
  const head = [
    ...(reporter !== null ? [reporterLine(reporter), ''] : []),
    cleanNote.length > 0 ? cleanNote : 'Connection logs sent from the phone.',
    '',
    'Logs (personal details replaced):',
    `${LOG_FENCE}text`,
  ].join('\n');
  const tail = `\n${LOG_FENCE}`;
  let log = scrubPersonalData(formatAppLog([...entries]), terms);
  // The newest lines matter most: an over-long log loses its oldest ones.
  const room = FEEDBACK_BODY_MAX_UNITS - head.length - tail.length - 2;
  if (log.length > room) log = `(older lines cut)\n${log.slice(log.length - room + 20)}`;
  const title = cleanNote.length > 0 ? `${DEFAULT_TITLE}: ${draftTitle(cleanNote)}` : DEFAULT_TITLE;
  return {
    title: draftTitle(title),
    body: `${head}\n${log}${tail}`,
    lineCount: entries.length,
  };
}
