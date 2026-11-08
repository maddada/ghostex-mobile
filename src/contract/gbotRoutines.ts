/**
 * A GBot's routines as `ghostex gbots routine list --json` answers them (server/src/automations/routines_api.rs
 * `routine_view`): the schedule and the check in words, the next run, and the last run.
 */

export type GbotRoutine = {
  id: string;
  name: string;
  scheduleSentence: string;
  paused: boolean;
  /** "Mon 9 Nov, 09:15"; empty when it never runs again. */
  nextLabel: string;
  /** What the check watches ("new mail in Gmail"); empty without a check. */
  precheckSentence: string;
  /** Why the last check failed; empty when it didn't. */
  checkFailure: string;
  /** Results that need you go to Chief of Staff too. */
  toChief: boolean;
  lastRunStatus: string;
  lastRunSummary: string;
};

type Json = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function record(value: unknown): Json | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null;
}

export function parseGbotRoutines(answer: unknown): GbotRoutine[] | null {
  const list = record(answer)?.routines;
  if (!Array.isArray(list)) return null;
  return list.flatMap((item): GbotRoutine[] => {
    const routine = record(item);
    if (routine === null || text(routine.id).length === 0) return [];
    const check = record(routine.check);
    const lastRun = record(routine.lastRun);
    return [
      {
        id: text(routine.id),
        name: text(routine.name),
        scheduleSentence: text(routine.scheduleSentence),
        paused: routine.paused === true,
        nextLabel: text(routine.nextLabel),
        precheckSentence: text(routine.precheckSentence),
        checkFailure: check?.lastCheckOutcome === 'failed' ? text(check.lastCheckNote) : '',
        toChief: routine.deliver === 'chief',
        lastRunStatus: text(lastRun?.status),
        lastRunSummary: (
          text(lastRun?.summary)
            .split('\n')
            .find((line) => line.trim().length > 0) ?? ''
        ).trim(),
      },
    ];
  });
}

/** A run's status in words (the desktop's Routines tab says the same). */
export function gbotRoutineRunStatus(status: string): string {
  switch (status) {
    case 'findings':
      return 'Found something';
    case 'no_findings':
      return 'Nothing to report';
    case 'needs_attention':
      return 'Needs you';
    case 'failed':
      return 'Failed';
    case 'running':
    case 'queued':
      return 'Running now';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Ran';
  }
}
