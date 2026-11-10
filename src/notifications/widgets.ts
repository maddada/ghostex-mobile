/**
 * Runs the Home Screen widgets' writer for the app's lifetime: every change of the inventory (each summary refresh),
 * of the machines or of the settings (the "Show session names" switch) brings the App Group snapshot in line and,
 * when it changed, asks WidgetKit to reload the widgets (`widgetWriter.ts`). iOS only; on Android the native module
 * does not exist and nothing is installed.
 *
 * `updateWidgets` applies the latest summaries after a background push refreshed them, beside `updateLiveActivity`.
 * It installs the existing writer when a background launch mounted no screen and resolves after its write/reload.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { GhostexWidgets } from '../../modules/ghostex-widgets/src/GhostexWidgets';
import { logAppEvent } from '../app/appLog';
import { wasmCoreBridge } from '../chat/rust/wasm-core/bridge';
import { useInventoryStore } from '../inventory/store';
import { selectedMachine, useMachinesStore } from '../machines/store';
import { machineTargetFor } from '../screens/terminal-screen/session-lookups';
import { useSettingsStore } from '../settings/store';
import { readAccountsAnswer } from '../usage/client';
import { buildUsageBars } from '../usage/usageMeters';
import { currentSources } from './liveActivity';
import { createWidgetWriter, type NamesRecord, type WidgetInputs, type WidgetWriter } from './widgetWriter';

let installed = false;
let writer: WidgetWriter | null = null;

/** Where the writer's record is stored: '1' while the snapshot in the App Group may carry session names. */
const NAMES_RECORD_KEY = 'widgets.snapshotMayHoldNames.v1';
/**
 * What is known of that record; null until the read answered. A read that fails leaves it `unknown`: the file may
 * carry names, but '1' is not known to be stored, so the writer stores it before it writes names.
 */
let namesRecord: NamesRecord | null = null;
/** Resolves once the record was read and the widgets were brought in line with it. */
let namesRecordRead: Promise<void> = Promise.resolve();

/**
 * Null until the saved computers, the settings and the names record are loaded: before that, no computer would
 * read as the last one removed, a "Show session names" switched off would read as its default and put the names
 * into the snapshot, and a snapshot that carries names would read as free of them.
 */
function currentInputs(): WidgetInputs | null {
  const machines = useMachinesStore.getState();
  const settings = useSettingsStore.getState();
  if (!machines.hydrated || !settings.hydrated || namesRecord === null) return null;
  return {
    computersSaved: machines.machines.length > 0,
    sources: currentSources(),
    selectedMachineId: selectedMachine(machines)?.id ?? null,
    polling: useInventoryStore.getState().polling,
    showSessionNames: settings.settings.liveActivitySessionNames,
  };
}

function syncWidgets(): Promise<void> {
  const inputs = currentInputs();
  return writer === null || inputs === null ? Promise.resolve() : writer.sync(inputs);
}

/** Install once at app startup; subscriptions live for the app's lifetime. */
export function initWidgets(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS !== 'ios' || GhostexWidgets === null) return;
  const native = GhostexWidgets;
  writer = createWidgetWriter({
    host: {
      write: (json) => native.writeSnapshot(json),
      remove: () => native.removeSnapshot(),
      reloadTimelines: () => native.reloadTimelines(),
      namesRecord: () => namesRecord ?? 'unknown',
      rememberNames: async (mayHold) => {
        await AsyncStorage.setItem(NAMES_RECORD_KEY, mayHold ? '1' : '0');
        namesRecord = mayHold ? 'names' : 'none';
      },
    },
    now: Date.now,
    readUsageBars: async (machineId) => {
      const machine = machineTargetFor(machineId);
      if (machine === null) return [];
      const answer = await readAccountsAnswer(machine, false);
      const columns = await wasmCoreBridge.call({
        op: 'accountUsageColumns',
        args: [JSON.stringify(answer), Date.now()],
      });
      return buildUsageBars(answer, columns);
    },
    onError: logAppEvent,
  });
  useInventoryStore.subscribe(() => void syncWidgets());
  useMachinesStore.subscribe(() => void syncWidgets());
  // Of the settings only these two reach the snapshot; any other change would rebuild it to write nothing.
  useSettingsStore.subscribe((state, previous) => {
    if (
      state.hydrated !== previous.hydrated ||
      state.settings.liveActivitySessionNames !== previous.settings.liveActivitySessionNames
    ) {
      void syncWidgets();
    }
  });
  namesRecordRead = AsyncStorage.getItem(NAMES_RECORD_KEY)
    .then(
      (stored) => {
        namesRecord = stored === '1' ? 'names' : 'none';
      },
      () => {
        namesRecord = 'unknown';
      },
    )
    .then(syncWidgets);
}

/** Installs the existing writer and applies the summaries read last; resolves after the snapshot write and reload. */
export async function updateWidgets(): Promise<void> {
  initWidgets();
  await namesRecordRead;
  await syncWidgets();
}
