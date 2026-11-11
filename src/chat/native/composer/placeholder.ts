/**
 * CDXC:SessionChat 2026-11-11 DECISION:
 * User: "Pls shorten the placeholder text on mobile app so it fits in 1 line: 'Hold (up arrow glyph) for options'".
 * The chat core still answers its long touch hint ("Tap ↑ to send or hold it to queue; use / for skills, @ for
 * files and + for agents.", `TOUCH_COMPOSER_PLACEHOLDER` in `gx-chat-core` `composer/policy.rs`), which wrapped to two
 * lines; the phone shows this one instead, over the air, and what that hint explained (the `/` `@` `+` pickers) lives
 * in the menu a hold on Send opens (`sendMenuRows`). The core's other texts (a held input, a pending question, a
 * switching mode) pass through unchanged.
 */
export const HOLD_FOR_OPTIONS_PLACEHOLDER = 'Hold ↑ for options';

const CORE_TOUCH_PLACEHOLDER = 'Tap ↑ to send or hold it to queue; use / for skills, @ for files and + for agents.';

export function phonePlaceholder(fromCore: string): string {
  return fromCore === CORE_TOUCH_PLACEHOLDER ? HOLD_FOR_OPTIONS_PLACEHOLDER : fromCore;
}
