/**
 * Session tag catalog, mirroring shared/session-tags.ts (grouped Priority →
 * Progress → Type) with the desktop sidebar's tag tint colors so the mobile
 * tag submenu renders the same rows as the desktop "Tag as" menu.
 */

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
