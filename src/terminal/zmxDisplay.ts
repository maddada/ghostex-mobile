/**
 * zmx client display policy for attach tabs.
 *
 * zmx sizes a session's PTY only from a client that is *displaying* it. The
 * phone tells the attach client which of the two it is with in-band sequences
 * on its stdin (zmx consumes them; they never reach the shell):
 *
 * - `ESC ] 1337 ; ZMX_VISIBLE=<rows>,<cols> BEL`: this client is displaying —
 *   take the grid at rows×cols.
 * - `ESC ] 1337 ; ZMX_HIDDEN=<rows>,<cols> BEL`: this client is not displaying;
 *   its local grid is rows×cols — hand the grid to whoever is displaying, or
 *   rest wide (200 columns).
 *
 * An entry is DISPLAYED only when its terminal view is on screen (it is the
 * selected tab, in terminal — not chat — view, on the focused Terminal screen)
 * AND the app is in the foreground. Everything else — warm background tabs, a
 * session shown in chat view, the app backgrounded — is HIDDEN. A hidden client
 * would otherwise keep the phone's narrow width as the PTY size, truncating
 * every line the chat view (on any device) reads from the terminal screen.
 *
 * Transitions:
 * - to hidden: pin the native emulator + SSH pty to 200×<current rows>
 *   (`setTerminalGrid`) and announce ZMX_HIDDEN=<rows>,200. The pin is what
 *   keeps the local grid honest: a hidden client must never receive output
 *   rendered for a width it does not have.
 * - to visible: hand sizing back to the view (`setTerminalGrid(key, 0, 0)`)
 *   and announce ZMX_VISIBLE with the real grid. If the view has not laid out
 *   yet, the announcement waits for the native `onTerminalGridChange` report;
 *   every later view-driven resize (keyboard, font size) re-announces.
 * - newly opened attach: nothing is sent until the attach has had
 *   `ATTACH_VIEWPORT_REFRESH_DELAY_MS` to start reading stdin (the same anchor
 *   the viewport refresh uses); the first announcement is whichever state the
 *   entry is in by then.
 * - closed/evicted tabs need nothing: detach handles it.
 *
 * Only `kind === 'attach'` tabs that are `open` take part; a plain shell tab
 * would just see the sequence typed into the shell.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { TerminalGrid } from '../../modules/ghostex-native/src';
import { ATTACH_VIEWPORT_REFRESH_DELAY_MS, useTerminalStore } from './sessions';

/** Width a hidden client rests at, matching zmx's resting width. */
export const ZMX_HIDDEN_COLUMNS = 200;

type DisplayState = 'visible' | 'hidden';
type Announced = { state: DisplayState; cols: number; rows: number };

/** Session key whose GhostexTerminalView is mounted on the focused Terminal screen. */
let mountedTerminalSessionKey: string | null = null;
let appState: AppStateStatus = AppState.currentState;
let installed = false;

/** Attach entries whose client has had time to start reading stdin. */
const ready = new Set<string>();
const readyTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** What was last sent to each entry, so transitions and re-announcements are deduplicated. */
const announced = new Map<string, Announced>();
/**
 * Grid the native emulator + pty are pinned to (setTerminalGrid), per entry.
 * Tracked apart from `announced`: a visible transition unpins before it can
 * announce (it may have to wait for the layout report), and a hidden
 * transition that follows must re-pin even though the last announcement is
 * still HIDDEN.
 */
const pinned = new Map<string, TerminalGrid>();
/**
 * Bumped by every `open` of an entry. A transition that was mid-flight when
 * the entry was closed or reopened under the same key must not finish its
 * sends against the replacement, whose attach client is not reading yet.
 */
const generation = new Map<string, number>();
/** Per-entry work queue: transitions and grid reports for one entry never interleave. */
const queues = new Map<string, Promise<void>>();

function isForeground(state: AppStateStatus): boolean {
  return state === 'active' || state === 'unknown';
}

function visibleSequence(grid: TerminalGrid): string {
  return `\x1b]1337;ZMX_VISIBLE=${grid.rows},${grid.cols}\x07`;
}

function hiddenSequence(grid: TerminalGrid): string {
  return `\x1b]1337;ZMX_HIDDEN=${grid.rows},${grid.cols}\x07`;
}

/** Desired state for an entry, or null when it must not be announced to at all. */
function desiredState(sessionKey: string): DisplayState | null {
  if (!ready.has(sessionKey)) return null;
  const tab = useTerminalStore.getState().tabs.find((entry) => entry.sessionKey === sessionKey);
  if (tab === undefined || tab.kind !== 'attach' || tab.state !== 'open') return null;
  return mountedTerminalSessionKey === sessionKey && isForeground(appState) ? 'visible' : 'hidden';
}

