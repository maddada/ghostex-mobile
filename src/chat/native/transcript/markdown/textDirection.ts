/**
 * Whether a paragraph, heading, list item or line of message text starts in a right-to-left language
 * (Arabic, Hebrew, Persian, Urdu, Syriac, Thaana...), which the transcript then right-aligns.
 *
 * CDXC:SessionChat 2026-11-11 DECISION: The phone follows the desktop (commit 5740e6662): a block is
 * right-to-left when its first strong character is, as `dir="auto"` decides on the web (desktop
 * `Paragraph::is_right_to_left` in gpui-component `text/node.rs`: the first character whose bidi class is
 * L settles left-to-right, the first R or AL settles right-to-left; digits, punctuation, spaces and
 * marks are skipped). "Hello مرحبا" stays left, "مرحبا hello" goes right. The chat core has no such
 * check (the desktop's lives in its UI toolkit), so this is the phone's copy of that rule.
 */

/** A letter (bidi class L, R or AL are all letters in the scripts below; digits and marks are not). */
const LETTER = /\p{L}/u;

/**
 * The letters of the right-to-left scripts: Hebrew, Arabic and its supplements, Syriac, Thaana, NKo,
 * Samaritan, Mandaic, the Arabic and Hebrew presentation forms, and the right-to-left scripts of the
 * supplementary planes (Phoenician to Adlam).
 */
const RIGHT_TO_LEFT_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u;

/** Whether `text`'s first strong character is right-to-left. Plain digits, spaces, punctuation and emoji before it do not count. */
export function startsRightToLeft(text: string): boolean {
  for (const character of text) {
    // The right-to-left and left-to-right marks and the Arabic letter mark are strong characters too.
    if (character === '‏' || character === '؜') return true;
    if (character === '‎') return false;
    if (LETTER.test(character)) return RIGHT_TO_LEFT_LETTER.test(character);
  }
  return false;
}

/** What a right-to-left block adds to its text style: against the right edge, reading right to left. */
export const RIGHT_TO_LEFT_TEXT = { textAlign: 'right', writingDirection: 'rtl' } as const;
