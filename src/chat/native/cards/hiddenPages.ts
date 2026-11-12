/**
 * Ghostex pages put aside on the phone: the page sheet's Hide (`PageSheet.tsx`) closes the sheet the
 * way Close does (the page keeps its draft answers on the computer and its scroll position, as
 * reopening it from its card already does) and leaves the page here, as a pill in the pills bar of
 * the chat whose card opened it (`PillsStrip.tsx`). A tap on the pill opens the page again and takes
 * the pill away; a long press on it closes the page for good. Opening the same page from its card
 * takes the pill away too, as the desktop brings back a hidden page instead of opening it twice.
 *
 * The list lives as long as the app runs, so a hidden page survives switching chats and screens; it
 * is not saved, so an app restart starts with none, as the desktop's hidden page windows end with
 * the app.
 *
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, after the desktop's hidden page moved from the chat's header to the pills bar (apps/desktop/src/app/visual_page_hidden.rs has the words): asked whether the phone should get the same, the answer was yes: the phone's page sheet gets a Hide button next to Close, and a hidden page shows as the desktop's pill (a preset width, its icon, a short title and its answered count "3/16", shrinking to icon and count, then icon and a dot, then into "+N"), first among the pills, in the chat whose card opened it. A tap brings the page back, a long press on the pill closes it for good; Close in the sheet works as before.
 */

import { create } from 'zustand';

import type { MachineConnectionTarget } from '../../../machines/credentials';
import type { ComputerAddress } from '../../../webPreview/machineLinks';
import { chatMachineLink } from '../../rust/machine-link';

/** A hidden page, as its pill shows it. */
export type HiddenPage = {
  pageId: string;
  page: ComputerAddress;
  title: string;
  /** A question on the page has no answer yet, or it waits to be marked seen. */
  questionsLeft: boolean;
  /** How many of its questions are answered and how many it asks, for a page that asks any. */
  counts: { answered: number; total: number } | null;
};

type HiddenPagesStore = {
  /** Each chat's hidden pages, oldest first, keyed by `hiddenPagesChatKey`. */
  byChat: Readonly<Record<string, readonly HiddenPage[]>>;
  put: (chat: string, page: HiddenPage) => void;
  remove: (chat: string, pageId: string) => void;
  update: (chat: string, pageId: string, change: Partial<HiddenPage>) => void;
};

const NONE: readonly HiddenPage[] = [];

export const useHiddenPagesStore = create<HiddenPagesStore>((set) => ({
  byChat: {},
  put: (chat, page) =>
    set((store) => ({
      byChat: {
        ...store.byChat,
        [chat]: [...(store.byChat[chat] ?? NONE).filter((entry) => entry.pageId !== page.pageId), page],
      },
    })),
  remove: (chat, pageId) =>
    set((store) => {
      const pages = store.byChat[chat] ?? NONE;
      if (!pages.some((entry) => entry.pageId === pageId)) return store;
      return { byChat: { ...store.byChat, [chat]: pages.filter((entry) => entry.pageId !== pageId) } };
    }),
  update: (chat, pageId, change) =>
    set((store) => {
      const pages = store.byChat[chat] ?? NONE;
      if (!pages.some((entry) => entry.pageId === pageId)) return store;
      return {
        byChat: {
          ...store.byChat,
          [chat]: pages.map((entry) => (entry.pageId === pageId ? { ...entry, ...change } : entry)),
        },
      };
    }),
}));

/** The key of the chat on `machineId` showing `sessionId`. */
export function hiddenPagesChatKey(machineId: string, sessionId: string): string {
  return `${machineId}\n${sessionId}`;
}

/** The chat's hidden pages, oldest first. */
export function useHiddenPages(chat: string): readonly HiddenPage[] {
  return useHiddenPagesStore((store) => store.byChat[chat] ?? NONE);
}

/** How long after Hide the count is asked for, so it counts the reader's last pick (the desktop waits as long). */
const STATUS_AFTER_MS = 400;
const STATUS_TIMEOUT_MS = 10_000;

/**
 * Asks the page's computer how many of its questions are answered (`readVisualPageSource`'s
 * `questionsAnswered` of `questionsTotal` and `questionsLeft`, from 2026-11-11 on), once, a moment
 * after the page saved its draft, and writes it on the pill. A computer that cannot say leaves the
 * pill without a count.
 */
export function readHiddenPageStatus(chat: string, machine: MachineConnectionTarget, pageId: string): void {
  setTimeout(() => {
    void (async () => {
      const link = chatMachineLink(machine);
      if ((await link.route()) !== 'socket') return;
      const answer = await link.rpc('readVisualPageSource', { pageId }, STATUS_TIMEOUT_MS);
      if (answer.error !== null) return;
      const status = (answer.result ?? {}) as {
        questionsLeft?: unknown;
        questionsAnswered?: unknown;
        questionsTotal?: unknown;
      };
      const total = typeof status.questionsTotal === 'number' ? status.questionsTotal : 0;
      const answered = typeof status.questionsAnswered === 'number' ? Math.min(status.questionsAnswered, total) : 0;
      useHiddenPagesStore.getState().update(chat, pageId, {
        questionsLeft: status.questionsLeft === true,
        counts: total > 0 ? { answered, total } : null,
      });
    })().catch(() => undefined);
  }, STATUS_AFTER_MS);
}

/** "3/16" for a page that asks questions. */
export function hiddenPageCount(page: HiddenPage): string | null {
  return page.counts === null ? null : `${page.counts.answered}/${page.counts.total}`;
}

/** Questions on it still wait: fewer answered than asked, or the computer says so. */
export function hiddenPageWaiting(page: HiddenPage): boolean {
  return page.questionsLeft || (page.counts !== null && page.counts.answered < page.counts.total);
}

/** What the pill is, in the page's own words for its count ("3 of 16 answered"). */
export function hiddenPageDescription(page: HiddenPage): string {
  const title = page.title.trim().length > 0 ? page.title.trim() : 'Ghostex page';
  if (page.counts !== null) return `${title}, ${page.counts.answered} of ${page.counts.total} answered`;
  return page.questionsLeft ? `${title}, waiting for you` : title;
}
