/**
 * The Unified sidebar's hover strip as the phone's swipe buttons follow it: the actions right of the
 * chevron, the ones the desktop shows at rest, in the user's order. The rest stay in the long-press
 * menu, since a swipe has no chevron. (`sidebar_menu/hover.rs` on the desktop.)
 */

export type UnifiedSwipeAction = 'snooze' | 'park' | 'sleep';

/** `unified_default_hover_buttons`. */
const DEFAULT_AFTER_CHEVRON: readonly string[] = ['snooze', 'park', 'close'];

export function unifiedSwipeActions(setting: unknown, parking: boolean): UnifiedSwipeAction[] {
  let after: readonly string[] = DEFAULT_AFTER_CHEVRON;
  if (Array.isArray(setting)) {
    const entries = setting.filter(
      (entry): entry is { id: string; enabled?: unknown } =>
        typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string',
    );
    const chevron = entries.findIndex((entry) => entry.id === 'chevron' && entry.enabled === true);
    after = entries
      .slice(chevron + 1)
      .filter((entry) => entry.enabled === true && entry.id !== 'chevron')
      .map((entry) => entry.id);
  }
  return after.filter(
    (id): id is UnifiedSwipeAction =>
      id === 'snooze' || id === 'sleep' || (id === 'park' && parking),
  );
}
