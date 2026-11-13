/**
 * Project icons by ref: a summary asked with `--icon-refs` names each project's discovered icon by a content ref
 * instead of carrying the picture, and the phone fetches each picture once and keeps it here.
 *
 * CDXC:RemoteMachines 2026-11-13 WHY:
 * The Sessions list is read every 5 s over SSH, and on a computer with many projects the icons were about 80% of it
 * (322 KB of a 411 KB list), which kept the link busy enough that other commands waited behind it. A computer whose
 * Ghostex predates refs still sends the pictures and nothing is fetched.
 * - Rows read pictures through this store, so a picture that arrives repaints its row even when the next summary is
 *   unchanged and the inventory store skips it (inventory/store.ts keeps a summary whose text did not change).
 * - Bounded: 200 pictures and 2 MB kept (oldest dropped first), at most 8 refs asked per read.
 * - A fetch that comes back after a re-pair is dropped, and only refs still in the computer's current list are kept.
 * - A ref the computer cannot resolve (its icon changed between the list and the fetch) waits 1, then 5, then 30
 *   minutes before it is asked again, so it is not fetched on every poll.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { projectIconsCommand } from '../commands/ghostexCli';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import type { MachineConnectionTarget } from '../machines/credentials';
import { pairingEpoch, samePairing } from '../machines/pairingEpoch';
import { execRemoteCommand } from '../remote/commands';
import { scanJsonObjects } from '../contract/mobileSummary/jsonScan';

const STORAGE_KEY = 'projectIcons.v1';
const MAX_ICONS = 200;
const MAX_CHARS = 2_000_000;
const BATCH_SIZE = 8;
const FETCH_TIMEOUT_MS = 20_000;
const MISSING_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];

type IconsState = { byRef: Record<string, string> };

/** Pictures by ref, newest last (insertion order is the age order). */
export const useProjectIcons = create<IconsState>(() => ({ byRef: {} }));

const missing = new Map<string, { attempt: number; until: number }>();
const inFlight = new Set<string>();
let hydration: Promise<void> | null = null;

/** Reads the kept pictures once per run (the app's start, or the first summary that names refs). */
export function hydrateProjectIcons(): Promise<void> {
  hydration ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((text) => {
      const parsed: unknown = text === null ? null : JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) return;
      const stored: Record<string, string> = {};
      for (const [ref, url] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof url === 'string') stored[ref] = url;
      }
      useProjectIcons.setState((state) => ({ byRef: bounded({ ...stored, ...state.byRef }) }));
    })
    .catch(() => undefined);
  return hydration;
}

function bounded(byRef: Record<string, string>): Record<string, string> {
  const entries = Object.entries(byRef);
  let chars = 0;
  let keepFrom = Math.max(0, entries.length - MAX_ICONS);
  for (let index = entries.length - 1; index >= keepFrom; index -= 1) {
    chars += entries[index]![1].length;
    if (chars > MAX_CHARS) {
      keepFrom = index + 1;
      break;
    }
  }
  return Object.fromEntries(entries.slice(keepFrom));
}

function save(): void {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(useProjectIcons.getState().byRef)).catch(() => undefined);
}

/** The refs a summary names, in list order. */
export function summaryIconRefs(summary: GhostexMobileSummary): string[] {
  const refs: string[] = [];
  for (const project of summary.projects) {
    const ref = project.icon.discoveredIconRef;
    if (ref.length > 0 && !refs.includes(ref)) refs.push(ref);
  }
  return refs;
}

/**
 * Fetches the pictures a freshly read summary names and the phone does not hold yet, one batch per read.
 * `currentRefs` answers what the computer's list names when the fetch comes back.
 */
export function loadSummaryIcons(
  machine: MachineConnectionTarget,
  summary: GhostexMobileSummary,
  currentRefs: () => readonly string[],
): void {
  const refs = summaryIconRefs(summary);
  if (refs.length === 0) return;
  void hydrateProjectIcons().then(() => fetchMissing(machine, refs, currentRefs));
}

async function fetchMissing(
  machine: MachineConnectionTarget,
  refs: readonly string[],
  currentRefs: () => readonly string[],
): Promise<void> {
  const now = Date.now();
  const held = useProjectIcons.getState().byRef;
  // Never more than the cache keeps: past that, fetching would only evict what the last fetch stored.
  const wanted = refs
    .slice(0, MAX_ICONS)
    .filter((ref) => held[ref] === undefined && !inFlight.has(ref) && (missing.get(ref)?.until ?? 0) <= now)
    .slice(0, BATCH_SIZE);
  if (wanted.length === 0) return;
  const epoch = pairingEpoch(machine.id);
  for (const ref of wanted) inFlight.add(ref);
  try {
    const result = await execRemoteCommand(machine.id, projectIconsCommand(wanted), FETCH_TIMEOUT_MS);
    if (!samePairing(machine.id, epoch) || result.exitCode !== 0) return;
    const icons = readIcons(result.stdout);
    const current = new Set(currentRefs());
    const fresh: Record<string, string> = {};
    for (const ref of wanted) {
      // An answer without `icons` resolves nothing: every ref asked waits out the back-off like a missing one.
      const url = icons?.[ref];
      if (typeof url === 'string' && url.startsWith('data:')) {
        missing.delete(ref);
        if (current.has(ref)) fresh[ref] = url;
      } else {
        const attempt = (missing.get(ref)?.attempt ?? -1) + 1;
        const delay = MISSING_BACKOFF_MS[Math.min(attempt, MISSING_BACKOFF_MS.length - 1)]!;
        missing.set(ref, { attempt, until: Date.now() + delay });
      }
    }
    if (Object.keys(fresh).length === 0) return;
    useProjectIcons.setState((state) => ({ byRef: bounded({ ...state.byRef, ...fresh }) }));
    save();
  } catch {
    // The next read asks again; a busy or dropped link says so through the list itself.
  } finally {
    for (const ref of wanted) inFlight.delete(ref);
  }
}

/**
 * The `icons` object of the answer: the CLI prints pretty JSON over several lines, after whatever the login shell
 * printed, so the last complete object holding `icons` is the answer. Null when there is none (a Ghostex that
 * cannot resolve refs prints its plain list instead).
 */
function readIcons(stdout: string): Record<string, unknown> | null {
  let icons: Record<string, unknown> | null = null;
  scanJsonObjects<null>(`${stdout}`, (text, start) => {
    try {
      const parsed = JSON.parse(text) as { icons?: unknown };
      if (typeof parsed.icons === 'object' && parsed.icons !== null && !Array.isArray(parsed.icons)) {
        icons = parsed.icons as Record<string, unknown>;
      }
    } catch {
      // not the answer
    }
    return { done: false, nextIndex: start + text.length };
  });
  return icons;
}

/** The picture a project icon shows from its repository: the one the summary carried, else the one kept by ref. */
export function useDiscoveredIconUri(icon: { discoveredIconDataUrl: string; discoveredIconRef: string }): string {
  const kept = useProjectIcons((state) =>
    icon.discoveredIconRef.length > 0 ? (state.byRef[icon.discoveredIconRef] ?? '') : '',
  );
  return icon.discoveredIconDataUrl.length > 0 ? icon.discoveredIconDataUrl : kept;
}

/** Whether a project icon has a repository picture now (carried or kept). */
export function hasDiscoveredIcon(icon: { discoveredIconDataUrl: string; discoveredIconRef: string }): boolean {
  if (icon.discoveredIconDataUrl.length > 0) return true;
  return icon.discoveredIconRef.length > 0 && useProjectIcons.getState().byRef[icon.discoveredIconRef] !== undefined;
}
