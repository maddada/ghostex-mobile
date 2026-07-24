import { mixHexColors } from './palette';

export const SIDEBAR_BACKGROUND_CONTRAST_MIN = 85;
export const SIDEBAR_BACKGROUND_CONTRAST_MAX = 100;
export const DEFAULT_SIDEBAR_BACKGROUND_CONTRAST = 90;
export const DEFAULT_SIDEBAR_BACKGROUND_TINT = '#808080';

const SCALE_REFERENCE_CONTRAST = 95;
const DEFAULT_UNCALIBRATED_BACKGROUND = '#1C1C1C';
const LIGHT_FOREGROUND = '#D8D8D8';
const DARK_FOREGROUND = '#262626';

export const SIDEBAR_BACKGROUND_TINT_OPTIONS: ReadonlyArray<{
  label: string;
  value: string;
}> = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Neutral Gray', value: '#808080' },
  { label: 'Black', value: '#000000' },
  { label: 'Steel', value: '#4F6672' },
  { label: 'Red', value: '#884444' },
  { label: 'Orange', value: '#8A5330' },
  { label: 'Amber', value: '#8A6A2F' },
  { label: 'Olive', value: '#657A3F' },
  { label: 'Green', value: '#3F7A5F' },
  { label: 'Teal', value: '#2F7D66' },
  { label: 'Cyan', value: '#287C7F' },
  { label: 'Blue', value: '#336699' },
  { label: 'Indigo', value: '#4F5F96' },
  { label: 'Violet', value: '#6C4F8F' },
  { label: 'Pink', value: '#854F7A' },
  { label: 'Rose', value: '#8A4F5F' },
] as const;

const CALIBRATED_DARK_TINTS: Readonly<Record<string, string>> = {
  '#000000': '#000000',
  '#ffffff': '#0e0e0e',
  '#808080': '#0e0e0e',
  '#88d7ff': '#0a0f12',
  '#4f6672': '#0c0e10',
  '#884444': '#0d0005',
  '#8a5330': '#100502',
  '#8a6a2f': '#110a02',
  '#657a3f': '#0c1005',
  '#3f7a5f': '#031006',
  '#2f7d66': '#03100c',
  '#287c7f': '#031011',
  '#336699': '#0c0e11',
  '#4f5f96': '#080912',
  '#6c4f8f': '#0a0611',
  '#854f7a': '#100611',
  '#8a4f5f': '#100409',
};

type Rgb = { red: number; green: number; blue: number };

export type SidebarAppearance = {
  background: string;
  foreground: string;
  muted: string;
  card: string;
  cardActive: string;
  border: string;
  projectCard: string;
  projectBorder: string;
};

export function normalizeSidebarTint(value: string): string {
  const normalized = value.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/u.test(normalized)
    ? normalized
    : DEFAULT_SIDEBAR_BACKGROUND_TINT;
}

export function clampSidebarContrast(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_BACKGROUND_CONTRAST;
  return Math.min(
    SIDEBAR_BACKGROUND_CONTRAST_MAX,
    Math.max(SIDEBAR_BACKGROUND_CONTRAST_MIN, Math.round(value)),
  );
}

function parseHex(value: string): Rgb {
  const normalized = normalizeSidebarTint(value);
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function formatHex(color: Rgb): string {
  const channel = (value: number): string =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function defaultDarkTintBackground(tint: string): Rgb {
  const normalized = normalizeSidebarTint(tint);
  const calibrated = CALIBRATED_DARK_TINTS[normalized];
  if (calibrated !== undefined) return parseHex(calibrated);

  const color = parseHex(normalized);
  const average = (color.red + color.green + color.blue) / 3;
  const direction = {
    red: color.red - average,
    green: color.green - average,
    blue: color.blue - average,
  };
  const magnitude = Math.max(
    Math.abs(direction.red),
    Math.abs(direction.green),
    Math.abs(direction.blue),
  );
  if (magnitude < 0.5) return parseHex(DEFAULT_UNCALIBRATED_BACKGROUND);

  const base = parseHex(DEFAULT_UNCALIBRATED_BACKGROUND);
  return {
    red: base.red + (direction.red / magnitude) * 4,
    green: base.green + (direction.green / magnitude) * 4,
    blue: base.blue + (direction.blue / magnitude) * 4,
  };
}

export function sidebarBackgroundForSettings(tint: string, contrast: number): string {
  const calibrated = defaultDarkTintBackground(tint);
  const clamped = clampSidebarContrast(contrast);
  if (clamped === SIDEBAR_BACKGROUND_CONTRAST_MAX) return '#000000';
  const scale =
    (SIDEBAR_BACKGROUND_CONTRAST_MAX - clamped) /
    (SIDEBAR_BACKGROUND_CONTRAST_MAX - SCALE_REFERENCE_CONTRAST);
  return formatHex({
    red: calibrated.red * scale,
    green: calibrated.green * scale,
    blue: calibrated.blue * scale,
  });
}

function foregroundForBackground(background: string): string {
  const color = parseHex(background);
  const luminance = (0.2126 * color.red + 0.7152 * color.green + 0.0722 * color.blue) / 255;
  return luminance > 0.54 ? DARK_FOREGROUND : LIGHT_FOREGROUND;
}

function hexWithAlpha(color: string, alpha: number): string {
  const { red, green, blue } = parseHex(color);
  return `rgba(${red},${green},${blue},${alpha})`;
}

export function resolveSidebarAppearance(tint: string, contrast: number): SidebarAppearance {
  const background = sidebarBackgroundForSettings(tint, contrast);
  const foreground = foregroundForBackground(background);
  return {
    background,
    foreground,
    muted: mixHexColors(foreground, background, 56),
    card: mixHexColors(foreground, background, 4),
    cardActive: mixHexColors(foreground, background, 7),
    border: hexWithAlpha(foreground, 0.12),
    projectCard: hexWithAlpha(foreground, 0.045),
    projectBorder: hexWithAlpha(foreground, 0.13),
  };
}
