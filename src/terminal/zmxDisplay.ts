/**
 * CDXC:Zmx 2026-09-05 WHY:
 * A foreground, focused, selected terminal reports ZMX_VISIBLE and owns its real grid.
 * The same on-screen slot in chat mode reports ZMX_CHAT, claiming a wide resting grid only when no terminal is visible.
 * Background tabs, screens and apps report ZMX_HIDDEN (parked), retaining the daemon grid when no chat claim exists.
 * Both non-visible states pin the local emulator and SSH PTY to 200 columns because another client's chat may widen the daemon.
 * Announcements wait for attach readiness; visible transitions unpin and wait for a real layout grid.
 * Only open attach tabs participate. Raw input avoids iOS bracketed-paste wrapping.
 * SEE-ALSO: .dependencies/zmx/src/loop.zig, apps/desktop/src/terminal_model.rs, server/src/terminal_ws.rs, apps/web/src/terminal/session-terminal.tsx.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { TerminalGrid } from '../../modules/ghostex-native/src';
import { ATTACH_VIEWPORT_REFRESH_DELAY_MS, useTerminalStore } from './sessions';

/** Width a hidden client rests at, matching zmx's resting width. */
export const ZMX_HIDDEN_COLUMNS = 200;

type DisplayState = 'visible' | 'chat' | 'parked';
type Announced = { state: DisplayState; cols: number; rows: number };

/** Session key whose GhostexTerminalView is mounted on the focused Terminal screen. */
let mountedTerminalSessionKey: string | null = null;
let mountedChatSessionKey: string | null = null;
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

function parkedSequence(state: 'chat' | 'parked', grid: TerminalGrid): string {
  const body = state === 'chat' ? 'ZMX_CHAT' : 'ZMX_HIDDEN';
  return `\x1b]1337;${body}=${grid.rows},${grid.cols}\x07`;
}

/** Desired state for an entry, or null when it must not be announced to at all. */
function desiredState(sessionKey: string): DisplayState | null {
  if (!ready.has(sessionKey)) return null;
  const tab = useTerminalStore.getState().tabs.find((entry) => entry.sessionKey === sessionKey);
  if (tab === undefined || tab.kind !== 'attach' || tab.state !== 'open') return null;
  if (!isForeground(appState)) return 'parked';
  if (mountedTerminalSessionKey === sessionKey) return 'visible';
  return mountedChatSessionKey === sessionKey ? 'chat' : 'parked';
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
  if (desired !== 'visible') {
    if (last?.state === desired && pin !== undefined) return;
    const current = await GhostexNative.getTerminalGrid(sessionKey);
    if (stale() || current === null) return;
    const grid: TerminalGrid = { cols: ZMX_HIDDEN_COLUMNS, rows: current.rows };
    await GhostexNative.setTerminalGrid(sessionKey, grid.cols, grid.rows);
    if (stale()) return;
    pinned.set(sessionKey, grid);
    if (last?.state === desired && last.cols === grid.cols && last.rows === grid.rows) return;
    await GhostexNative.sendRawInput(sessionKey, parkedSequence(desired, grid));
    if (stale()) return;
    announced.set(sessionKey, { state: desired, cols: grid.cols, rows: grid.rows });
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
export function setMountedSessionKeys(terminalKey: string | null, chatKey: string | null): void {
  if (mountedTerminalSessionKey === terminalKey && mountedChatSessionKey === chatKey) return;
  mountedTerminalSessionKey = terminalKey;
  mountedChatSessionKey = chatKey;
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
