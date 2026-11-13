/**
 * One computer project's Beads state on the phone, shared by the Beads screen (the tree) and the
 * Bead screen opened from it: the latest snapshot, a read in flight, the last failure, and the
 * card a failed write leaves. Reads poll while either screen is open, sending the revision the
 * phone holds so an unchanged workspace answers without its rows (the desktop's `fetch_now`).
 */

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { create } from 'zustand';

import { onPairingChanged, pairingEpoch, samePairing } from '../machines/pairingEpoch';
import { findMachineRecord } from '../cloudBoxes/store';
import { BeadsUnsupportedError, readBeadsView, runBeadsAction, type BeadsActionReply, type BeadsProject } from './client';
import { mergeSnapshot, type BeadsSnapshot } from './model';

/** The desktop polls every 2s; the phone pays for each read over SSH, so a little slower. */
const POLL_MS = 4_000;

export type BeadsNotice = { title: string; message: string; details: string | null };

export type BeadsEntry = {
  snapshot: BeadsSnapshot | null;
  /** The computer's pairing epoch the snapshot was read under (machines/pairingEpoch.ts). */
  epoch: number;
  loading: boolean;
  error: string | null;
  /** The computer's Ghostex has no Beads view for the phone. */
  unsupported: boolean;
  notice: BeadsNotice | null;
  writes: number;
};

const EMPTY: BeadsEntry = { snapshot: null, epoch: -1, loading: false, error: null, unsupported: false, notice: null, writes: 0 };

type BeadsState = {
  entries: Record<string, BeadsEntry>;
  patch: (key: string, change: Partial<BeadsEntry>) => void;
};

export const useBeadsStore = create<BeadsState>()((set) => ({
  entries: {},
  patch: (key, change) =>
    set((state) => ({ entries: { ...state.entries, [key]: { ...(state.entries[key] ?? EMPTY), ...change } } })),
}));

export const beadsKey = (machineId: string, projectId: string) => `${machineId}\u0000${projectId}`;

export function useBeadsEntry(key: string): BeadsEntry {
  return useBeadsStore((state) => state.entries[key] ?? EMPTY);
}

const generations = new Map<string, number>();

/** A saved computer, or a Cloud Box's hidden machine (never saved, but its sessions have Beads too). */
function machineFor(machineId: string) {
  return findMachineRecord(machineId) ?? undefined;
}

/** Reads in flight per project, so a poll never stacks a second one and none can stay latched. */
const inFlight = new Set<string>();

/**
 * A computer paired again (another key, an edited address, removed): everything the phone read
 * from it belongs to the old pairing, so its projects' entries are emptied and their reads in
 * flight are disowned (their generation moves on).
 */
onPairingChanged((machineId) => {
  const prefix = beadsKey(machineId, '');
  const { entries, patch } = useBeadsStore.getState();
  for (const key of Object.keys(entries)) {
    if (!key.startsWith(prefix)) continue;
    generations.set(key, (generations.get(key) ?? 0) + 1);
    inFlight.delete(key);
    patch(key, { ...EMPTY, writes: 0 });
  }
});

/**
 * What an action was opened for: the workspace the screen had read and the pairing epoch that read
 * came from. A write runs only while both still hold, and gxserver gets that workspace's key,
 * never whatever the newest read says, so a write opened for one workspace or pairing can't land
 * in another.
 */
export type BeadsBinding = { workspaceKey: string; epoch: number };

export function bindingKey(binding: BeadsBinding | null): string {
  return binding !== null ? `${binding.workspaceKey}\u0000${binding.epoch}` : '';
}

/** The binding of the project's current snapshot; none when it was read under an older pairing. */
export function currentBinding(machineId: string, projectId: string): BeadsBinding | null {
  const entry = useBeadsStore.getState().entries[beadsKey(machineId, projectId)];
  const key = entry?.snapshot?.workspace.key ?? '';
  if (entry === undefined || key.length === 0 || machineFor(machineId) === undefined) return null;
  if (!samePairing(machineId, entry.epoch)) return null;
  return { workspaceKey: key, epoch: entry.epoch };
}

/** Whether `binding` still describes the project's current snapshot. */
export function bindingHolds(machineId: string, projectId: string, binding: BeadsBinding | null): boolean {
  const now = currentBinding(machineId, projectId);
  return binding !== null && now !== null && bindingKey(now) === bindingKey(binding);
}

/** The card for an action whose workspace or computer changed after it was opened. */
export const STALE_ACTION_NOTICE = (title: string): BeadsNotice => ({
  title,
  message: 'This project now uses another Beads folder, so nothing was changed. Try again on the refreshed list.',
  details: null,
});

