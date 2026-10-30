/**
 * Snooze's choices and when each wakes, as the desktop's session menu offers them
 * (packages/gx-core/src/sidebar_actions/snooze.rs `snooze_wake_ms`, itself a port of this rule):
 * an hour, three hours, tomorrow at 09:00 and next Monday at 09:00, local time.
 */

export type SnoozePreset = 'oneHour' | 'threeHours' | 'tomorrow' | 'nextWeek';

/** In the order the menu offers them, with the desktop's labels. */
export const SNOOZE_PRESETS: ReadonlyArray<{ preset: SnoozePreset; label: string }> = [
  { preset: 'oneHour', label: '1 Hour' },
  { preset: 'threeHours', label: '3 Hours' },
  { preset: 'tomorrow', label: 'Tomorrow' },
  { preset: 'nextWeek', label: 'Next Week' },
];

const HOUR_MS = 60 * 60 * 1000;

/** 09:00 local time `days` days from `now`, with that day's own UTC offset (`setHours`). */
function morning(now: Date, days: number): Date {
  const date = new Date(now.getTime());
  date.setDate(date.getDate() + days);
  date.setHours(9, 0, 0, 0);
  return date;
}

/** When a session snoozed now with `preset` wakes. */
export function snoozeWakeAt(preset: SnoozePreset, now: Date): Date {
  switch (preset) {
    case 'oneHour':
      return new Date(now.getTime() + HOUR_MS);
    case 'threeHours':
      return new Date(now.getTime() + 3 * HOUR_MS);
    case 'tomorrow':
      return morning(now, 1);
    case 'nextWeek':
      // The next Monday, and a full week when today is one.
      return morning(now, (8 - now.getDay()) % 7 || 7);
  }
}
