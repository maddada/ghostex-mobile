/**
 * The Session Tags list (`sidebarSessionTagListItems`): which tags the Tag As menu and the tag filter offer, in what
 * order. A port of packages/gx-core/src/sidebar_view/tags.rs (`normalize_tag_list_items`,
 * `enabled_visible_tag_sections`, `enabled_visible_tag_filters`, `matches_session_filters`), which the phone does
 * not run; the list itself arrives through Sidebar organization sync (settingsSync/sidebarOrganization.ts).
 *
 * CDXC:Sidebar 2026-11-12 SEE-ALSO: packages/gx-core/src/sidebar_view/tags.rs; the phone's Tag As menu, its tag
 * filter and Settings › Sidebar & Sessions › Session Tags read the synced list with the desktop's rules.
 *
 * The six status entries (`type: 'status'`, ids `status-…`) are worked out from each session's state, never stored
 * on a session: they order Group sessions by tags (contract/unified/sessionGroups.ts) and are never a Tag As choice
 * or a tag filter. SEE-ALSO: packages/shared/session-tags.ts, the desktop's TypeScript port of the same stored list.
 */

import type { GhostexCustomSessionTags } from './mobileSummary/model';
import { isCustomSessionTagId, SESSION_TAG_SECTIONS } from './sessionTags';

export const UNTAGGED_TAG_FILTER = 'untagged';

export type TagListItemKind = 'tag' | 'separator' | 'untagged' | 'status';

export type TagListItem = { id: string; kind: TagListItemKind; enabled: boolean; visible: boolean };

/** The status entries in their default order, the most urgent first; a list without them gets them at its top. */
export const STATUS_TAG_IDS = [
  'status-needs-you',
  'status-question',
  'status-error',
  'status-finished',
  'status-working',
  'status-idle',
] as const;

export type StatusTagId = (typeof STATUS_TAG_IDS)[number];

export function isStatusTagId(id: string): id is StatusTagId {
  return (STATUS_TAG_IDS as readonly string[]).includes(id);
}

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

/** The desktop's first-run list: the status entries, then each section's tags and its separator, then No tag. */
export function defaultTagListItems(): TagListItem[] {
  const items: TagListItem[] = STATUS_TAG_IDS.map((id) => ({ id, kind: 'status', enabled: true, visible: true }));
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
  if (isStatusTagId(id)) return { id, kind: 'status', enabled: flag('enabled'), visible: flag('visible') };
  const tagField = typeof object.tag === 'string' && isSessionTag(object.tag) ? object.tag : null;
  const tag = tagField ?? (isSessionTag(id) ? id : null);
  if (tag !== null) return { id: tag, kind: 'tag', enabled: flag('enabled'), visible: flag('visible') };
  if (id === UNTAGGED_TAG_FILTER || object.type === 'untagged') {
    return { id: UNTAGGED_TAG_FILTER, kind: 'untagged', enabled: flag('enabled'), visible: flag('visible') };
  }
  return SEPARATOR_IDS.includes(id) ? { id, kind: 'separator', enabled: flag('enabled'), visible: flag('visible') } : null;
}

/**
 * Each held entry as `normalizeTagListItems` reads it, or `null` where it leaves the entry out: one this phone does not
 * know, a custom tag the computer's catalog lacks, or a repeat of an entry already read.
 */
function readHeldItems(held: readonly unknown[], catalog: GhostexCustomSessionTags | null): (TagListItem | null)[] {
  const seen = new Set<string>();
  return held.map((raw) => {
    const item = normalizeItem(raw);
    if (item === null || seen.has(item.id)) return null;
    if (catalog !== null && item.kind === 'tag' && isCustomSessionTagId(item.id) && catalog.tags[item.id] === undefined) {
      return null;
    }
    seen.add(item.id);
    return item;
  });
}

/**
 * gx-core `normalize_tag_list_items`: known rows in the stored order, the status entries a list lacks put at its top
 * (in their default order), the other defaults appended for anything missing, custom tags the computer no longer
 * knows dropped and new ones inserted before the No tag separator.
 */
export function normalizeTagListItems(candidate: unknown, catalog: GhostexCustomSessionTags | null): TagListItem[] {
  const items = readHeldItems(Array.isArray(candidate) ? candidate : [], catalog).filter(
    (item): item is TagListItem => item !== null,
  );
  const seen = new Set(items.map((item) => item.id));
  const missingStatuses: TagListItem[] = [];
  for (const item of defaultTagListItems()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.kind === 'status') missingStatuses.push(item);
    else items.push(item);
  }
  items.unshift(...missingStatuses);
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
 * A held stored list with the status entries it lacks put at its top (in their default order, switched on), every held
 * entry kept exactly as it is: its place, its flags, and custom tags or separators this phone's catalog does not know.
 * Written when Group sessions by tags is switched on, so the switch never drops an entry another computer still knows.
 */
