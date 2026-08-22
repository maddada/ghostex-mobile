/**
 * TerminalScreen StyleSheet, moved verbatim from src/screens/TerminalScreen.tsx.
 */

import { StyleSheet } from 'react-native';

import { GhostexPalette, SidebarPalette } from '../../theme/palette';
import { HEADER_HEIGHT } from './session-lookups';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  header: {
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
  },
  headerButton: {
    width: 44,
    height: HEADER_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  terminalArea: {
    flex: 1,
  },
  terminal: {
    flex: 1,
  },
  queuedPill: {
    position: 'absolute',
    top: 8,
    // Clear of the 32dp left edge-swipe strip, which sits above this and would
    // otherwise swallow taps on the pill's left edge. Non-overlapping siblings,
    // not a z-order fight.
    left: 40,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: SidebarPalette.DELAYED_SEND_CLOCK,
  },
  queuedPillPressed: {
    opacity: 0.75,
  },
  queuedPillLabel: {
    color: '#1A1A1A',
    fontSize: 12,
    fontWeight: '600',
  },
});