function enqueue(sessionKey: string, work: () => Promise<void>): void {
  const previous = queues.get(sessionKey) ?? Promise.resolve();
  const next = previous.then(work).catch(() => {
    // The entry went away mid-transition; the next event starts from scratch.
    announced.delete(sessionKey);
    pinned.delete(sessionKey);
  });
  queues.set(sessionKey, next);
}

async function announceVisible(sessionKey: string, grid: TerminalGrid): Promise<void> {
  const last = announced.get(sessionKey);
  if (last?.state === 'visible' && last.cols === grid.cols && last.rows === grid.rows) return;
  const opened = generation.get(sessionKey);
  await GhostexNative.sendRawInput(sessionKey, visibleSequence(grid));
  if (generation.get(sessionKey) !== opened) return;
  announced.set(sessionKey, { state: 'visible', cols: grid.cols, rows: grid.rows });
}

async function transition(sessionKey: string): Promise<void> {
  const desired = desiredState(sessionKey);
  if (desired === null) return;
  const opened = generation.get(sessionKey);
  const stale = (): boolean => generation.get(sessionKey) !== opened;
  const last = announced.get(sessionKey);
  const pin = pinned.get(sessionKey);
  if (desired === 'hidden') {
    if (last?.state === 'hidden' && pin !== undefined) return;
    const current = await GhostexNative.getTerminalGrid(sessionKey);
    if (stale() || current === null) return;
    const grid: TerminalGrid = { cols: ZMX_HIDDEN_COLUMNS, rows: current.rows };
    await GhostexNative.setTerminalGrid(sessionKey, grid.cols, grid.rows);
    if (stale()) return;
    pinned.set(sessionKey, grid);
    if (last?.state === 'hidden' && last.cols === grid.cols && last.rows === grid.rows) return;
    await GhostexNative.sendRawInput(sessionKey, hiddenSequence(grid));
    if (stale()) return;
    announced.set(sessionKey, { state: 'hidden', cols: grid.cols, rows: grid.rows });
    return;
  }
  if (last?.state === 'visible' && pin === undefined) return;
  await GhostexNative.setTerminalGrid(sessionKey, 0, 0);
  if (stale()) return;
  pinned.delete(sessionKey);
  const grid = await GhostexNative.getTerminalGrid(sessionKey);
  if (stale() || grid === null) return;
  // Still on the pinned grid means the view has no layout yet; its first
  // layout pass reports the real grid through onTerminalGridChange.
  if (pin !== undefined && grid.cols === pin.cols && grid.rows === pin.rows) return;
  await announceVisible(sessionKey, grid);
}

function reconcile(): void {
  for (const sessionKey of ready) enqueue(sessionKey, () => transition(sessionKey));
}

/** Called by the Terminal screen with the session key whose terminal view it shows. */
export function setMountedTerminalSessionKey(sessionKey: string | null): void {
  if (mountedTerminalSessionKey === sessionKey) return;
  mountedTerminalSessionKey = sessionKey;
  reconcile();
}

/** An attach entry reported `open`; announce once its client can read stdin. */
export function noteAttachOpened(sessionKey: string): void {
  forgetAttach(sessionKey);
  generation.set(sessionKey, (generation.get(sessionKey) ?? 0) + 1);
  const timer = setTimeout(() => {
    readyTimers.delete(sessionKey);
    ready.add(sessionKey);
    enqueue(sessionKey, () => transition(sessionKey));
  }, ATTACH_VIEWPORT_REFRESH_DELAY_MS);
  readyTimers.set(sessionKey, timer);
}

/** The entry closed, failed, or is being replaced by a fresh attach. */
export function forgetAttach(sessionKey: string): void {
  const timer = readyTimers.get(sessionKey);
  if (timer !== undefined) {
    clearTimeout(timer);
    readyTimers.delete(sessionKey);
  }
  ready.delete(sessionKey);
  announced.delete(sessionKey);
  pinned.delete(sessionKey);
  // Invalidate any transition still awaiting a native call for the old entry.
  generation.set(sessionKey, (generation.get(sessionKey) ?? 0) + 1);
}

/** Install once at app startup; subscriptions live for the app's life. */
export function initZmxDisplayPolicy(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (next) => {
    const changed = isForeground(next) !== isForeground(appState);
    appState = next;
    if (changed) reconcile();
  });
  GhostexNative.addListener('onTerminalGridChange', (event) => {
    enqueue(event.sessionKey, async () => {
      if (desiredState(event.sessionKey) !== 'visible') return;
      await announceVisible(event.sessionKey, { cols: event.cols, rows: event.rows });
    });
  });
}
