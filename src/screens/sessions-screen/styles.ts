/**
 * SessionsScreen StyleSheet, moved verbatim from src/screens/SessionsScreen.tsx.
 */

import { StyleSheet } from 'react-native';

import { SIDEBAR_BACKGROUND } from '../../components/sessions/rows';
import { GhostexPalette, GhostexRadii } from '../../theme/palette';

/** The header row's height: its title and buttons are 48 pt tall. */
export const SESSIONS_HEADER_HEIGHT = 48;

const BAND_ROW_PADDING = 12;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: SIDEBAR_BACKGROUND,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  /** In the iPhone Duo's status band the row floats there (VerticalBarArea), with the screen's side padding. */
  bandRow: {
    position: 'absolute',
    paddingHorizontal: BAND_ROW_PADDING,
  },
  /** Owns the header row's leading space so the title can be long-pressed. */
  titlePressable: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    justifyContent: 'center',
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 18,
    fontWeight: 'bold',
  },
  /* Option E keeps only the menu up top, a ghost button with no fill (top-bar-buttons.html `.tb-ghost`). */
  headerButton: {
    width: 44,
    height: 48,
    marginRight: -6,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bottomItemPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  bottomIconColor: {
    color: '#C8CDD5',
  },
  bottomLabel: {
    color: '#9BA1A9',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  tailscaleWarning: {
    minHeight: 54,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: GhostexRadii.card,
    borderWidth: 1,
    borderColor: 'rgba(255,180,84,0.35)',
    backgroundColor: 'rgba(255,180,84,0.10)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tailscaleWarningCopy: {
    flex: 1,
    minWidth: 0,
  },
  tailscaleWarningTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600',
  },
  tailscaleWarningBody: {
    color: GhostexPalette.MUTED,
    fontSize: 11,
    lineHeight: 15,
  },
  statusPressable: {
    flex: 1,
    minWidth: 0,
    // Keeps the Show logs tap target while the notice says the state and the line is empty.
    minHeight: 16,
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
  /*
   * The list owns every point the header, the machine strip, and the Space row
   * do not. A ScrollView (which a FlatList is) ships
   * `flexGrow: 1, flexShrink: 1` with a content-sized basis, so without an
   * explicit `flex: 1` a long session list overflows the column and Yoga takes
   * the difference back out of its shrinkable siblings — which is what used to
   * squeeze the Space row flat.
   */
  /** The list and the machine notice floating over its top. */
  /* The list reaches 6pt closer to the screen's edges than the rest of the body (sessions-like-sidebar.html `.sb-list`). */
  listArea: {
    flex: 1,
    marginTop: 12,
    marginHorizontal: -6,
  },
  list: {
    flex: 1,
  },
  /** The workspace tile, then the Space row; fixed height so the list cannot squeeze it. */
  workspaceRow: {
    marginTop: 6,
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  /**
   * The Space row beside the tile takes the rest of the line; the row above owns the top margin.
   * SpaceTabs' own box sets `flexGrow: 0, flexShrink: 0`, and Yoga lets an explicit flexGrow win
   * over the `flex` shorthand while `flex: 1` still zeroes the basis, so a bare `flex: 1` here left
   * the chips a 0-wide box. The grow, shrink and basis are therefore all spelled out.
   */
  workspaceRowSpaces: {
    marginTop: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
  },
  listContent: {
    paddingBottom: 24,
  },
  longPressHint: {
    color: GhostexPalette.MUTED,
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
    marginTop: 14,
    paddingHorizontal: 12,
    opacity: 0.72,
  },
  tailscaleIndicator: {
    minHeight: 28,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  tailscaleIndicatorLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
  },
});
