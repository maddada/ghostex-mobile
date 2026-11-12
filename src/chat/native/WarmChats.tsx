/**
 * The session tabs' chats, kept warm: the selected tab's chat and the chats of the few tabs selected before it stay
 * mounted, so going back to one of them (a tap on its tab, a swipe on the transcript) shows it at once, where it was
 * scrolled, with only the events that came in meanwhile applied.
 *
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User: with several session tabs open, swiping or tapping between them "reloads each chat from scratch every time:
 * blank/loading, re-fetch, re-render, scroll jump"; switching is to be instant, chats kept warm. Before this, the
 * terminal screen keyed its one chat by the selected tab, so every switch unmounted the chat and the last holder of its
 * Rust core disposed it (the core, its live read, its transcript); the next visit started a new core, read the
 * retained transcript, waited for the computer's first answer and drew the list again from its newest rows. Now the
 * last {@link WARM_CHAT_LIMIT} chats by recency stay mounted: the selected one as before, the others parked
 * (`NativeChatScreen`'s `parked`): at full size behind it, drawing nothing and taking no touches, their core told they
 * are hidden (clocks held, the document assembled at most once a second), their loops stopped (`chatShown.ts`), their
 * live read still running. The least recently selected beyond the limit closes, as every chat closed before, which
 * bounds what the warm ones hold; a closed tab's chat closes at once.
 *
 * SEE-ALSO: src/screens/TerminalScreen.tsx (what each chat is given), src/chat/rust/host.ts (`setShown`, one host per
 * chat), src/chat/native/TabSwipe.tsx (a warm chat slides in when it is shown again).
 */

import { useRef, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { MachineConnectionTarget } from '../../machines/credentials';

/** How many chats stay mounted: the selected tab's and the ones selected just before it. */
export const WARM_CHAT_LIMIT = 4;

/** One tab's chat: which chat it is, as the selected tab last gave it. */
export type WarmChatTarget = {
  /** The tab's session key, the chat's identity here. */
  sessionKey: string;
  machine: MachineConnectionTarget;
  projectId: string;
  sessionId: string;
};

type Props = {
  /** The selected tab's chat, or null while it has none (a terminal-only tab, a chat shown in a pane). */
  active: WarmChatTarget | null;
  /** The session keys of the open tabs: a chat whose tab closed goes at once. */
  openKeys: readonly string[];
  /** A chat that must not be mounted here (it is shown in a pane, which holds its own screen of it). */
  excludeKey?: string | null;
  limit?: number;
  /**
   * Draws one chat: `parked` for every chat but the selected one. The element must be the same component for a chat
   * parked or not, so that selecting it again keeps it mounted.
   */
  render: (target: WarmChatTarget, parked: boolean) => ReactNode;
};

type Entry = { target: WarmChatTarget; order: number };

export default function WarmChats({ active, openKeys, excludeKey = null, limit = WARM_CHAT_LIMIT, render }: Props) {
  // Most recently selected first. Worked out during render, so a selected chat is mounted (or shown) in the same
  // commit as the tab change; the same inputs always give the same list.
  const recent = useRef<Entry[]>([]);
  const nextOrder = useRef(0);
  const parkedCache = useRef(new Map<string, ReactElement>());
  const open = new Set(openKeys);
  let entries = recent.current.filter(
    (entry) =>
      open.has(entry.target.sessionKey) &&
      entry.target.sessionKey !== excludeKey &&
      entry.target.sessionKey !== active?.sessionKey,
  );
  if (active !== null && active.sessionKey !== excludeKey) {
    const known = recent.current.find((entry) => entry.target.sessionKey === active.sessionKey);
    entries = [{ target: active, order: known?.order ?? nextOrder.current++ }, ...entries];
  }
  entries = entries.slice(0, Math.max(1, limit));
  recent.current = entries;

  // A parked chat is drawn once when it parks, and the same element is handed back on every later render: React then
  // skips it, so the screen's renders (a few per tab change) redraw only the chat on screen, not every warm one.
  const parkedElements = parkedCache.current;
  for (const key of parkedElements.keys()) {
    if (key === active?.sessionKey || !entries.some((entry) => entry.target.sessionKey === key)) {
      parkedElements.delete(key);
    }
  }
  // In a fixed order (first mounted first), so a switch moves no native view; only the selected one is seen.
  const mounted = [...entries].sort((left, right) => left.order - right.order);
  return (
    <>
      {mounted.map(({ target }) => {
        if (target.sessionKey === active?.sessionKey) {
          return (
            <View key={target.sessionKey} style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {render(target, false)}
            </View>
          );
        }
        let element = parkedElements.get(target.sessionKey);
        if (element === undefined) {
          element = (
            <View key={target.sessionKey} style={styles.parked} pointerEvents="none">
              {render(target, true)}
            </View>
          );
          parkedElements.set(target.sessionKey, element);
        }
        return element;
      })}
    </>
  );
}

const styles = StyleSheet.create({
  parked: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0 },
});
