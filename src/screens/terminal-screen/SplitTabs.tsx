/**
 * The chat's tabs side by side (`tabSplit.ts`): each side's tab bar in the header with the handle between them, the
 * two chats below, each a drop zone for a held tab (`TabDrag.tsx`). The left and right chats meet at the
 * middle of the screen, under the handle, so each bar stands over its own chat.
 *
 * CDXC:Terminal 2026-11-12 DECISION:
 * User: when split, each side has its own tab bar (two separate tab cards), and a handle at the top between the sides
 * merges them back into one bar when tapped, the order kept. The handle is a grip in the header's middle, the sides'
 * meeting line, not a button with a label: it reads as the seam it undoes.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NativeChatScreenProps } from '../../chat/native/NativeChatScreen';
import type { TabSwipe } from '../../chat/native/TabSwipe';
import TerminalTabsBar from '../../components/terminal/TerminalTabsBar';
import { ChatDropZone, type TabDrag } from '../../components/terminal/tabDrag/TabDrag';
import SessionChatSurface from '../../demo/SessionChatSurface';
import { useInventoryStore } from '../../inventory/store';
import type { TerminalTab } from '../../terminal/sessions';
import type { SplitView, TabSide } from '../../terminal/tabSplit';
import { colorWithOpacity } from '../../theme/palette';
import { terminalChrome } from '../../theme/terminalColours';
import { sessionProjectIdFor, sessionRecordFor, tabChatCapable, useMachineTarget } from './session-lookups';

/** The handle's width in the header: the gap between the two bars. */
export const SPLIT_HANDLE_WIDTH = 28;
const HANDLE_GRIP_HEIGHT = 20;

function tabsOf(tabs: readonly TerminalTab[], keys: readonly string[]): TerminalTab[] {
  const byKey = new Map(tabs.map((tab) => [tab.sessionKey, tab]));
  return keys.map((key) => byKey.get(key)).filter((tab): tab is TerminalTab => tab !== undefined);
}

export type SplitTabsHeaderProps = {
  tabs: readonly TerminalTab[];
  view: SplitView;
  headerColor: string;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  /** The handle: one bar again. */
  onMerge: () => void;
  drag: TabDrag | null;
};

/** Each side's tab bar, the handle between them. Each bar marks the tab its side shows. */
export function SplitTabsHeader({ tabs, view, headerColor, onSelect, onClose, onMerge, drag }: SplitTabsHeaderProps) {
  const ink = terminalChrome(headerColor).ink;
  return (
    <>
      <TerminalTabsBar
        headerColor={headerColor}
        tabs={tabsOf(tabs, view.left)}
        selectedSessionKey={view.leftShown}
        onSelect={onSelect}
        onClose={onClose}
        drag={drag}
        dragBar="left"
      />
      <Pressable
        testID="split-handle"
        accessibilityRole="button"
        accessibilityLabel="Show one pane"
        accessibilityHint="Puts every tab back in one bar"
        hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
        onPress={onMerge}
        style={({ pressed }) => [styles.handle, pressed ? { backgroundColor: colorWithOpacity(ink, 10) } : null]}
      >
        <View style={[styles.grip, { backgroundColor: colorWithOpacity(ink, 45) }]} />
      </Pressable>
      <TerminalTabsBar
        headerColor={headerColor}
        tabs={tabsOf(tabs, view.right)}
        selectedSessionKey={view.rightShown}
        onSelect={onSelect}
        onClose={onClose}
        drag={drag}
        dragBar="right"
      />
    </>
  );
}

export type SplitChatPanesProps = {
  tabs: readonly TerminalTab[];
  view: SplitView;
  /** The colour of the line where the two chats meet. */
  dividerColor: string;
  /** A touch in a side's chat makes its tab the selected one (its keyboard, its menus), before the touch is handled. */
  onFocus: (sessionKey: string) => void;
  renderPane: (tab: TerminalTab, side: TabSide) => ReactNode;
  drag: TabDrag | null;
};

/** The two chats, each half the area, meeting under the header's handle. */
export function SplitChatPanes({ tabs, view, dividerColor, onFocus, renderPane, drag }: SplitChatPanesProps) {
  const byKey = new Map(tabs.map((tab) => [tab.sessionKey, tab]));
  const side = (which: TabSide) => {
    const key = which === 'left' ? view.leftShown : view.rightShown;
    const tab = byKey.get(key);
    return (
      <View
        key={which}
        testID={`split-pane-${which}`}
        style={styles.pane}
        // Before the chat sees the touch: a row of its More actions then acts on this side's session.
        onStartShouldSetResponderCapture={() => {
          if (view.focus !== which) onFocus(key);
          return false;
        }}
      >
        <ChatDropZone drag={drag} id={which} />
        {tab === undefined ? null : renderPane(tab, which)}
      </View>
    );
  };
  return (
    <View style={styles.panes}>
      {side('left')}
      <View style={[styles.divider, { backgroundColor: dividerColor }]} />
      {side('right')}
    </View>
  );
}

