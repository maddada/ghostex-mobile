/**
 * SessionsScreen StyleSheet, moved verbatim from src/screens/SessionsScreen.tsx.
 */

import { StyleSheet } from 'react-native';

import { ds, PROJECT_RAIL_WIDTH, SIDEBAR_BACKGROUND } from '../../components/sessions/rows';
import { GhostexPalette, GhostexRadii } from '../../theme/palette';

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
  headerButton: {
    width: 48,
    height: 48,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderRadius: GhostexRadii.card,
    alignItems: 'center',
    justifyContent: 'center',
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
  list: {
    flex: 1,
    marginTop: 12,
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
  /*
   * Desktop project group in branched mode (hierarchy-panels.css
   * .group[data-project-group]): transparent, borderless, and preceded by its
   * branch column instead of being drawn as a card.
   */
  projectCard: {
    flexDirection: 'row',
    /*
     * The branch column stretches to the whole card so its absolutely placed
     * line stays inside its parent's box. A zero-height column would leave the
     * line painting outside its bounds, which Android does not guarantee.
     */
    alignItems: 'stretch',
  },
  projectCardBody: {
    flex: 1,
  },
  projectCardTopLevel: {
    marginLeft: ds(3),
    marginRight: ds(5),
    marginBottom: ds(10),
  },
  projectCardInPanel: {
    marginRight: ds(5),
    marginBottom: ds(5),
  },
  projectCardExpanded: {
    marginBottom: ds(7),
  },
  /** Card session area (.group-sessions): 3dp inner inset. */
  cardSessions: {
    paddingHorizontal: ds(3),
    paddingBottom: ds(3),
  },
  /*
   * Desktop collection in branched mode (section.project-collection): no panel
   * border or fill, a 2dp colored rail down its left edge, and a tinted header
   * chip. `margin: 0 5px 10px 3px` with the rail sitting at the panel's left.
   */
  collectionPanel: {
    position: 'relative',
    marginLeft: ds(3),
    marginRight: ds(5),
    marginBottom: ds(10),
    paddingBottom: ds(5),
  },
  collectionRail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: ds(5),
    width: PROJECT_RAIL_WIDTH,
  },
  collectionHeaderChip: {
    borderRadius: ds(5),
    minHeight: ds(30),
    justifyContent: 'center',
  },
  /** Panel member area (.project-collection-projects): starts at the rail. */
  collectionProjects: {
    paddingLeft: PROJECT_RAIL_WIDTH,
    paddingTop: ds(5),
    paddingBottom: ds(3),
  },
});
