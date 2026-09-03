/**
 * Styles shared by the machine form sections (docs/2026-09-03/mobile-setup/
 * mobile-04-tailscale.html, mobile-08-edit-machine.html): `.field` label +
 * input + hint, `.section-label`, and the `.rows-panel` rows under Advanced.
 */

import { StyleSheet } from 'react-native';

import { SETUP_MONOSPACE } from '../../components/onboarding/SetupPrimitives';
import { GhostexRadii, GhostexStrokeWidth, SetupPalette } from '../../theme/palette';

export const formStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: SetupPalette.PAGE,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 24,
    gap: 16,
  },
  stack: {
    gap: 12,
  },
  sectionLabel: {
    color: SetupPalette.DIM,
    fontSize: 11.5,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 4,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: SetupPalette.MUTED,
    fontSize: 13,
  },
  input: {
    height: 44,
    paddingHorizontal: 12,
    borderRadius: GhostexRadii.control,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER_STRONG,
    backgroundColor: SetupPalette.CARD,
    color: SetupPalette.FOREGROUND,
    fontSize: 15,
  },
  inputMono: {
    fontFamily: SETUP_MONOSPACE,
    fontSize: 14,
  },
  inputMultiline: {
    height: 88,
    paddingTop: 12,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: SetupPalette.ERROR_BORDER,
  },
  fieldHint: {
    color: SetupPalette.DIM,
    fontSize: 12,
    lineHeight: 17,
  },
  fieldError: {
    color: SetupPalette.ERROR,
    fontSize: 12,
    lineHeight: 17,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowMain: {
    flex: 1,
    gap: 3,
  },
  rowLabel: {
    color: SetupPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  rowDetail: {
    color: SetupPalette.MUTED,
    fontSize: 12.5,
    lineHeight: 17,
  },
  rowDetailMono: {
    fontFamily: SETUP_MONOSPACE,
  },
  rowValue: {
    color: SetupPalette.MUTED,
    fontSize: 13,
  },
  rowsCard: {
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.CARD,
    paddingHorizontal: 14,
  },
  errorCallout: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.ERROR_BORDER,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
  errorCalloutText: {
    flex: 1,
    color: SetupPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 19,
  },
  okCallout: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: GhostexRadii.section,
    borderWidth: GhostexStrokeWidth,
    borderColor: 'rgba(99,209,122,0.4)',
    backgroundColor: 'rgba(99,209,122,0.08)',
  },
  okCalloutText: {
    color: SetupPalette.FOREGROUND,
    fontSize: 13,
    lineHeight: 19,
  },
  link: {
    color: SetupPalette.ACCENT,
    fontWeight: '600',
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: GhostexStrokeWidth,
    borderTopColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PAGE,
  },
  divider: {
    height: GhostexStrokeWidth,
    backgroundColor: SetupPalette.BORDER,
    marginTop: 12,
  },
  danger: {
    color: SetupPalette.ERROR,
  },
});
