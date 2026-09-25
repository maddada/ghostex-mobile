/**
 * GhostexPalette design tokens.
 * Source of truth: docs/specs/sessions-drawer.md §0.
 */
export const GhostexPalette = {
  /** Page, navigation header, drawer + dialog surface; pill chip fill. */
  BACKGROUND: '#0B0B0B',
  /** Primary text, icons. */
  FOREGROUND: '#FAFAFA',
  /** Secondary text, headers, empty rows. */
  MUTED: '#B5B5B5',
  /** 1dp strokes on cards/pills (white 14%). */
  BORDER: 'rgba(255,255,255,0.14)',
  /** Session row bg (inactive). */
  CARD: '#191919',
  /** Active row fill, state cards, buttons. */
  CARD_ACTIVE: '#262626',
  /** Inputs: one step above the page so the field edge reads. */
  INPUT_BACKGROUND: '#141414',
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
  /** Queued-prompt badge yellow (desktop decorations.rs #f6c945); not the row's Delayed Send clock. */
  DELAYED_SEND_CLOCK: '#F6C945',
  /*
   * Session-row status, the dark-theme values of the desktop sidebar row
   * (apps/desktop/src/app/native_sidebar/status.rs, sessions.rs, icons.rs).
   */
  /** Working dot, 8dp (status.rs WORKING_COLOR). */
  ROW_WORKING: '#C68A06',
  /** Attention dot, 7dp. */
  ROW_ATTENTION: '#95D7F6',
  /** Background shell or monitor dot, 8dp (status.rs background_work_color). */
  ROW_BACKGROUND_WORK: '#B4B8BF',
  /** Pending question dot, 6dp (status.rs question_indicator). */
  ROW_QUESTION: '#F472B6',
  /** Relative time and timer countdown. */
  ROW_TIME: '#A6A6A6',
  /** The same text on a sleeping session. */
  ROW_TIME_SLEEPING: '#686868',
  /** Delayed Send leading clock, 18dp (icons.rs). */
  ROW_DELAYED_SEND_CLOCK: '#F4CE6B',
  /** Close After Done leading clock, 18dp (icons.rs). */
  ROW_CLOSE_AFTER_DONE_CLOCK: '#F2A2A2',
  /** Failed queued-prompt badge red (desktop decorations.rs #ff6b6b). */
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

/**
 * Setup-flow tokens (Welcome, Choose, Scan, Connected and the machine screens
 * that follow them), ported from docs/2026-09-03/mobile-setup/shared.css so
 * the phone matches the desktop Kanban / Automate look: #0b0b0b page,
 * #141414 panels, #191919 cards, hairline borders, one accent used sparingly.
 * Kept separate from GhostexPalette so screens that were not restyled keep
 * their exact look.
 */
export const SetupPalette = {
  PAGE: '#0b0b0b',
  PANEL: '#141414',
  CARD: '#191919',
  CARD_HOVER: '#202020',
  /** Filled chip / step-number background. */
  MUTED_BG: '#242424',
  BORDER: 'rgba(255,255,255,0.08)',
  BORDER_STRONG: 'rgba(255,255,255,0.14)',
  FOREGROUND: '#f4f4f5',
  MUTED: '#a3a3a3',
  DIM: '#6f6f74',
  ACCENT: '#86d3f8',
  /** Accent at 12% / 30%: the recommended card's icon fill and border. */
  ACCENT_FILL: 'rgba(134,211,248,0.12)',
  ACCENT_BORDER: 'rgba(134,211,248,0.3)',
  OK: '#63d17a',
  WARN: '#ffb454',
  ERROR: '#ff6b6b',
  ERROR_BORDER: 'rgba(255,107,107,0.4)',
  /** Primary button: white fill, near-black label. */
  PRIMARY_BUTTON: '#f4f4f5',
  PRIMARY_BUTTON_FOREGROUND: '#111111',
  /** Bottom-sheet backdrop. */
  BACKDROP: 'rgba(0,0,0,0.55)',
  /** Sheet grabber pill. */
  GRABBER: '#3a3a3a',
} as const;

/** Radii per spec §0: cards/rows/inputs 8dp; pills/chips fully rounded. */
export const GhostexRadii = {
  card: 8,
  row: 8,
  input: 8,
  /** Setup-flow controls (buttons, inputs, small icon tiles). */
  control: 8,
  /** Setup-flow sections (cards, row groups, callouts). */
  section: 12,
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
