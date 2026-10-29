/**
 * Where the software keyboard's top edge is in the app's window, from the frame the keyboard events
 * report. iOS reports that frame in its screen's coordinates; the app's window starts at the top of
 * that screen (full screen, or side by side in Split View on the iPhone Duo), so the frame's top is a
 * y in the window. What counts as "off the bottom" is the window's height, not the screen's: on a
 * device with two displays the screen-wide size says nothing about the window the app is shown in.
 */

/** The top edge of a reported keyboard frame, or null for a frame without height (no keyboard). */
export function keyboardFrameTop(screenY: number, height: number): number | null {
  return height > 0 ? screenY : null;
}

/** The keyboard's top edge while it reaches into a window `windowHeight` tall, otherwise null. */
export function keyboardTopInWindow(frameTop: number | null, windowHeight: number): number | null {
  return frameTop !== null && frameTop < windowHeight ? frameTop : null;
}

/** A reported keyboard frame in its screen's points: its top edge, height and width. */
export type KeyboardFrame = { readonly top: number; readonly height: number; readonly width: number };

/** The reported frame, or null for a frame without height (no keyboard). */
export function keyboardFrameOf(screenY: number, height: number, width: number): KeyboardFrame | null {
  return height > 0 ? { top: screenY, height, width } : null;
}

/**
 * The keyboard height a window of `window`'s size learns from `frame` (owner A1, 2026-10-27; review
 * s1-floor-r2 #7): only from a frame reported for that window, docked at its bottom and as wide as it
 * at least. Turning or folding with the keyboard up reports the window's new size and the keyboard's
 * new frame separately, in either order; the frame left from before the change is not this window's,
 * so it teaches nothing, and the new frame does once it comes.
 */
export function keyboardHeightForWindow(
  frame: KeyboardFrame | null,
  window: { readonly width: number; readonly height: number },
): number | null {
  if (frame === null) return null;
  const docked = Math.abs(frame.top + frame.height - window.height) <= 1 && frame.width >= window.width - 1;
  return docked ? frame.height : null;
}
