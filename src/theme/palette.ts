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
  /** Connected service status. */
  STATUS_CONNECTED: '#63D17A',
  /** Error dot (red). Matches desktop lifecycle-error dot. */
  STATUS_ERROR: '#FF6B6B',
  /** Terminal surface background fallback ("Aizen Dark" port later). */
  TERMINAL_BACKGROUND: '#000000',
} as const;

/**
 * Sessions-list tokens ported from the desktop gpui sidebar CSS
 * (packages/core-ui/styles/theme.css, groups.css, session-cards.css) so the mobile
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
  /** Session-row working status dot (desktop .session-status-dot #ffb454). */
  WORKING_DOT: '#FFB454',
  /** Reference-sidebar working spinner ring (reference-sidebar-working-spin #d99a62). */
  WORKING_SPINNER: '#D99A62',
  /** Delayed Send leading clock (.session-delayed-send-agent-icon #f6c945). */
  DELAYED_SEND_CLOCK: '#F6C945',
  /** Close After Done leading clock (.session-close-after-done-agent-icon #ff9aa2). */
  CLOSE_AFTER_DONE_CLOCK: '#FF9AA2',
  /** Session-row error status dot (desktop #ff6b6b). */
  ERROR_DOT: '#FF6B6B',
  /** Remote sleeping-row dot: mix(--app-muted 86%, --app-foreground 14%). */
  SLEEP_DOT: '#808791',
  /** Sleeping row content opacity (desktop .session[data-sleeping]). */
  SLEEP_OPACITY: 0.52,
  /** Collection header base surface behind the color tint (#141414). */
  COLLECTION_SURFACE: '#141414',
  /** Desktop accent (--app-button-background). */
  ACCENT: '#7DA4F8',
  /** Header square-button fill: color-mix(--app-card-active 88%, transparent). */
  HEADER_BUTTON_BG: 'rgba(42,42,42,0.88)',
  /** Header square-button border: --app-border (white 11%) at 92%. */
  HEADER_BUTTON_BORDER: 'rgba(255,255,255,0.10)',
  /** Neutral header button icon. */
  HEADER_BUTTON_ICON: '#AAB0B8',
  /** Context menu surface: mix(--app-card #252525 92%, #000 8%). */
  MENU_BG: '#222222',
  /** Context menu hover/selected row (--app-context-menu-hover-background). */
  MENU_HOVER: '#202020',
  /** Context menu border: --app-border at 88%. */
  MENU_BORDER: 'rgba(255,255,255,0.10)',
  /** Context menu divider: --app-border at 70%. */
  MENU_DIVIDER: 'rgba(255,255,255,0.08)',
  /** Danger rows in context menus (desktop #ff7b72). */
  MENU_DANGER: '#FF7B72',
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

/** Scale a color's alpha without changing its RGB channels or dimming child content. */
export function colorWithOpacity(color: string, opacityPercent: number): string {
  const multiplier = Math.max(0, Math.min(100, opacityPercent)) / 100;
  const hexMatch = /^#([0-9a-f]{6})$/iu.exec(color.trim());
  if (hexMatch !== null) {
    const value = Number.parseInt(hexMatch[1], 16);
    return `rgba(${(value >> 16) & 0xff},${(value >> 8) & 0xff},${value & 0xff},${multiplier})`;
  }

  const rgbaMatch =
    /^rgba\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d*\.?\d+)\s*\)$/iu.exec(
      color.trim(),
    );
  if (rgbaMatch !== null) {
    const alpha = Math.max(0, Math.min(1, Number.parseFloat(rgbaMatch[4]))) * multiplier;
    return `rgba(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]},${alpha})`;
  }

  throw new Error(`Unsupported color format: ${color}`);
}
