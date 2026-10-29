/**
 * Whether a computer has Session notes switched on: the built-in extension on its Settings >
 * Extensions (`sessionNotesHidden`, off by default), which its session summary names in
 * `builtInFeaturesOff` while it is off. While it is off the phone shows no note dot on a session's
 * row, no Note in its long-press menu, no Session Note in the terminal's menu and no Session note
 * in the chat's More actions; the notes stay saved on the computer and come back when it is on.
 *
 * CDXC:SessionNotes 2026-10-30 WHY: read from `builtInFeaturesOff`, not `builtInFeatures`, like the voice agent (`voice/featureSwitch.ts`): a computer built before the switch existed sends neither list entry, and its notes keep working as they always did.
 */

/** Session notes' built-in feature id, as the computer lists it. */
export const SESSION_NOTES_FEATURE = 'sessionNotes';

/** Whether Session notes is on for a computer whose session summary is `summary` (none yet: on). */
export function sessionNotesOnIn(summary: { builtInFeaturesOff?: readonly string[] } | null | undefined): boolean {
  return summary?.builtInFeaturesOff?.includes(SESSION_NOTES_FEATURE) !== true;
}
