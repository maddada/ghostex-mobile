/**
 * Shared styles for the Web preview port picker and preview screens, built from
 * the same design tokens as the rest of the app (GhostexPalette surfaces,
 * GhostexRadii, 1dp strokes).
 */

import { Platform, StyleSheet } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export const MONOSPACE = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Square toolbar button edge, also its minimum touch target. */
export const TOOLBAR_BUTTON_SIZE = 40;

export const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },

  // Port picker -------------------------------------------------------------
  pickerContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  intro: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  sectionTitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
  },
  /** Same leading gap as a standalone section title, with a trailing action. */
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 12,
  },
  sectionHeaderTitle: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  portEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  portInput: {
    flex: 1,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    height: 48,
    fontSize: 15,
    fontFamily: MONOSPACE,
  },
  openButton: {
    height: 48,
    minWidth: 92,
    paddingHorizontal: 18,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  openButtonDisabled: {
    opacity: 0.45,
  },
  openButtonLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '700',
  },
  hint: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },
  pillButton: {
    paddingHorizontal: 14,
    minHeight: 32,
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillButtonLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 12,
    fontWeight: '600',
  },
  listSection: {
    overflow: 'hidden',
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
  },
  portSections: { gap: 12 },
  portSearch: {
    minHeight: 44,
    paddingHorizontal: 12,
    color: GhostexPalette.FOREGROUND,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    fontSize: 14,
  },
  portSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 10,
    minHeight: 56,
  },
  portSectionTitle: { color: GhostexPalette.FOREGROUND, fontSize: 15, fontWeight: '600' },
  portSectionCount: { color: GhostexPalette.MUTED, fontSize: 13 },
  sectionChevron: { color: GhostexPalette.MUTED, fontSize: 16 },
  portPageTitle: { color: GhostexPalette.FOREGROUND, fontSize: 15, fontWeight: '600' },
  portAddress: { color: GhostexPalette.ACCENT, fontSize: 12, fontFamily: MONOSPACE },
  portFavicon: { width: 22, height: 22, resizeMode: 'contain' },
  storybookIcon: { color: '#ff4785', fontSize: 21, fontWeight: '800' },
  portRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 52,
  },
  portRowDivided: {
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: GhostexPalette.BORDER,
  },
  portRowPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  portRowIcon: {
    width: 28,
    height: 28,
    borderRadius: GhostexRadii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  portRowBody: {
    flex: 1,
    gap: 2,
  },
  portRowTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: MONOSPACE,
  },
  portRowDescription: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 16,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  pendingLabel: {
    flex: 1,
    color: GhostexPalette.MUTED,
    fontSize: 12,
  },
  emptyRow: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    paddingVertical: 10,
  },
  errorBanner: {
    borderRadius: GhostexRadii.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.DANGER,
    backgroundColor: 'rgba(232,92,92,0.08)',
    padding: 12,
    gap: 6,
  },
  errorBannerTitle: {
    color: GhostexPalette.DANGER,
    fontSize: 13,
    fontWeight: '700',
  },
  errorBannerBody: {
    color: GhostexPalette.DANGER,
    fontSize: 13,
    lineHeight: 18,
  },
  errorBannerHint: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    lineHeight: 17,
  },

  // Preview -----------------------------------------------------------------
  toolbar: {
    backgroundColor: GhostexPalette.BACKGROUND,
    borderBottomWidth: GhostexStrokeWidth,
    borderBottomColor: GhostexPalette.BORDER,
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 6,
  },
  toolbarButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toolbarNavGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolbarButton: {
    width: TOOLBAR_BUTTON_SIZE,
    height: TOOLBAR_BUTTON_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: GhostexRadii.card,
  },
  toolbarButtonPressed: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  toolbarButtonDisabled: {
    opacity: 0.3,
  },
  addressBar: {
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    paddingHorizontal: 10,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 4,
  },
  addressText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 8,
    color: GhostexPalette.FOREGROUND,
    fontSize: 12,
    fontFamily: MONOSPACE,
  },
  webview: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  stateSurface: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  stateTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  stateBody: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  stateActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  /** Everything below the toolbar: the WebView and anything drawn over it. */
  contentArea: {
    flex: 1,
  },
  /**
   * The failure surface when it covers a WebView that is still mounted: the
   * page keeps its history and its scroll position behind an opaque sheet, so
   * Retry can put the same document back rather than rebuild it.
   */
  failureOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: GhostexPalette.BACKGROUND,
  },
  /** Spinner over the page already on screen while the next forward opens. */
  loadingStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'rgba(24,24,24,0.85)',
  },
});
