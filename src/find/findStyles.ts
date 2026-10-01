/**
 * Find colors and styles. The page colors come from the current appearance
 * (Settings > Theme) like Settings; the match and star colors are the desktop
 * Find window's, so a highlighted match or a star looks the same everywhere.
 */

import { StyleSheet } from 'react-native';

import { GhostexRadii, GhostexStrokeWidth } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';

/** Warm accent for matched characters, the terminal picker's bold yellow (desktop find_prompts/palette.rs). */
export const FIND_MATCH_COLOR = '#e3b341';
/** A starred prompt (Tailwind amber-400, the desktop Find row's star). */
export const FIND_STAR_COLOR = '#fbbf24';

const stylesByAppearance = new WeakMap<Appearance, ReturnType<typeof createFindStyles>>();

function createFindStyles(appearance: Appearance) {
  return StyleSheet.create({
    page: {
      flex: 1,
      backgroundColor: appearance.background,
    },
    toolbar: {
      paddingHorizontal: 10,
      paddingTop: 8,
      paddingBottom: 6,
      gap: 8,
      borderBottomWidth: GhostexStrokeWidth,
      borderBottomColor: appearance.border,
    },
    field: {
      height: 42,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: GhostexRadii.input,
      backgroundColor: appearance.input,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      color: appearance.foreground,
      fontSize: 15,
    },
    chips: {
      flexDirection: 'row',
      gap: 6,
    },
    chip: {
      height: 32,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.control,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    chipGrow: {
      flex: 1,
      minWidth: 0,
    },
    chipActive: {
      borderColor: appearance.muted,
      backgroundColor: appearance.cardActive,
    },
    chipPressed: {
      backgroundColor: appearance.card,
    },
    chipLabel: {
      flexShrink: 1,
      color: appearance.muted,
      fontSize: 13,
    },
    chipLabelActive: {
      color: appearance.foreground,
    },
    listContent: {
      paddingHorizontal: 6,
      paddingTop: 4,
      paddingBottom: 48,
    },
    dayHeader: {
      color: appearance.muted,
      fontSize: 12,
      fontWeight: '600',
      paddingHorizontal: 10,
      paddingTop: 14,
      paddingBottom: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 4,
      paddingLeft: 10,
      paddingVertical: 8,
      borderRadius: GhostexRadii.row,
    },
    rowPressed: {
      backgroundColor: appearance.cardActive,
    },
    rowBody: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    rowPrompt: {
      color: appearance.foreground,
      fontSize: 15,
      lineHeight: 21,
    },
    match: {
      color: FIND_MATCH_COLOR,
      fontWeight: '700',
    },
    rowMeta: {
      flexDirection: 'row',
      alignItems: 'baseline',
      gap: 8,
    },
    rowAgent: {
      fontSize: 13,
      fontWeight: '600',
    },
    rowDetail: {
      flex: 1,
      minWidth: 0,
      color: appearance.muted,
      fontSize: 13,
    },
    starButton: {
      width: 40,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: {
      color: appearance.muted,
      fontSize: 15,
      textAlign: 'center',
      paddingHorizontal: 24,
      paddingVertical: 28,
    },
    countPill: {
      position: 'absolute',
      right: 12,
      bottom: 10,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: GhostexRadii.pill,
      backgroundColor: appearance.card,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
    },
    countText: {
      color: appearance.muted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    notice: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderTopWidth: GhostexStrokeWidth,
      borderTopColor: appearance.border,
      backgroundColor: appearance.card,
    },
    noticeError: {
      borderTopColor: 'rgba(255,107,107,0.4)',
      backgroundColor: 'rgba(255,107,107,0.1)',
    },
    noticeText: {
      color: appearance.muted,
      fontSize: 12,
    },
    noticeTextError: {
      color: '#ff8f8f',
    },
    noticeDetail: {
      opacity: 0.7,
    },
    skeletonRow: {
      paddingHorizontal: 10,
      paddingVertical: 10,
      gap: 8,
    },
    skeletonBar: {
      height: 12,
      borderRadius: 4,
      backgroundColor: appearance.cardActive,
    },
    sheetTitle: {
      color: appearance.foreground,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 10,
    },
    sheetField: {
      height: 40,
      paddingHorizontal: 12,
      marginBottom: 8,
      borderRadius: GhostexRadii.input,
      backgroundColor: appearance.input,
      borderWidth: GhostexStrokeWidth,
      borderColor: appearance.border,
      color: appearance.foreground,
      fontSize: 15,
    },
    sheetRow: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.row,
    },
    sheetRowText: {
      flex: 1,
      minWidth: 0,
    },
    sheetRowLabel: {
      color: appearance.foreground,
      fontSize: 15,
    },
    sheetRowDetail: {
      color: appearance.muted,
      fontSize: 12,
    },
    sheetCheck: {
      width: 18,
      alignItems: 'center',
    },
    agentDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
  });
}

export type FindStyles = ReturnType<typeof createFindStyles>;

export function useFindStyles(): { appearance: Appearance; styles: FindStyles } {
  const appearance = useAppearance();
  let styles = stylesByAppearance.get(appearance);
  if (styles === undefined) {
    styles = createFindStyles(appearance);
    stylesByAppearance.set(appearance, styles);
  }
  return { appearance, styles };
}
