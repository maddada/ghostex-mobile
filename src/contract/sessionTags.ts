/**
 * Session tag catalog, mirroring shared/session-tags.ts (grouped Priority →
 * Progress → Type) with the desktop sidebar's tag tint colors and glyphs so
 * the mobile "Tag as" menu and the tagged session rows render the same visual
 * state as the gpui sidebar (sidebar/session-tag-ui.tsx +
 * .session-tag-agent-icon in sidebar/styles/session-cards.css).
 */

import { TAG_ICONS, type TablerIconComponent } from '../assets/tablerIcons.generated';

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
 * Desktop getEffectiveSidebarSessionTag: the explicit tag wins, and a legacy
 * favorite with no tag still reads as the Favorite tag.
 */
export function effectiveSessionTag(session: {
  isFavorite?: boolean;
  sessionTag?: string;
}): string | undefined {
  const tag = session.sessionTag ?? '';
  if (tag.length > 0 && tag !== 'none' && OPTION_BY_VALUE[tag] !== undefined) return tag;
  return session.isFavorite === true ? 'favorite' : undefined;
}

export function sessionTagColor(tag: string): string {
  return OPTION_BY_VALUE[tag]?.color ?? '#9AA8B6';
}

export function sessionTagLabel(tag: string): string {
  return OPTION_BY_VALUE[tag]?.label ?? tag;
}

export function sessionTagIcon(tag: string): TablerIconComponent | undefined {
  return TAG_ICONS[tag];
}