/** One read; `refresh` asks gxserver to look for the workspace again (pull to refresh). */
export async function fetchBeads(machineId: string, project: BeadsProject, refresh = false): Promise<void> {
  const key = beadsKey(machineId, project.projectId);
  const { patch, entries } = useBeadsStore.getState();
  const machine = machineFor(machineId);
  if (machine === undefined) {
    patch(key, { error: 'This computer is no longer saved on this phone.', loading: false });
    return;
  }
  const epoch = pairingEpoch(machineId);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  inFlight.add(key);
  const owned = () => generations.get(key) === generation && samePairing(machineId, epoch);
  // The revision only means something for a snapshot read under this pairing.
  const previous = entries[key]?.epoch === epoch ? (entries[key]?.snapshot ?? null) : null;
  patch(key, { loading: true });
  try {
    const next = await readBeadsView(machine, project, {
      knownRevision: refresh ? undefined : previous?.revision,
      refresh,
    });
    // An answer for a newer read, or from before a re-pair, is not this entry's any more.
    if (!owned()) return;
    const entry = useBeadsStore.getState().entries[key];
    const current = entry?.epoch === epoch ? (entry.snapshot ?? null) : null;
    // A key change means another workspace: forget what the phone knew.
    const base = current !== null && current.workspace.key === next.workspace.key ? current : null;
    patch(key, { snapshot: mergeSnapshot(base, next), epoch, loading: false, error: null, unsupported: false });
  } catch (failure) {
    if (!owned()) return;
    if (failure instanceof BeadsUnsupportedError) {
      patch(key, { unsupported: true, loading: false, error: null });
      return;
    }
    patch(key, { loading: false, error: failure instanceof Error ? failure.message : String(failure) });
  } finally {
    // Only the newest read clears the marks; a disowned one never leaves them set.
    if (generations.get(key) === generation) {
      inFlight.delete(key);
      if (useBeadsStore.getState().entries[key]?.loading === true) patch(key, { loading: false });
    }
  }
}

/** Polls while a screen showing this project is open; several screens share one poll. */
const watchers = new Map<string, { count: number; timer: ReturnType<typeof setInterval> }>();

/**
 * Polls while `active` (the screen is focused and the app in the foreground); several screens
 * share one poll, and a screen under another one, or the app in the background, polls nothing.
 */
export function useBeadsPolling(machineId: string, project: BeadsProject): void {
  const { projectId, projectPath } = project;
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => subscription.remove();
  }, []);
  const active = focused && foreground;
  useEffect(() => {
    if (!active) return undefined;
    const key = beadsKey(machineId, projectId);
    const target = { projectId, projectPath };
    const existing = watchers.get(key);
    if (existing !== undefined) {
      existing.count += 1;
    } else {
      void fetchBeads(machineId, target);
      watchers.set(key, {
        count: 1,
        timer: setInterval(() => {
          if (!inFlight.has(key)) void fetchBeads(machineId, target);
        }, POLL_MS),
      });
    }
    return () => {
      const watcher = watchers.get(key);
      if (watcher === undefined) return;
      watcher.count -= 1;
      if (watcher.count <= 0) {
        clearInterval(watcher.timer);
        watchers.delete(key);
      }
    };
  }, [active, machineId, projectId, projectPath]);
}

/** A failed write's card, in the desktop's words (`native_beads/cards.rs` `write_failure`). */
function writeFailure(title: string, reply: BeadsActionReply): BeadsNotice {
  const lower = reply.output.toLowerCase();
  let message = 'Beads refused the change. Details has what it said.';
  if (reply.code === 'workspaceChanged') {
    message = 'This project now uses another Beads folder, so nothing was changed. Try again on the refreshed list.';
  } else if (lower.includes('already claimed')) {
    message = 'Someone else has claimed it. Refresh to see who.';
  } else if (lower.includes('no issue found') || lower.includes('not found')) {
    message = 'It was deleted or renamed elsewhere. Refresh to see the current list.';
  } else if (reply.code === 'timeout') {
    message = 'Beads stayed busy. Try again in a moment.';
  } else if (reply.message.length > 0 && reply.output.length === 0) {
    message = reply.message;
  }
  return { title, message, details: reply.output.length > 0 ? reply.output : null };
}

/**
 * One write (or `show`) for this project, bound to the workspace and pairing it was opened for
 * (`binding`). When either changed since, nothing is sent and the write leaves a card; a write
 * without a read workspace is never sent. A failure leaves a card; every write reads again.
 */
export async function runBeads(
  machineId: string,
  project: BeadsProject,
  params: Record<string, unknown>,
  failureTitle: string,
  binding: BeadsBinding | null,
): Promise<BeadsActionReply | null> {
  const key = beadsKey(machineId, project.projectId);
  const { patch } = useBeadsStore.getState();
  const machine = machineFor(machineId);
  const isWrite = params.action !== 'show';
  if (machine === undefined || binding === null || !bindingHolds(machineId, project.projectId, binding)) {
    if (isWrite) patch(key, { notice: STALE_ACTION_NOTICE(failureTitle) });
    return null;
  }
  const entry = useBeadsStore.getState().entries[key] ?? EMPTY;
  if (isWrite) patch(key, { writes: entry.writes + 1, notice: null });
  // A re-pair while the call runs empties the entry and starts it over; this call then owns
  // nothing there, and its answer, card and write count must not touch the new one.
  const owned = () => samePairing(machineId, binding.epoch);
  try {
    const reply = await runBeadsAction(machine, project, params, binding.workspaceKey);
    if (!owned()) return null;
    if (isWrite && !reply.ok) patch(key, { notice: writeFailure(failureTitle, reply) });
    return reply;
  } catch (failure) {
    if (!owned()) return null;
    if (failure instanceof BeadsUnsupportedError) {
      patch(key, { notice: { title: failureTitle, message: 'Update Ghostex on that computer to change beads from the phone.', details: null } });
    } else if (isWrite) {
      patch(key, { notice: { title: failureTitle, message: failure instanceof Error ? failure.message : String(failure), details: null } });
    }
    return null;
  } finally {
    if (isWrite && owned()) {
      const writes = useBeadsStore.getState().entries[key]?.writes ?? 1;
      patch(key, { writes: Math.max(0, writes - 1) });
      void fetchBeads(machineId, project);
    }
  }
}

export function dismissBeadsNotice(machineId: string, projectId: string): void {
  useBeadsStore.getState().patch(beadsKey(machineId, projectId), { notice: null });
}