export function withStatusEntries(held: readonly unknown[]): unknown[] {
  const present = new Set(
    held.map((entry) =>
      typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string' ? entry.id : '',
    ),
  );
  const missing = defaultTagListItems().filter((item) => item.kind === 'status' && !present.has(item.id));
  return [...storedTagListItems(missing), ...held];
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

/**
 * gx-core `enabled_visible_tag_filters`: the filters the tag filter offers, in list order (tags and No tag); a status
 * entry is never a filter.
 */
export function enabledVisibleTagFilters(candidate: unknown, catalog: GhostexCustomSessionTags | null): string[] {
  return normalizeTagListItems(candidate, catalog)
    .filter((item) => (item.kind === 'tag' || item.kind === 'untagged') && item.enabled && item.visible)
    .map((item) => item.id);
}

/**
 * The entries the Session Tags settings list, in the stored order: every entry but the separators, and the status
 * entries only while Group sessions by tags is on.
 */
export function listedTagItems(items: readonly TagListItem[], grouping: boolean): TagListItem[] {
  return items.filter((item) => item.kind !== 'separator' && (grouping || item.kind !== 'status'));
}

/**
 * The whole list with the listed entry `id` moved to `position` among the listed entries (`listedTagItems`), every
 * entry keeping its switches. An entry that is not listed (a separator, a status entry while grouping is off) keeps
 * its index in the stored list, and the listed entries change places among the remaining indexes. `null` when nothing
 * moves. Settings saves a move through `moveHeldTagItem`, which applies this to the held list.
 */
export function moveListedTagItem(
  items: readonly TagListItem[],
  id: string,
  position: number,
  grouping: boolean,
): TagListItem[] | null {
  const listed = listedTagItems(items, grouping);
  const from = listed.findIndex((item) => item.id === id);
  if (from < 0 || position < 0 || position >= listed.length || position === from) return null;
  const reordered = [...listed];
  reordered.splice(position, 0, ...reordered.splice(from, 1));
  let next = 0;
  return items.map((item) => (listed.includes(item) ? (reordered[next++] ?? item) : item));
}

/**
 * A move in Settings (a drop, Move Up, Move Down or Move to top) as the list to save: `moveListedTagItem` over the held
 * list as `normalizeTagListItems` reads it, with every held entry that reading leaves out (a custom tag or separator
 * the selected computer's catalog lacks) kept as it is held and at its index, like a separator. The list syncs to every
 * computer, and another one may still know such an entry; a repeat of an entry already read is not kept, since it would
 * stand before the moved entry for a computer that reads the first of two. `null` when nothing moves.
 */
export function moveHeldTagItem(
  held: readonly unknown[] | null,
  catalog: GhostexCustomSessionTags | null,
  id: string,
  position: number,
  grouping: boolean,
): unknown[] | null {
  const items = normalizeTagListItems(held, catalog);
  const moved = moveListedTagItem(items, id, position, grouping);
  if (moved === null) return null;
  const stored = storedTagListItems(moved);
  if (held === null) return stored;
  const read = readHeldItems(held, catalog);
  const readIds = new Set(read.flatMap((item) => (item === null ? [] : [item.id])));
  const firstRead = read.find((item) => item !== null)?.id;
  // Each left-out entry after the read entry held before it ('' before the first one).
  const leftOut = new Map<string, unknown[]>();
  const leftOutIds = new Set<string>();
  let previous = '';
  held.forEach((raw, index) => {
    const item = read[index];
    if (item !== null && item !== undefined) {
      previous = item.id;
      return;
    }
    const heldId = typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' ? raw.id : null;
    if (heldId !== null && (readIds.has(heldId) || leftOutIds.has(heldId))) return;
    if (heldId !== null) leftOutIds.add(heldId);
    leftOut.set(previous, [...(leftOut.get(previous) ?? []), raw]);
  });
  if (leftOut.size === 0) return stored;
  // The list as read with the left-out entries in their places; the moved list fills the read entries' places in order.
  const places: ({ read: true } | { raw: unknown })[] = [];
  const keep = (anchor: string) => places.push(...(leftOut.get(anchor) ?? []).map((raw) => ({ raw })));
  for (const item of items) {
    if (item.id === firstRead) keep('');
    places.push({ read: true });
    if (readIds.has(item.id)) keep(item.id);
  }
  if (firstRead === undefined) keep('');
  let next = 0;
  return places.map((place) => ('raw' in place ? place.raw : stored[next++]));
}

/** gx-core `matches_session_filters` without the Cloud Box filter: no filter keeps every row. */
export function matchesTagFilters(tag: string | undefined, filters: readonly string[]): boolean {
  if (filters.length === 0) return true;
  return filters.includes(tag ?? UNTAGGED_TAG_FILTER);
}
