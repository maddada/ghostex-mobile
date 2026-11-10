/**
 * Runs the Live Activity for the app's lifetime: every change of the inventory, the machines, the
 * settings or the app's state (AppState) rebuilds the content state from the polled summaries and hands it to the
 * controller, which starts, updates or ends the activity through ActivityKit. ActivityKit starts an activity only for
 * an app in front, so the controller learns whether the app is active, and the change to active is a pass of its own:
 * an agent read in the background starts its activity when the app comes to front, also before the next read. iOS
 * only; on Android the native module does not exist and nothing is installed.
 *
 * `updateLiveActivity` applies the latest summaries after a background push refreshed them. It installs the existing
 * consumer when a background launch mounted no screen, and resolves once ActivityKit has the result.
 */

import { useMemo } from 'react';
import { AppState, Platform } from 'react-native';

import { GhostexLiveActivity } from '../../modules/ghostex-live-activity/src/GhostexLiveActivity';
import { logAppEvent } from '../app/appLog';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { useSettingsStore } from '../settings/store';
import { createActivityController, type ActivityController, type LiveActivityAdapter } from './activityController';
import {
  buildContentState,
  computersNeedingUpdate,
  workingStints,
  type ActivitySource,
  type FinishedMemory,
} from './contentState';

type NativeLiveActivity = NonNullable<typeof GhostexLiveActivity>;

/** iOS with the native module in the build (Android and older builds have none). */
export const LIVE_ACTIVITY_SUPPORTED = Platform.OS === 'ios' && GhostexLiveActivity !== null;

let installed = false;
let controller: ActivityController | null = null;
/** ActivityKit calls run one after another, in the order the controller made them. */
let queue: Promise<void> = Promise.resolve();
let pendingCalls = 0;
/** The inputs of the last pass, so the store updates of a poll that changed nothing cost nothing. */
let lastInputs: {
  sources: readonly ActivitySource[];
  enabled: boolean;
  showSessionNames: boolean;
  inFront: boolean;
} | null = null;
/** The finished events seen while the app runs (in memory: a restart forgets them). */
const finishedMemory: FinishedMemory = new Map();

function enqueue(call: () => Promise<void>): Promise<void> {
  pendingCalls += 1;
  const result = queue.then(call);
  queue = result.then(
    () => {
      pendingCalls -= 1;
    },
    () => {
      pendingCalls -= 1;
    },
  );
  return result;
}

function nativeAdapter(native: NativeLiveActivity): LiveActivityAdapter {
  return {
    hasActivity: () => (pendingCalls > 0 ? null : native.hasActivity()),
    request: ({ state, staleDate }) => enqueue(() => native.start(JSON.stringify(state), staleDate)),
    update: ({ state, staleDate }) => enqueue(() => native.update(JSON.stringify(state), staleDate)),
    end: () => enqueue(() => native.end()),
  };
}

function sourcesOf(
  machines: readonly MachineRecord[],
  inventories: Record<string, MachineInventory>,
): ActivitySource[] {
  const sources: ActivitySource[] = [];
  for (const machine of machines) {
    const inventory = inventories[machine.id];
    const summary = inventory?.summary ?? null;
    if (inventory === undefined || summary === null || inventory.loadedAt === null) continue;
    sources.push({ machineId: machine.id, summary, loadedAt: inventory.loadedAt });
  }
  return sources;
}

/** The enabled computers' summaries that were read; the widgets use the same (`widgets.ts`). */
export function currentSources(): ActivitySource[] {
  return sourcesOf(enabledMachines(useMachinesStore.getState()), useInventoryStore.getState().inventoriesByMachineId);
}

/**
 * The names of the enabled computers whose Ghostex is too old for the Live Activity, for Settings;
 * empty while every computer with agents sends what the activity needs.
 */
export function useComputersNeedingUpdate(): string[] {
  const machines = useMachinesStore((state) => state.machines);
  const inventories = useInventoryStore((state) => state.inventoriesByMachineId);
  return useMemo(() => {
    const enabled = enabledMachines({ machines });
    const outdated = new Set(computersNeedingUpdate(sourcesOf(enabled, inventories)));
    return enabled.filter((machine) => outdated.has(machine.id)).map(machineDisplayLabel);
  }, [machines, inventories]);
}

function sameInputs(
  sources: readonly ActivitySource[],
  enabled: boolean,
  showSessionNames: boolean,
  inFront: boolean,
): boolean {
  if (
    lastInputs === null ||
    lastInputs.enabled !== enabled ||
    lastInputs.showSessionNames !== showSessionNames ||
    lastInputs.inFront !== inFront ||
    lastInputs.sources.length !== sources.length
  ) {
    return false;
  }
  return sources.every((source, index) => {
    const last = lastInputs?.sources[index];
    return (
      last !== undefined &&
      last.machineId === source.machineId &&
      last.summary === source.summary &&
      last.loadedAt === source.loadedAt
    );
  });
}

/** Brings the activity in line with the latest summaries, the settings and whether the app is in front. */
function syncLiveActivity(): void {
  const settings = useSettingsStore.getState();
  // The switches are stored settings: nothing starts or ends before they are read.
  if (controller === null || !settings.hydrated) return;
  const { liveActivityEnabled: enabled, liveActivitySessionNames: showSessionNames } = settings.settings;
  const sources = currentSources();
  const inFront = AppState.currentState === 'active';
  if (sameInputs(sources, enabled, showSessionNames, inFront)) return;
  lastInputs = { sources, enabled, showSessionNames, inFront };
  const now = Date.now();
  controller.process(
    buildContentState(sources, now, finishedMemory, showSessionNames),
    workingStints(sources, now),
    enabled,
    computersNeedingUpdate(sources).length === 0,
    inFront,
  );
}

/** Install once at app startup; subscriptions live for the app's lifetime. */
export function initLiveActivity(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS !== 'ios' || GhostexLiveActivity === null) return;
  controller = createActivityController({
    adapter: nativeAdapter(GhostexLiveActivity),
    now: Date.now,
    timers: {
      setTimeout: (run, ms) => setTimeout(run, ms),
      clearTimeout: (handle) => clearTimeout(handle),
    },
    onError: logAppEvent,
  });
  useInventoryStore.subscribe(syncLiveActivity);
  useMachinesStore.subscribe(syncLiveActivity);
  useSettingsStore.subscribe(syncLiveActivity);
  AppState.addEventListener('change', syncLiveActivity);
  syncLiveActivity();
}

/**
 * Installs the existing consumer when nothing did yet and applies the summaries read last. For a background push,
 * after its session refresh; resolves once ActivityKit has the update, without reading the summaries again.
 */
export async function updateLiveActivity(): Promise<void> {
  initLiveActivity();
  syncLiveActivity();
  await queue;
}
