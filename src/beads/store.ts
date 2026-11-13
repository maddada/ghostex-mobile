/**
 * One computer project's Beads state on the phone, shared by the Beads screen (the tree) and the
 * Bead screen opened from it: the latest snapshot, a read in flight, the last failure, and the
 * card a failed write leaves. Reads poll while either screen is open, sending the revision the
 * phone holds so an unchanged workspace answers without its rows (the desktop's `fetch_now`).
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import { useMachinesStore } from '../machines/store';
import { BeadsUnsupportedError, readBeadsView, runBeadsAction, type BeadsActionReply, type BeadsProject } from './client';
import { mergeSnapshot, type BeadsSnapshot } from './model';

/** The desktop polls every 2s; the phone pays for each read over SSH, so a little slower. */
const POLL_MS = 4_000;

export type BeadsNotice = { title: string; message: string; details: string | null };

export type BeadsEntry = {
  snapshot: BeadsSnapshot | null;
  loading: boolean;
  error: string | null;
  /** The computer's Ghostex has no Beads view for the phone. */
  unsupported: boolean;
  notice: BeadsNotice | null;
  writes: number;
};

const EMPTY: BeadsEntry = { snapshot: null, loading: false, error: null, unsupported: false, notice: null, writes: 0 };

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

function machineFor(machineId: string) {
  return useMachinesStore.getState().machines.find((candidate) => candidate.id === machineId);
}

/** One read; `refresh` asks gxserver to look for the workspace again (pull to refresh). */
export async function fetchBeads(machineId: string, project: BeadsProject, refresh = false): Promise<void> {
  const key = beadsKey(machineId, project.projectId);
  const { patch, entries } = useBeadsStore.getState();
  const machine = machineFor(machineId);
  if (machine === undefined) {
    patch(key, { error: 'This computer is no longer saved on this phone.', loading: false });
    return;
  }
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const previous = entries[key]?.snapshot ?? null;
  patch(key, { loading: true });
  try {
    const next = await readBeadsView(machine, project, {
      knownRevision: refresh ? undefined : previous?.revision,
      refresh,
    });
    if (generations.get(key) !== generation) return;
    const current = useBeadsStore.getState().entries[key]?.snapshot ?? null;
    // A key change means another workspace: forget what the phone knew.
    const base = current !== null && current.workspace.key === next.workspace.key ? current : null;
    patch(key, { snapshot: mergeSnapshot(base, next), loading: false, error: null, unsupported: false });
  } catch (failure) {
    if (generations.get(key) !== generation) return;
    if (failure instanceof BeadsUnsupportedError) {
      patch(key, { unsupported: true, loading: false, error: null });
      return;
    }
    patch(key, { loading: false, error: failure instanceof Error ? failure.message : String(failure) });
  }
}

/** Polls while a screen showing this project is open; several screens share one poll. */
const watchers = new Map<string, { count: number; timer: ReturnType<typeof setInterval> }>();

export function useBeadsPolling(machineId: string, project: BeadsProject): void {
  const { projectId, projectPath } = project;
  useEffect(() => {
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
          if (useBeadsStore.getState().entries[key]?.loading !== true) void fetchBeads(machineId, target);
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
  }, [machineId, projectId, projectPath]);
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
 * One write (or `show`) for this project, sent with the workspace key the phone last read. A
 * failure leaves a card on the screen; every write reads the snapshot again.
 */
export async function runBeads(
  machineId: string,
  project: BeadsProject,
  params: Record<string, unknown>,
  failureTitle: string,
): Promise<BeadsActionReply | null> {
  const key = beadsKey(machineId, project.projectId);
  const { patch } = useBeadsStore.getState();
  const machine = machineFor(machineId);
  if (machine === undefined) return null;
  const isWrite = params.action !== 'show';
  const entry = useBeadsStore.getState().entries[key] ?? EMPTY;
  if (isWrite) patch(key, { writes: entry.writes + 1, notice: null });
  try {
    const reply = await runBeadsAction(machine, project, params, entry.snapshot?.workspace.key ?? null);
    if (isWrite && !reply.ok) patch(key, { notice: writeFailure(failureTitle, reply) });
    return reply;
  } catch (failure) {
    if (failure instanceof BeadsUnsupportedError) {
      patch(key, { notice: { title: failureTitle, message: 'Update Ghostex on that computer to change beads from the phone.', details: null } });
    } else if (isWrite) {
      patch(key, { notice: { title: failureTitle, message: failure instanceof Error ? failure.message : String(failure), details: null } });
    }
    return null;
  } finally {
    if (isWrite) {
      const writes = useBeadsStore.getState().entries[key]?.writes ?? 1;
      patch(key, { writes: Math.max(0, writes - 1) });
      void fetchBeads(machineId, project);
    }
  }
}

export function dismissBeadsNotice(machineId: string, projectId: string): void {
  useBeadsStore.getState().patch(beadsKey(machineId, projectId), { notice: null });
}
