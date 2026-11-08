/**
 * An agent session's terminal in a pane: the native terminal view at the size the pane's body has without the
 * keyboard (its grid stays while the keyboard comes and goes, and while the divider is dragged until it is let go),
 * sliding over what the keyboard rules take from the pane the way the full-screen terminal slides
 * (`terminalSlideOffset`: the bottom row above the cover, the cursor row wins), with the session's connection state
 * over it. The terminal's own gestures (selection, scrolling, pinch) stay inside it: nothing here takes a touch.
 */

import { useEffect, useState } from 'react';
import { Platform, StyleSheet } from 'react-native';

import { GhostexTerminalView } from '../../modules/ghostex-native/src';
import DemoTerminalView from '../demo/DemoTerminalView';
import { isDemoMachineId } from '../demo/identity';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import { terminalSlideOffset } from '../components/terminal/terminalKeyboardSlide';
import { summarizeFailure } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import { sessionProjectIdFor } from '../screens/terminal-screen/session-lookups';
import { useTerminalStore } from '../terminal/sessions';
import { useOpenMachineLink } from '../webPreview/useOpenMachineLink';
import type { PaneSize } from './geometry';

export type SessionPaneProps = {
  sessionKey: string;
  /** The terminal's size: the pane's body without the keyboard. */
  view: PaneSize;
  /** How much of its height the keyboard rules take from the pane. */
  covered: number;
  /** The pane tapped last: its cursor is drawn filled, the other's hollow. */
  active: boolean;
};

export default function SessionPane({ sessionKey, view, covered, active }: SessionPaneProps) {
  const tab = useTerminalStore((state) => state.tabs.find((entry) => entry.sessionKey === sessionKey) ?? null);
  const projectId = useInventoryStore((state) =>
    sessionProjectIdFor(tab, tab === null ? undefined : state.inventoriesByMachineId[tab.machineId]?.summary),
  );
  const openMachineLink = useOpenMachineLink();
  const [caretTop, setCaretTop] = useState<number | null>(null);
  const detached = tab?.state === 'detached';

  // A session last shown in its Chat View has no terminal yet; showing it in a pane attaches it.
  useEffect(() => {
    if (detached) void useTerminalStore.getState().ensureTerminalAttached(sessionKey);
  }, [detached, sessionKey]);

  if (tab === null) return null;
  if (isDemoMachineId(tab.machineId)) {
    return (
      <DemoTerminalView
        sessionId={tab.ghostexSessionId ?? sessionKey}
        // Its typing row stays above the keyboard: it uses the pane's visible height (ghostex-mobile#28 review).
        style={[styles.terminal, { width: view.width, height: Math.max(0, view.height - covered) }]}
      />
    );
  }
  const offset = terminalSlideOffset(caretTop, view.height, covered);
  return (
    <>
      <GhostexTerminalView
        sessionKey={sessionKey}
        style={[styles.terminal, { width: view.width, height: view.height, top: -offset }]}
        onCaretChange={Platform.OS === 'ios' ? ({ nativeEvent }) => setCaretTop(nativeEvent.top) : undefined}
        onOpenUrl={({ nativeEvent }) => openMachineLink(tab.machineId, nativeEvent.url, { projectId })}
        {...(Platform.OS === 'ios' ? { paneFocus: active } : {})}
      />
      <TerminalStateOverlay
        tab={tab}
        errorCaption={tab.error !== undefined ? summarizeFailure(tab.error, true) : null}
        onRetry={() => void useTerminalStore.getState().reopenTab(sessionKey)}
        onReconnect={() => void useTerminalStore.getState().reopenTab(sessionKey)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  terminal: {
    position: 'absolute',
    left: 0,
  },
});