export type SplitPaneChatProps = {
  tab: TerminalTab;
  focused: boolean;
  /** This side's tabs, for the transcript's sideways swipe between them. */
  sideKeys: readonly string[];
  onSelect: (sessionKey: string) => void;
  hostActions: readonly string[];
  onHostAction: NativeChatScreenProps['onHostAction'];
  /** The screen's Search Conversation and Session Note requests: only the focused side's chat takes them. */
  openSearchRequestId: number;
  openSessionNoteRequestId: number;
  onQueueCountChange?: (count: number) => void;
  onOpenLinks: () => void;
  /** The chat's Terminal View: the terminal needs the whole screen. */
  onSwitchToTerminal: (sessionKey: string) => void;
  /** The text a side shows for a tab with no chat (a shell, a box session). */
  textColor: string;
};

/** Counts the screen's requests (`requestId` bumps) that came while this side was focused. */
function useFocusedRequests(requestId: number, focused: boolean): number {
  const [taken, setTaken] = useState(0);
  const seen = useRef(requestId);
  useEffect(() => {
    if (requestId === seen.current) return;
    seen.current = requestId;
    if (focused && requestId > 0) setTaken((count) => count + 1);
  }, [requestId, focused]);
  return taken;
}

/** One side's chat: the session's own chat view, at the side's size. */
export function SplitPaneChat({
  tab,
  focused,
  sideKeys,
  onSelect,
  hostActions,
  onHostAction,
  openSearchRequestId,
  openSessionNoteRequestId,
  onQueueCountChange,
  onOpenLinks,
  onSwitchToTerminal,
  textColor,
}: SplitPaneChatProps) {
  const summary = useInventoryStore((state) => state.inventoriesByMachineId[tab.machineId]?.summary);
  const capable = tabChatCapable(tab, summary);
  const projectId = sessionProjectIdFor(tab, summary);
  const session = sessionRecordFor(tab, summary);
  const machine = useMachineTarget(capable ? tab.machineId : null);
  const searchRequests = useFocusedRequests(openSearchRequestId, focused);
  const noteRequests = useFocusedRequests(openSessionNoteRequestId, focused);
  // The swipe reads the side's tabs and this side's tab as they are when it starts.
  const swipeFrom = useRef({ keys: sideKeys, key: tab.sessionKey, onSelect });
  swipeFrom.current = { keys: sideKeys, key: tab.sessionKey, onSelect };
  const [tabSwipe] = useState<TabSwipe>(() => ({
    canSwipe: (delta) => {
      const { keys, key } = swipeFrom.current;
      const index = keys.indexOf(key);
      return index >= 0 && keys[index + delta] !== undefined;
    },
    onSwipe: (delta) => {
      const { keys, key, onSelect: select } = swipeFrom.current;
      const next = keys[keys.indexOf(key) + delta];
      if (next !== undefined) select(next);
    },
  }));
  if (machine === null) {
    return (
      <Pressable accessibilityRole="button" style={styles.noChat} onPress={() => onSwitchToTerminal(tab.sessionKey)}>
        <Text style={[styles.noChatText, { color: textColor }]}>
          {`${tab.title} has no chat view here. Tap to show its terminal on the whole screen.`}
        </Text>
      </Pressable>
    );
  }
  return (
    <SessionChatSurface
      key={tab.sessionKey}
      machine={machine}
      projectId={projectId}
      sessionId={tab.ghostexSessionId ?? ''}
      onSwitchToTerminal={() => onSwitchToTerminal(tab.sessionKey)}
      hostActions={hostActions}
      onHostAction={onHostAction}
      visible
      openSearchRequestId={searchRequests}
      openSessionNoteRequestId={noteRequests}
      onQueueCountChange={focused ? onQueueCountChange : undefined}
      tabSwipe={sideKeys.length > 1 ? tabSwipe : null}
      links={{ links: session?.links, onOpen: onOpenLinks }}
      style={styles.chat}
    />
  );
}

const styles = StyleSheet.create({
  handle: {
    width: SPLIT_HANDLE_WIDTH,
    height: 36,
    borderRadius: 10,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grip: {
    width: 4,
    height: HANDLE_GRIP_HEIGHT,
    borderRadius: 2,
  },
  panes: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
  },
  pane: {
    flex: 1,
    overflow: 'hidden',
  },
  divider: {
    width: StyleSheet.hairlineWidth,
  },
  chat: {
    flex: 1,
  },
  noChat: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  noChatText: {
    fontSize: 15,
    textAlign: 'center',
  },
});
