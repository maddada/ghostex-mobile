/**
 * Whether a computer has Delayed Send and Close After Done switched on: two Staff pick built-in extensions on its
 * Settings > Extensions (`delayedSendEnabled`, `closeAfterDoneEnabled`, both off by default), which its session summary
 * names in `builtInFeaturesOff` while they are off. While one is off the phone offers no way to start it: no Delayed Send
 * row in a session's menus or the chat's and terminal's More actions, no Close After Done row. A delayed send already
 * scheduled, or a session already set to close, still runs on the computer: its clock and countdown stay on the row and
 * in the chat's pills, and Disable Delayed Send (Postpone By) and an armed Close After Done row stay so it can be stopped.
 *
 * CDXC:DelayedSend 2026-11-28 DECISION:
 * User: "make delayed actions (delayed send and close after done) both staff pick extensions disabled by default for
 * new users pls. disable it even for existing users. when disabled no settings about it and not shown in any menus".
 * Read from `builtInFeaturesOff`, like Session Tags (`sessionTagsSwitch.ts`): a computer built before the switches
 * existed sends no entry, and both keep working there.
 * SEE-ALSO: packages/settings-catalog/src/data/official_extensions.rs (the `delayedSend` and `closeAfterDone` entries).
 */

type SummaryWithFeatures = { builtInFeaturesOff?: readonly string[] } | null | undefined;

/** Delayed Send's built-in feature id, as the computer lists it. */
export const DELAYED_SEND_FEATURE = 'delayedSend';
/** Close After Done's built-in feature id, as the computer lists it. */
export const CLOSE_AFTER_DONE_FEATURE = 'closeAfterDone';

/** Whether Delayed Send is on for a computer whose session summary is `summary` (none yet: on). */
export function delayedSendOnIn(summary: SummaryWithFeatures): boolean {
  return summary?.builtInFeaturesOff?.includes(DELAYED_SEND_FEATURE) !== true;
}

/** Whether Close After Done is on for a computer whose session summary is `summary` (none yet: on). */
export function closeAfterDoneOnIn(summary: SummaryWithFeatures): boolean {
  return summary?.builtInFeaturesOff?.includes(CLOSE_AFTER_DONE_FEATURE) !== true;
}
