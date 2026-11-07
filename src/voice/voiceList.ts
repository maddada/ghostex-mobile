/**
 * Where the voice sheet opens: scrolled so the current voice shows with two rows above it.
 *
 * CDXC:VoiceMode 2026-11-08 DECISION: A Discord user: "scroll to the selected voice when opening the list" (Grok lists 28 voices; Ursa is 26th). The phone's voice sheet opens scrolled to the current voice, as the computer's voice list does (`voice_list_scroll_top` in apps/desktop/src/app/voice_agent/panel_layout.rs, which leaves the same two rows above it).
 */

/** Rows left above the current voice when the sheet opens. */
export const VOICE_SHEET_ROWS_ABOVE = 2;

/**
 * The sheet's scroll offset for the current voice's row at `rowY` (from the top of the sheet's
 * content) with rows `rowHeight` tall. The scroll view clamps an offset past its end.
 */
export function voiceSheetScrollY(rowY: number, rowHeight: number): number {
  return Math.max(0, rowY - VOICE_SHEET_ROWS_ABOVE * rowHeight);
}
