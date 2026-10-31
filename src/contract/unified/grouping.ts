/**
 * Group by Project: every computer's sessions of one repository under one header, with that
 * project's own shelves inside it, in the order the user arranged.
 *
 * A port of packages/gx-core/src/unified_sidebar/grouping.rs, held to it by `unifiedFixture.json`.
 */

import type { UnifiedFilterOption, UnifiedRow, UnifiedView } from './build';

export type UnifiedGroup<S = unknown> = {
  repoKey: string;
  label: string;
  detail: string | null;
  pinned: UnifiedRow<S>[];
  active: UnifiedRow<S>[];
  working: UnifiedRow<S>[];
  snoozed: UnifiedRow<S>[];
  parked: UnifiedRow<S>[];
};

export function unifiedGroupCount(group: UnifiedGroup): number {
  return group.pinned.length + group.active.length + group.working.length + group.snoozed.length + group.parked.length;
}

/** The desktop compares lowercased labels by code point (Rust `str::cmp` on `to_lowercase`). */
function byCodePoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The saved order first, then repositories it has not met, A to Z. */
export function orderedRepoKeys(options: readonly UnifiedFilterOption[], order: readonly string[]): string[] {
  const place = new Map<string, number>();
  order.forEach((key, index) => {
    if (!place.has(key)) place.set(key, index);
  });
  return [...options]
    .sort((left, right) => {
      const leftPlace = place.get(left.key);
      const rightPlace = place.get(right.key);
      if (leftPlace !== undefined && rightPlace !== undefined) return leftPlace - rightPlace;
      if (leftPlace !== undefined) return -1;
      if (rightPlace !== undefined) return 1;
      return (
        byCodePoint(left.label.toLowerCase(), right.label.toLowerCase()) || byCodePoint(left.key, right.key)
      );
    })
    .map((option) => option.key);
}

/** Puts a list's rows under their projects' headers. A project with nothing kept draws no header. */
export function groupUnifiedList<S>(view: UnifiedView<S>, order: readonly string[]): UnifiedGroup<S>[] {
  const groups = new Map<string, UnifiedGroup<S>>();
  for (const shelf of ['pinned', 'active', 'working', 'snoozed', 'parked'] as const) {
    for (const row of view[shelf]) {
      let group = groups.get(row.repo.key);
      if (group === undefined) {
        group = { repoKey: row.repo.key, label: '', detail: null, pinned: [], active: [], working: [], snoozed: [], parked: [] };
        groups.set(row.repo.key, group);
      }
      group[shelf].push(row);
    }
  }
  const list: UnifiedGroup<S>[] = [];
  for (const key of orderedRepoKeys(view.options.repos, order)) {
    const group = groups.get(key);
    const option = view.options.repos.find((candidate) => candidate.key === key);
    if (group === undefined || option === undefined) continue;
    group.label = option.label;
    group.detail = option.detail;
    list.push(group);
  }
  return list;
}

/** The whole order written out after a header moves, so what is off screen keeps its place. */
export function moveUnifiedProject(
  order: readonly string[],
  all: readonly UnifiedFilterOption[],
  moved: string,
  target: string,
  after: boolean,
): string[] {
  const keys = [...order];
  for (const key of orderedRepoKeys(all, order)) {
    if (!keys.includes(key)) keys.push(key);
  }
  if (moved === target || !keys.includes(target)) return keys;
  const without = keys.filter((key) => key !== moved);
  const at = without.indexOf(target);
  without.splice(at < 0 ? without.length : at + (after ? 1 : 0), 0, moved);
  return without;
}
