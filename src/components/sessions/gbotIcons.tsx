/**
 * A GBot's icon on the phone. gxserver keeps a desktop titlebar icon name (apps/desktop/assets/titlebar/<icon>.svg,
 * `robot` by default); the phone draws the same Tabler glyph where its generated sets have it, and the robot
 * otherwise, tinted with the bot's colour.
 *
 * CDXC:GBots 2026-11-09 WHY: the phone has no copy of the desktop's titlebar SVGs, and a new generated set is a bigger
 * change than the rows need; the project identity glyphs (`COMMAND_ICONS`, camelCased Tabler names), the session tag
 * glyphs and a few of the sidebar's own glyphs already cover every icon the picker offers (`GBOT_ICON_CHOICES`).
 */

import type { ReactElement } from 'react';

import { COMMAND_ICONS, TAG_ICONS, type TablerIconComponent } from '../../assets/tablerIcons.generated';
import { GBOT_DEFAULT_ICON } from '../../contract/gbots';
import { BriefcaseGlyph, HeadsetGlyph, PencilGlyph, UserGlyph } from './icons';

/** Tabler names the tag set draws under another key. */
const TAG_ICON_BY_TABLER: Readonly<Record<string, string>> = {
  microscope: 'research',
  palette: 'design',
  puzzle: 'feature',
  star: 'favorite',
  'circle-check': 'done',
  checkbox: 'todo',
  'alert-triangle': 'high-priority',
};

/** Desktop titlebar icons the phone draws with its own sidebar glyphs. */
const SIDEBAR_GLYPHS: Readonly<Record<string, TablerIconComponent>> = {
  pencil: PencilGlyph,
  user: UserGlyph,
  briefcase: BriefcaseGlyph,
  headset: HeadsetGlyph,
};

function camelCase(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());
}

/** The glyph for a GBot's `icon`, or the robot. */
export function gbotIconComponent(icon: string): TablerIconComponent {
  const name = icon.trim().length > 0 ? icon.trim() : GBOT_DEFAULT_ICON;
  return (
    COMMAND_ICONS[camelCase(name)] ??
    SIDEBAR_GLYPHS[name] ??
    (TAG_ICON_BY_TABLER[name] !== undefined ? TAG_ICONS[TAG_ICON_BY_TABLER[name]] : undefined) ??
    COMMAND_ICONS[GBOT_DEFAULT_ICON]
  );
}

export function GbotIcon({ icon, color, size }: { icon: string; color: string; size: number }): ReactElement {
  const Glyph = gbotIconComponent(icon);
  return <Glyph size={size} color={color} />;
}

/**
 * The icons the New GBot form and GBot Settings offer: names gxserver accepts and the desktop draws from its titlebar
 * set, each one the phone draws too.
 */
export const GBOT_ICON_CHOICES: readonly string[] = [
  'robot',
  'search',
  'microscope',
  'pencil',
  'briefcase',
  'user',
  'clock',
  'chart-bar',
  'brain',
  'book',
  'code',
  'rocket',
  'sparkles',
  'world',
  'bell',
  'wand',
  'flask',
  'database',
  'tool',
  'palette',
  'bug',
  'checklist',
];
