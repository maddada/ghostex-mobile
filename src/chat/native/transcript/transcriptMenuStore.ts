/**
 * Which transcript menu is open: the request a long press made (`openTranscriptMenu`), which
 * `TranscriptMenuSheet` turns into the core's rows. Kept apart from the sheet so a row can open the
 * menu without importing the menu's drawing.
 */

import { create } from 'zustand';

import type { MentionTarget } from './mentionedSession';

/**
 * A message's own action, offered under the core's Copy and Add to Chat rows (Edit, Back to
 * composer, Rewind, Save prompt, Save to md...). `icon` is a glyph name `MenuSheet` can draw.
 */
export type MessageMenuAction = { label: string; icon: string; run: () => void };

/**
 * `selection` is what the menu's Copy and Add to Chat take (a message's whole text); `selectedWords`
 * are the words the reader had selected when they opened it from the selection bar's More.
 */
export type MenuRequest = {
  href: string | null;
  selection: string;
  actions: MessageMenuAction[];
  selectedWords: string | null;
  /** A session pill was held: its card tops the menu (`MentionCard.tsx`). */
  mention: MentionTarget | null;
};

export const useTranscriptMenuStore = create<{
  request: MenuRequest | null;
  /** Add to Chat for a selection, from the menu sheet on screen: it holds the chat the quote goes into. */
  quote: ((selection: string) => void) | null;
}>(() => ({ request: null, quote: null }));

/**
 * A long press on a message (`selection` is its text, `actions` its own buttons, `selectedWords` the
 * words selected when it came from the selection bar's More), on a link (`href`, no selection), or on
 * a session pill (`mention`, with its link's `href` when it has one).
 */
export function openTranscriptMenu(request: {
  href?: string;
  selection?: string;
  actions?: MessageMenuAction[];
  selectedWords?: string;
  mention?: MentionTarget;
}): void {
  const href = request.href !== undefined && request.href.length > 0 ? request.href : null;
  const selection = (request.selection ?? '').trim();
  const mention = request.mention ?? null;
  if (href === null && selection.length === 0 && mention === null) return;
  const words = (request.selectedWords ?? '').trim();
  useTranscriptMenuStore.setState({
    request: {
      href,
      selection,
      actions: request.actions ?? [],
      selectedWords: words.length > 0 ? words : null,
      mention,
    },
  });
}

/**
 * What the menu's Reply quotes: the words selected before More, or the whole message when nothing
 * was selected (a hold beside the words).
 *
 * CDXC:SessionChat 2026-11-02 DECISION:
 * User, on Android: "I selected some text, then clicked on reply, and then typed my reply and pressed send. It literally quoted the whole message instead of just quoting the part I selected when I hit reply. Please fix this." Reply quotes the selection, as it does on the desktop; the menu's Copy and Add to Chat keep the whole message (More > Copy is how a whole message is copied, CDXC:SessionChat 2026-10-21 in `MessageActions.tsx`). The selection bar's More hands the selected words over (`GhostexSelectionMenuView.kt` / `.swift`).
 */
export function replySelection(request: Pick<MenuRequest, 'selection' | 'selectedWords'>): string {
  return request.selectedWords ?? request.selection;
}

/** The selection bar's Add to Chat (`messageSelection.tsx`): the selected words, as the menu's row adds them. */
export function addSelectionToChat(selection: string): void {
  if (selection.trim().length > 0) useTranscriptMenuStore.getState().quote?.(selection);
}

export function closeTranscriptMenu(): void {
  useTranscriptMenuStore.setState({ request: null });
}
