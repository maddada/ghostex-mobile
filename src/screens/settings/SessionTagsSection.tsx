import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { EMPTY_CUSTOM_SESSION_TAGS } from '../../contract/mobileSummary/model';
import { normalizeTagListItems, storedTagListItems, type TagListItem } from '../../contract/sessionTagList';
import { SESSION_TAG_SECTIONS } from '../../contract/sessionTags';
import { setSidebarSetting } from '../../settingsSync/settingsSync';
import { SettingsSection } from './SectionBoundary';
import { Caption, SectionHeader, ToggleRow } from './SettingsControls';

const BUILTIN_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  SESSION_TAG_SECTIONS.flatMap((section) => section.options.map((option) => [option.value, option.label])),
);

/**
 * Settings › Sidebar & Sessions › Session Tags: the desktop's Tag filter list (`sidebarSessionTagListItems`), one
 * switch per tag in the list's order, synced with the computers. A tag switched off leaves the Tag As menu and the
 * tag filter (it is hidden and disabled, as the desktop's two buttons together); adding, deleting and reordering
 * tags stay on the computer.
 */
export function SessionTagsSection({
  items,
  summary,
}: {
  items: unknown[] | null;
  summary: GhostexMobileSummary | null;
}) {
  const catalog = summary?.customSessionTags ?? EMPTY_CUSTOM_SESSION_TAGS;
  const list = normalizeTagListItems(items, summary === null ? null : catalog);
  const label = (item: TagListItem): string =>
    item.kind === 'untagged' ? 'No tag' : (BUILTIN_LABELS[item.id] ?? catalog.tags[item.id]?.name ?? item.id);
  const setShown = (id: string, shown: boolean) =>
    setSidebarSetting(
      'sidebarSessionTagListItems',
      storedTagListItems(list.map((item) => (item.id === id ? { ...item, enabled: shown, visible: shown } : item))),
    );
  return (
    <SettingsSection name="settings:sessions-list:session-tags">
      <SectionHeader title="Session Tags" />
      {list
        .filter((item) => item.kind !== 'separator')
        .map((item) => (
          <ToggleRow
            key={item.id}
            label={label(item)}
            value={item.enabled && item.visible}
            onValueChange={(next) => setShown(item.id, next)}
          />
        ))}
      <Caption>The tags the Tag As menu and the tag filter offer. Add, rename or reorder tags on a computer.</Caption>
    </SettingsSection>
  );
}
