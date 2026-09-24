/**
 * The transcript's own view state: which rows are open, and which open rows need their detail.
 *
 * Both are drawing state, the same two things desktop keeps on its view (`expanded` / `collapsed`
 * in `native_chat/state.rs`, `detail_demand` in `row_details.rs`). Row keys follow desktop's, so the
 * details the core ships (`rowDetails`, keyed by the screen's own row key) land on the right row.
 */

import { useCallback, useSyncExternalStore } from 'react';

import type { UserAction } from '../../rust/actions';

/**
 * Open rows. A row whose default comes from verbose mode records a close against that default
 * (`collapsed`), the way desktop's `toggle_marker_disclosure` does.
 */
export class DisclosureStore {
  private readonly expanded = new Set<string>();
  private readonly collapsed = new Set<string>();
  private readonly listeners = new Map<string, Set<() => void>>();

  isOpen(key: string, openByDefault: boolean): boolean {
    return this.expanded.has(key) || (openByDefault && !this.collapsed.has(key));
  }

  /** Flip a row; `open` is what the row showed when it was pressed. */
  toggle(key: string, open: boolean): void {
    if (open) {
      this.expanded.delete(key);
      this.collapsed.add(key);
    } else {
      this.collapsed.delete(key);
      this.expanded.add(key);
    }
    this.listeners.get(key)?.forEach((listener) => listener());
  }

  subscribe(key: string, listener: () => void): () => void {
    let set = this.listeners.get(key);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(key);
    };
  }
}

/** `[open, toggle]` for one row. */
export function useDisclosure(store: DisclosureStore, key: string, openByDefault = false): [boolean, () => void] {
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key]);
  const open = useSyncExternalStore(subscribe, () => store.isOpen(key, openByDefault));
  const toggle = useCallback(() => store.toggle(key, store.isOpen(key, openByDefault)), [store, key, openByDefault]);
  return [open, toggle];
}

/** One open row that wants its detail (`OpenRowDetail` in the core's `event.rs`). */
export type OpenRow = { key: string; kind: 'tool' | 'file'; messageId: string; index: number };

/**
 * The rows currently drawn open. Rows register while they are mounted open and the set is sent as
 * one `rowDetails` action after the burst of mounts settles, only when it changed (desktop's
 * `schedule_row_detail_sync`). A row the list recycles off screen drops out, and asks again when it
 * comes back.
 */
export class RowDetailDemand {
  private readonly rows = new Map<string, { row: OpenRow; count: number }>();
  private sent = '';
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private dispatch: (action: UserAction) => void) {}

  setDispatch(dispatch: (action: UserAction) => void): void {
    this.dispatch = dispatch;
  }

  add(row: OpenRow): () => void {
    const entry = this.rows.get(row.key);
    if (entry !== undefined) entry.count += 1;
    else this.rows.set(row.key, { row, count: 1 });
    this.schedule();
    return () => {
      const current = this.rows.get(row.key);
      if (current === undefined) return;
      current.count -= 1;
      if (current.count <= 0) this.rows.delete(row.key);
      this.schedule();
    };
  }

  /** Forget what was sent, so the next change re-sends the whole set (a new core). */
  reset(): void {
    this.sent = '';
    this.schedule();
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const open = [...this.rows.values()].map((entry) => entry.row).sort((a, b) => (a.key < b.key ? -1 : 1));
      const signature = JSON.stringify(open);
      if (signature === this.sent) return;
      this.sent = signature;
      this.dispatch({ type: 'rowDetails', open });
    }, 16);
  }
}
