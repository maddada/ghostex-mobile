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
  /** Attention + done dot (blue, NOT green). Matches desktop --attention-dot. */
  STATUS_ATTENTION: '#95D7F6',
  /** Working dot (amber). Matches the desktop session-card working dot. */
  STATUS_WORKING: '#FFB454',
  /** Sleep icon/dot tint. */
  STATUS_SLEEPING: '#6E7684',
  /** Error dot (red). Matches desktop lifecycle-error dot. */
  STATUS_ERROR: '#FF6B6B',
  /** Terminal surface background fallback ("Aizen Dark" port later). */
  TERMINAL_BACKGROUND: '#000000',
} as const;

/**
 * Sessions-list tokens ported from the desktop gpui sidebar CSS
 * (sidebar/styles/theme.css, groups.css, session-cards.css) so the mobile
 * drawer renders the same look as the macOS sidebar.
 */
export const SidebarPalette = {
  /** Session card / row text (--app-foreground). */
  FOREGROUND: '#C8CDD5',
  /** Secondary text (--app-muted). */
  MUTED: '#747B85',
  /** Project group title: mix(--app-foreground 74%, --app-muted 26%). */
  GROUP_TITLE: '#B2B8C0',
  /** Collapsed-header working count pill (#f8ad07). */
  PILL_WORKING: '#F8AD07',
  /** Collapsed-header attention/done count pill. */
  PILL_ATTENTION: '#95D7F6',
  /** Collapsed-header awake terminal/browser count pill. */
  PILL_AWAKE: '#D8D8D8',
  /** Remote sleeping-row dot: mix(--app-muted 86%, --app-foreground 14%). */
  SLEEP_DOT: '#808791',
  /** Sleeping row content opacity (desktop .session[data-sleeping]). */
  SLEEP_OPACITY: 0.52,
  /** Collection header base surface behind the color tint (#141414). */
  COLLECTION_SURFACE: '#141414',
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
 * Session-row status dot color, matching the desktop session-card mapping:
 * working→amber; attention/done→blue; error→red; sleep→grey; idle→no dot
 * (null hides the dot exactly like the desktop's opacity-0 idle state).
 */
export function statusDotColor(displayStatus: string, _isFocused: boolean): string | null {
  if (displayStatus === 'working') return GhostexPalette.STATUS_WORKING;
  if (displayStatus === 'attention' || displayStatus === 'done') {
    return GhostexPalette.STATUS_ATTENTION;
  }
  if (displayStatus === 'error') return GhostexPalette.STATUS_ERROR;
  if (displayStatus === 'sleep' || displayStatus === 'sleeping') {
    return SidebarPalette.SLEEP_DOT;
  }
  return null;
}

/**
 * Blend a collection color over a base surface at the given mix percentage,
 * mirroring the desktop's color-mix(in srgb, color N%, base) collection tints.
 * Accepts "#rrggbb"; "transparent" (or unparseable) returns the base.
 */
export function mixHexColors(color: string, base: string, colorPercent: number): string {
  const parse = (hex: string): [number, number, number] | null => {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (match === null) return null;
    const value = parseInt(match[1], 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  };
  const top = parse(color);
  const bottom = parse(base);
  if (top === null || bottom === null) return base;
  const ratio = Math.max(0, Math.min(100, colorPercent)) / 100;
  const channel = (index: number): number => Math.round(top[index] * ratio + bottom[index] * (1 - ratio));
  return `#${[channel(0), channel(1), channel(2)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
}
