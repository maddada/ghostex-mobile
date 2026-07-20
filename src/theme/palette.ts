/**
 * GhostexPalette design tokens.
 * Source of truth: docs/specs/sessions-drawer.md §0.
 */
export const GhostexPalette = {
  /** Drawer + dialog surface; pill chip fill. */
  BACKGROUND: '#181818',
  /** Primary text, icons. */
  FOREGROUND: '#FAFAFA',
  /** Secondary text, headers, empty rows. */
  MUTED: '#B5B5B5',
  /** 1dp strokes on cards/pills (white 20%). */
  BORDER: 'rgba(255,255,255,0.2)',
  /** Session row bg (inactive). */
  CARD: '#1F1F1F',
  /** Active row fill, state cards, buttons. */
  CARD_ACTIVE: '#262626',
  /** Inputs. */
  INPUT_BACKGROUND: '#0E0E0E',
  /** Accent (BUTTON): active-row stroke, focused dot, primary buttons. */
  ACCENT: '#7DD3FC',
  /** Text color on accent-filled primary buttons. */
  ACCENT_FOREGROUND: '#181818',
  /** Destructive labels. */
  DANGER: '#E85C5C',
  /** Attention + done dot (blue, NOT green). */
  STATUS_ATTENTION: '#95D7F6',
  /** Working dot (amber). */
  STATUS_WORKING: '#F59E0B',
  /** Sleep icon tint. */
  STATUS_SLEEPING: '#6E7684',
  /** Terminal surface background fallback ("Aizen Dark" port later). */
  TERMINAL_BACKGROUND: '#000000',
} as const;

export type GhostexPaletteToken = keyof typeof GhostexPalette;

/** Radii per spec §0: cards/rows/inputs 8dp; pills/chips fully rounded. */
export const GhostexRadii = {
  card: 8,
  row: 8,
  input: 8,
  /** "Fully rounded" pill/chip radius. */
  pill: 999,
} as const;

/** Stroke width for card/pill borders (1dp). */
export const GhostexStrokeWidth = 1;

/**
 * Status dot color per spec §2:
 * working→STATUS_WORKING; attention/done→STATUS_ATTENTION; sleep→STATUS_SLEEPING;
 * else focused→ACCENT; else idle→MUTED.
 */
export function statusDotColor(displayStatus: string, isFocused: boolean): string {
  if (displayStatus === 'working') return GhostexPalette.STATUS_WORKING;
  if (displayStatus === 'attention' || displayStatus === 'done') {
    return GhostexPalette.STATUS_ATTENTION;
  }
  if (displayStatus === 'sleep' || displayStatus === 'sleeping') {
    return GhostexPalette.STATUS_SLEEPING;
  }
  if (isFocused) return GhostexPalette.ACCENT;
  return GhostexPalette.MUTED;
}
