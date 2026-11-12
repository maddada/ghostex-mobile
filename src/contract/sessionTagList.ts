/**
 * The Session Tags list (`sidebarSessionTagListItems`): which tags the Tag As menu and the tag filter offer, in what
 * order. A port of packages/gx-core/src/sidebar_view/tags.rs (`normalize_tag_list_items`,
 * `enabled_visible_tag_sections`, `enabled_visible_tag_filters`, `matches_session_filters`), which the phone does
 * not run; the list itself arrives through Sidebar organization sync (settingsSync/sidebarOrganization.ts).
 *
 * CDXC:Sidebar 2026-11-12 SEE-ALSO: packages/gx-core/src/sidebar_view/tags.rs; the phone's Tag As menu, its tag
 * filter and Settings › Sidebar & Sessions › Session Tags read the synced list with the desktop's rules.
 */

import type { GhostexCustomSessionTags } from './mobileSummary/model';
import { isCustomSessionTagId, SESSION_TAG_SECTIONS } from './sessionTags';

export const UNTAGGED_TAG_FILTER = 'untagged';

export type TagListItemKind = 'tag' | 'separator' | 'untagged';

export type TagListItem = { id: string; kind: TagListItemKind; enabled: boolean; visible: boolean };

const DEFAULT_OFF_TAGS: readonly string[] = ['high-priority', 'low-priority', 'todo', 'bug', 'feature'];

const SEPARATOR_IDS: readonly string[] = [
  'separator-priority-progress',
  'separator-progress-type',
  'separator-type-untagged',
];

const BUILTIN_TAGS: readonly string[] = SESSION_TAG_SECTIONS.flatMap((section) => section.options.map((o) => o.value));

function isSessionTag(value: string): boolean {
  return BUILTIN_TAGS.includes(value) || isCustomSessionTagId(value);
}

/** The desktop's first-run list: each section's tags, then its separator, then No tag. */
export function defaultTagListItems(): TagListItem[] {
  const items: TagListItem[] = [];
  SESSION_TAG_SECTIONS.forEach((section, index) => {
    for (const option of section.options) {
      const off = DEFAULT_OFF_TAGS.includes(option.value);
      items.push({ id: option.value, kind: 'tag', enabled: !off, visible: !off });
    }
    items.push({ id: SEPARATOR_IDS[index] ?? `separator-${index}`, kind: 'separator', enabled: true, visible: true });
  });
  items.push({ id: UNTAGGED_TAG_FILTER, kind: 'untagged', enabled: true, visible: true });
  return items;
}

function normalizeItem(candidate: unknown): TagListItem | null {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return null;
  const object = candidate as Record<string, unknown>;
  const flag = (key: string) => (typeof object[key] === 'boolean' ? (object[key] as boolean) : true);
  const id = typeof object.id === 'string' ? object.id : '';
  const tagField = typeof object.tag === 'string' && isSessionTag(object.tag) ? object.tag : null;
  const tag = tagField ?? (isSessionTag(id) ? id : null);
  if (tag !== null) return { id: tag, kind: 'tag', enabled: flag('enabled'), visible: flag('visible') };
  if (id === UNTAGGED_TAG_FILTER || object.type === 'untagged') {
    return { id: UNTAGGED_TAG_FILTER, kind: 'untagged', enabled: flag('enabled'), visible: flag('visible') };
  }
  return SEPARATOR_IDS.includes(id) ? { id, kind: 'separator', enabled: flag('enabled'), visible: flag('visible') } : null;
}

/**
 * gx-core `normalize_tag_list_items`: known rows in the stored order, the defaults appended for anything missing,
 * custom tags the computer no longer knows dropped and new ones inserted before the No tag separator.
 */
export function normalizeTagListItems(candidate: unknown, catalog: GhostexCustomSessionTags | null): TagListItem[] {
  const seen = new Set<string>();
  const items: TagListItem[] = [];
  for (const raw of Array.isArray(candidate) ? candidate : []) {
    const item = normalizeItem(raw);
    if (item === null || seen.has(item.id)) continue;
    if (catalog !== null && item.kind === 'tag' && isCustomSessionTagId(item.id) && catalog.tags[item.id] === undefined) {
      continue;
    }
    seen.add(item.id);
    items.push(item);
  }
  for (const item of defaultTagListItems()) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      items.push(item);
    }
  }
  if (catalog !== null) {
    const missing = catalog.order.filter((tagId) => !seen.has(tagId) && catalog.tags[tagId] !== undefined);
    if (missing.length > 0) {
      let at = items.findIndex((item) => item.id === 'separator-type-untagged');
      if (at < 0) at = items.findIndex((item) => item.kind === 'untagged');
      if (at < 0) at = items.length;
      items.splice(at, 0, ...missing.map((id): TagListItem => ({ id, kind: 'tag', enabled: true, visible: true })));
    }
  }
  return items;
}

/** The list as the desktop saves it (`{ id, type, tag?, enabled, visible }`), for an edit made on the phone. */
export function storedTagListItems(items: readonly TagListItem[]): unknown[] {
  return items.map((item) =>
    item.kind === 'tag'
      ? { id: item.id, type: 'tag', tag: item.id, enabled: item.enabled, visible: item.visible }
      : { id: item.id, type: item.kind, enabled: item.enabled, visible: item.visible },
  );
}

/**
 * gx-core `enabled_visible_tag_sections`: the tags the Tag As menu offers, built-in sections then Custom, each
 * filtered to the enabled and visible tags; `include` puts back a tag a session already carries so it can be taken
 * off again. Empty sections are dropped.
 */
export function enabledVisibleTagIds(
  candidate: unknown,
  catalog: GhostexCustomSessionTags,
  include: readonly string[],
): { builtins: string[][]; custom: string[] } {
  const visible: string[] = [];
  for (const item of normalizeTagListItems(candidate, catalog)) {
    if (item.kind === 'tag' && item.enabled && item.visible && !visible.includes(item.id)) visible.push(item.id);
  }
  for (const tag of include) if (!visible.includes(tag)) visible.push(tag);
  return {
    builtins: SESSION_TAG_SECTIONS.map((section) =>
      section.options.map((option) => option.value).filter((value) => visible.includes(value)),
    ),
    custom: visible.filter((tag) => isCustomSessionTagId(tag) && catalog.tags[tag] !== undefined),
  };
}

/** gx-core `enabled_visible_tag_filters`: the filters the tag filter offers, in list order (tags and No tag). */
export function enabledVisibleTagFilters(candidate: unknown, catalog: GhostexCustomSessionTags | null): string[] {
  return normalizeTagListItems(candidate, catalog)
    .filter((item) => item.kind !== 'separator' && item.enabled && item.visible)
    .map((item) => item.id);
}

/** gx-core `matches_session_filters` without the Cloud Box filter: no filter keeps every row. */
export function matchesTagFilters(tag: string | undefined, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  return filters.includes(tag ?? UNTAGGED_TAG_FILTER);
}
