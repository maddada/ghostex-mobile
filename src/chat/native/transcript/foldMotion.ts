/**
 * How the transcript's folds move: every fold that opens or shuts through the disclosure store
 * (`state.ts`), a Quiet View line, a tool call card or group, a "Worked for" turn, a thought, an
 * answers card, eases its height over the next layout, as the desktop's folds do
 * (`native_chat/disclosure_motion.rs`) and as the Session details sheet already does
 * (`cards/SessionDetailsSheet.tsx`). LayoutAnimation runs natively, so a long transcript pays
 * nothing per frame in JavaScript. Nothing moves while the system asks for reduced motion.
 *
 * CDXC:SessionChat 2026-11-12 DECISION: User, of an opened Quiet View line and the "2 tool calls"
 * card under it: "make expand / collapse of this and all similar ones animate please".
 */

import { AccessibilityInfo, LayoutAnimation } from 'react-native';

/** The fold's duration, the desktop's `toggleMs` (gx-chat-core `visual/worked-fold-animation.json`). */
export const FOLD_MS = 200;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((value) => {
    reduceMotion = value;
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => {
  reduceMotion = value;
});

/** Eases the layout change a fold's toggle is about to cause. */
export function animateNextFold(): void {
  if (reduceMotion) return;
  LayoutAnimation.configureNext(LayoutAnimation.create(FOLD_MS, 'easeInEaseOut', 'opacity'));
}
