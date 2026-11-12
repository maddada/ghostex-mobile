/**
 * CDXC:SessionChat 2026-11-11 DECISION:
 * User: "Pls shorten the placeholder text on mobile app so it fits in 1 line: 'Hold (up arrow glyph) for options'".
 * The chat core still answers its long touch hint ("Tap ↑ to send or hold it to queue; use / for skills, @ for
 * files and + for agents.", `TOUCH_COMPOSER_PLACEHOLDER` in `gx-chat-core` `composer/policy.rs`), which wrapped to two
 * lines; the phone shows this one instead, over the air, and what that hint explained (the `/` `@` `+` pickers) lives
 * in the menu a hold on Send opens (`sendMenuRows`). The core's other texts (a held input, a pending question, a
 * switching mode) pass through unchanged.
 */
/**
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, with layout A of the "Phone chat box: a cleaner bottom bar" page: the placeholder becomes "Hold the send or mic
 * button for more...", on one line (no wrap, truncated if needed; `ComposerInput` draws it cut to one line) and a bit
 * more faded. The mic's hold menu now leads with Talk to the voice agent, so both holds are worth naming; a chat box
 * with no mic names Send alone. Supersedes "Hold ↑ for options" above.
 */
export const HOLD_FOR_MORE_PLACEHOLDER = 'Hold the send or mic button for more...';
const HOLD_SEND_FOR_MORE_PLACEHOLDER = 'Hold the send button for more...';

const CORE_TOUCH_PLACEHOLDER = 'Tap ↑ to send or hold it to queue; use / for skills, @ for files and + for agents.';

/** The phone's placeholder for the core's: the hold hint for its long touch hint, anything else unchanged. */
export function phonePlaceholder(fromCore: string, mic: boolean): string {
  if (fromCore !== CORE_TOUCH_PLACEHOLDER) return fromCore;
  return mic ? HOLD_FOR_MORE_PLACEHOLDER : HOLD_SEND_FOR_MORE_PLACEHOLDER;
}
