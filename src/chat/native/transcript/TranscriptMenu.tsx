/**
 * The transcript's menu (desktop `transcript_menu.rs`, React's transcript `ContextMenu`): reference
 * rows for a link, then Copy and Add to Chat. The rows are the core's (`transcriptMenu`, the rules
 * in `packages/gx-chat-core/src/composer/transcript_menu.rs`); this file opens them in a sheet and
 * hands each row's command to the screen, which performs what only it can (`TranscriptMenuHost`).
 *
 * CDXC:SessionChat 2026-10-21 WHY:
 * Desktop opens this menu with a right press and reads the window's text selection. A phone has
 * neither: holding a message opens it with that whole message as the selection, and holding a link
 * opens the link's rows alone, as a right press on a link with nothing selected does on desktop.
 * A hold on a message's words selects them instead and the menu opens from the selection menu's
 * More or from a hold beside the words; the native view gives each hold one owner
 * (`messageSelection.tsx`, `GhostexSelectionMenuView.kt` / `.swift`), which ends the race between
 * a selectable text's own hold and the sheet that kept prose unselectable since 2026-09-25. The
 * selection menu's Add to Chat asks the core for the selection's row
 * (`quote` below), so the quote reads exactly as this menu's Add to Chat. The subagent viewer opens
 * the same menu (user decision 2026-10-12), nested in its own modal.
 *
 * Reply (`replyToSelection`, CDXC:SessionChat 2026-10-29 DECISION on `reply_item` in the core) opens
 * `ReplySheet` once this sheet is gone: iOS cannot present one modal while another slides away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { MenuSheet, type MenuRow } from '../composer/MenuSheet';
import { arr, obj, str } from './json';
import { ReplySheet, type ReplyAction } from './ReplySheet';
import { closeTranscriptMenu, useTranscriptMenuStore } from './transcriptMenuStore';

/** What the screen answers for the menu's rows. */
export type TranscriptMenuHost = {
  /** Whether the phone can perform this command at all; rows it cannot are left out. */
  serves(command: MenuRow): boolean;
  /** Performs a command the core handed back untouched (`copyText`, `host` actions). */
  perform(command: MenuRow): void;
};

/** The composer hides behind a question card, which is when desktop disables Add to Chat. */
function questionActive(document: ChatDocument | null): boolean {
  return document?.questionCard?.visible === true && str(document.prompt, 'kind') === 'question';
}

/**
 * `enabled` is false for the copy the chat screen mounts while the subagent viewer is open: the
 * viewer's modal carries its own copy, since a modal presented from under another one does not show
 * on iOS.
 */
export function TranscriptMenuSheet({
  chat,
  host,
  enabled = true,
}: {
  chat: RustChat;
  host: TranscriptMenuHost;
  enabled?: boolean;
}) {
  const request = useTranscriptMenuStore((state) => state.request);
  const document = chat.state?.document ?? null;
  const active = questionActive(document);
  const { query, queryAsync } = chat;
  const rows = useMemo<MenuRow[] | null>(() => {
    if (request === null || !enabled) return null;
    const answer = arr(
      query('transcriptMenu', [{ href: request.href, selection: request.selection, questionActive: active }]),
    );
    const served = answer
      .map((row) => obj(row))
      .filter((row): row is MenuRow => {
        const command = obj(row?.command);
        const type = str(command, 'type');
        return command !== null && (type === 'appendToDraft' || type === 'replyToSelection' || host.serves(command));
      });
    // The message's own actions follow Copy and Add to Chat: the phone shows none of them until
    // the message is held (desktop shows them on hover).
    const own = request.actions.map((action, index) => ({
      label: action.label,
      iconPath: `titlebar/${action.icon}.svg`,
      command: { type: 'messageAction', index },
    }));
    const all = own.length > 0 ? [...served, ...(served.length > 0 ? [{ separator: true }] : []), ...own] : served;
    return all.length > 0 ? all : null;
  }, [active, enabled, host, query, request]);
  // The menu belongs to the chat on screen; leaving it drops a request still pending.
  useEffect(() => closeTranscriptMenu, []);
  const composerText = chat.state?.composer.text ?? '';
  // The selection bar's Add to Chat (`addSelectionToChat`): the core's Add to Chat row for those words.
  // Awaited: the core answers a moment later.
  const quote = useCallback(
    (selection: string) => {
      void queryAsync('transcriptMenu', [{ href: null, selection, questionActive: active }]).then((answer) => {
        const row = arr(answer)
          .map((entry) => obj(entry))
          .find((entry) => str(obj(entry?.command), 'type') === 'appendToDraft');
        const text = str(obj(row?.command), 'text');
        if (row?.disabled === true || text.length === 0) return;
        chat.dispatch({ type: 'appendToDraft', text, draft: composerText });
      });
    },
    [active, chat, composerText, queryAsync],
  );
  useEffect(() => {
    if (!enabled) return;
    useTranscriptMenuStore.setState({ quote });
    return () => {
      if (useTranscriptMenuStore.getState().quote === quote) useTranscriptMenuStore.setState({ quote: null });
    };
  }, [enabled, quote]);
  // The Reply sheet's quote, and the one waiting for the menu sheet to finish going away (iOS).
  const [replyQuote, setReplyQuote] = useState<string | null>(null);
  const replyAfterDismiss = useRef<string | null>(null);
  const onMenuDismissed = useCallback(() => {
    const quote = replyAfterDismiss.current;
    replyAfterDismiss.current = null;
    if (quote !== null) setReplyQuote(quote);
  }, []);
  // The core composes the chat box (`transcriptReply`); Send reply then sends it as Send does.
  const onReply = useCallback(
    (quote: string, reply: string, action: ReplyAction) => {
      setReplyQuote(null);
      void queryAsync('transcriptReply', [{ draft: composerText, quote, reply }]).then((draft) => {
        if (typeof draft !== 'string' || chat.composer === null) return;
        chat.composer.replace(draft);
        if (action === 'send') chat.composer.submit('send');
      });
    },
    [chat.composer, composerText, queryAsync],
  );
  const onCommand = useCallback(
    (command: MenuRow): boolean => {
      if (str(command, 'type') === 'messageAction') {
        const index = typeof command.index === 'number' ? command.index : -1;
        useTranscriptMenuStore.getState().request?.actions[index]?.run();
        return false;
      }
      if (str(command, 'type') === 'appendToDraft') {
        const text = str(command, 'text');
        if (text.length > 0) chat.dispatch({ type: 'appendToDraft', text, draft: composerText });
        return false;
      }
      if (str(command, 'type') === 'replyToSelection') {
        const quote = str(command, 'quote');
        if (quote.length === 0) return false;
        if (Platform.OS === 'ios') replyAfterDismiss.current = quote;
        else setReplyQuote(quote);
        return false;
      }
      host.perform(command);
      return false;
    },
    [chat, composerText, host],
  );
  return (
    <>
      <MenuSheet rows={rows} onClose={closeTranscriptMenu} onCommand={onCommand} onDismissed={onMenuDismissed} />
      <ReplySheet quote={replyQuote} onClose={() => setReplyQuote(null)} onReply={onReply} />
    </>
  );
}
