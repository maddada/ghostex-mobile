/**
 * Session tag catalog, mirroring packages/shared/session-tags.ts (grouped Priority →
 * Progress → Type) with the desktop sidebar's tag tint colors and glyphs so
 * the mobile "Tag as" menu and the tagged session rows render the same visual
 * state as the gpui sidebar (packages/core-ui/session-tag-ui.tsx +
 * .session-tag-agent-icon in packages/core-ui/styles/session-cards.css).
 */

import {
  COMMAND_ICONS,
  TAG_ICONS,
  type TablerIconComponent,
} from '../assets/tablerIcons.generated';
import { TagGlyph } from '../components/sessions/icons';
import type { GhostexCustomSessionTags } from './mobileSummary';

export type SessionTagOption = { label: string; value: string; color: string };

export type SessionTagSection = {
  label: 'Priority' | 'Progress' | 'Type';
  options: readonly SessionTagOption[];
};

export const SESSION_TAG_SECTIONS: readonly SessionTagSection[] = [
  {
    label: 'Priority',
    options: [
      { label: 'Favorite', value: 'favorite', color: '#F3CC5F' },
      { label: 'High Priority', value: 'high-priority', color: '#FF8B6B' },
      { label: 'Low Priority', value: 'low-priority', color: '#8E949D' },
    ],
  },
  {
    label: 'Progress',
    options: [
      { label: 'Todo', value: 'todo', color: '#D9DEE6' },
      { label: 'In Progress', value: 'in-progress', color: '#4EE6B8' },
      { label: 'Testing', value: 'testing', color: '#59D9FF' },
      { label: 'Blocked', value: 'blocked', color: '#FF5F73' },
      { label: 'On Hold', value: 'on-hold', color: '#D2A7FF' },
      { label: 'Done', value: 'done', color: '#95D7F6' },
    ],
  },
  {
    label: 'Type',
    options: [
      { label: 'Research', value: 'research', color: '#8FB8FF' },
      { label: 'Bug', value: 'bug', color: '#A54646' },
      { label: 'Feature', value: 'feature', color: '#F0C66E' },
      { label: 'Design', value: 'design', color: '#FF9EE7' },
    ],
  },
];

const OPTION_BY_VALUE: Readonly<Record<string, SessionTagOption>> = Object.fromEntries(
  SESSION_TAG_SECTIONS.flatMap((section) => section.options).map((option) => [
    option.value,
    option,
  ]),
);

/**
 * CDXC:Sessions 2026-09-11 SEE-ALSO:
 * Custom tags are one more value of the single `sessionTag` marker: `custom-` ids resolved against the per-machine catalog gxserver ships as `customSessionTags`, with the built-ins kept in this file.
 * The id rules and catalog shape live in packages/shared/session-tags.ts and server/src/custom_session_tags.rs; the wire parse is `parseCustomSessionTags` in ./mobileSummary.ts.
 */
export const CUSTOM_SESSION_TAG_ID_PREFIX = 'custom-';

/** Neutral tint for a custom id whose catalog entry this machine no longer has. */
const UNRESOLVED_CUSTOM_TAG_COLOR = '#9AA8B6';
const UNRESOLVED_CUSTOM_TAG_LABEL = 'Custom tag';

export function isCustomSessionTagId(value: string): boolean {
  return (
    value.startsWith(CUSTOM_SESSION_TAG_ID_PREFIX) &&
    value.length > CUSTOM_SESSION_TAG_ID_PREFIX.length
  );
}

/**
 * Desktop getEffectiveSidebarSessionTag: the explicit tag wins, and a legacy
 * favorite with no tag still reads as the Favorite tag. Any `custom-` id counts
 * even when the catalog lacks it, so a tag deleted on the desktop (or one
 * shipped by a newer daemon) still marks the row instead of silently vanishing.
 */
export function effectiveSessionTag(session: {
  isFavorite?: boolean;
  sessionTag?: string;
}): string | undefined {
  const tag = session.sessionTag ?? '';
  if (tag.length > 0 && tag !== 'none') {
    if (OPTION_BY_VALUE[tag] !== undefined || isCustomSessionTagId(tag)) return tag;
  }
  return session.isFavorite === true ? 'favorite' : undefined;
}

export type ResolvedSessionTag = {
  tagId: string;
  label: string;
  color: string;
  Icon: TablerIconComponent;
};

/**
 * Resolve a session's effective tag to what a row or menu paints: built-ins
 * from the catalog above, custom ids from the machine's `customSessionTags`
 * (icon by COMMAND_ICONS id, color from the catalog), and an unresolved custom
 * id as the plain tag outline in a neutral tint.
 */
export function resolveSessionTag(
  session: { isFavorite?: boolean; sessionTag?: string },
  catalog: GhostexCustomSessionTags | undefined,
): ResolvedSessionTag | undefined {
  const tagId = effectiveSessionTag(session);
  if (tagId === undefined) return undefined;
  const builtin = OPTION_BY_VALUE[tagId];
  if (builtin !== undefined) {
    return {
      tagId,
      label: builtin.label,
      color: builtin.color,
      Icon: TAG_ICONS[tagId] ?? TagGlyph,
    };
  }
  const custom = catalog?.tags[tagId];
  if (custom === undefined) {
    return {
      tagId,
      label: UNRESOLVED_CUSTOM_TAG_LABEL,
      color: UNRESOLVED_CUSTOM_TAG_COLOR,
      Icon: TagGlyph,
    };
  }
  return {
    tagId,
    label: custom.name,
    color: custom.color,
    Icon: COMMAND_ICONS[custom.icon] ?? TagGlyph,
  };
}

/** Glyph for a custom tag's catalog icon id; the plain tag outline for unknown ids. */
export function customSessionTagIcon(icon: string): TablerIconComponent {
  return COMMAND_ICONS[icon] ?? TagGlyph;
}

export function sessionTagIcon(tag: string): TablerIconComponent | undefined {
  return TAG_ICONS[tag];
}
