/**
 * Dictate's settings on a computer, read and written through that computer's gxserver
 * (`dictateModel.ts` has the shapes): the store behind Settings › Voice and its Language and
 * Dictionary pages, which all edit the computer picked at the top of Settings › Voice. While a
 * model downloads the store polls `/api/listSpeechModels` every half second, as the contract asks.
 */

import { create } from 'zustand';

import { chatMachineLink } from '../chat/rust/machine-link';
import { isDemoMachine } from '../demo/identity';
import type { MachineConnectionTarget } from '../machines/credentials';
import {
  isUnknownRoute,
  modelsBusy,
  type DictateEngine,
  type DictateOverview,
  type DictateSettings,
  type SpeechModel,
} from './dictateModel';

const READ_TIMEOUT_MS = 15_000;
const POLL_MS = 500;

type Answer<T> = { ok: true; value: T } | { ok: false; message: string; outdated: boolean };

async function call<T>(machine: MachineConnectionTarget, method: string, params: unknown): Promise<Answer<T>> {
  if (isDemoMachine(machine)) {
    return { ok: false, message: 'Voice needs a real computer. The demo stays on this phone.', outdated: false };
  }
  try {
    const answer = await chatMachineLink(machine).rpc(method, params, READ_TIMEOUT_MS);
    if (answer.error !== null)
      return { ok: false, message: answer.error.message, outdated: isUnknownRoute(answer.error) };
    return { ok: true, value: (answer.result ?? {}) as T };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Couldn't reach Ghostex on your computer.",
      outdated: false,
    };
  }
}

/** What will transcribe on `machine` (cheap: gxserver scans no disk), or null when it can't say. */
export async function readDictateEngine(machine: MachineConnectionTarget): Promise<DictateEngine | null> {
  const answer = await call<DictateEngine>(machine, 'readDictateEngine', {});
  return answer.ok && typeof answer.value.label === 'string' ? answer.value : null;
}

/** The computer's models (download progress included). */
export async function listSpeechModels(machine: MachineConnectionTarget): Promise<SpeechModel[] | null> {
  const answer = await call<{ models?: SpeechModel[] }>(machine, 'listSpeechModels', {});
  return answer.ok && Array.isArray(answer.value.models) ? answer.value.models : null;
}

/** Starts (or resumes) a model's download on the computer; answers an error sentence, or null. */
export async function downloadSpeechModel(machine: MachineConnectionTarget, id: string): Promise<string | null> {
  const answer = await call(machine, 'downloadSpeechModel', { id });
  return answer.ok ? null : answer.message;
}

/** The reader pressed Skip while the text was being polished. */
export async function skipDictationPolish(machine: MachineConnectionTarget, id: string): Promise<void> {
  await call(machine, 'skipDictationPolish', { id });
}

export type DictateStatus = 'loading' | 'ready' | 'failed' | 'outdated';

type DictateState = {
  /** The computer Settings › Voice changes; null until picked (the selected computer then). */
  machineId: string | null;
  /** The computer the overview below belongs to. */
  loadedFor: string | null;
  overview: DictateOverview | null;
  status: DictateStatus;
  /** Why the last read or change failed, in a sentence. */
  problem: string | null;
};

export const useDictateStore = create<DictateState>(() => ({
  machineId: null,
  loadedFor: null,
  overview: null,
  status: 'loading',
  problem: null,
}));

/** Picks the computer Settings › Voice changes (its picker, or Dictate's "Voice settings"). */
export function chooseVoiceComputer(machineId: string): void {
  if (useDictateStore.getState().machineId === machineId) return;
  useDictateStore.setState({ machineId, loadedFor: null, overview: null, status: 'loading', problem: null });
}

const current = (machine: MachineConnectionTarget) => useDictateStore.getState().loadedFor === machine.id;

/** Reads everything Settings › Voice draws for `machine`. */
export async function loadDictate(machine: MachineConnectionTarget, quiet = false): Promise<void> {
  if (!quiet || !current(machine))
    useDictateStore.setState({ loadedFor: machine.id, status: 'loading', problem: null, overview: null });
  const answer = await call<DictateOverview>(machine, 'readDictateSettings', {});
  if (!current(machine)) return;
  if (!answer.ok) {
    if (quiet && useDictateStore.getState().overview !== null) return;
    useDictateStore.setState({
      status: answer.outdated ? 'outdated' : 'failed',
      problem: answer.message,
    });
    return;
  }
  useDictateStore.setState({ overview: answer.value, status: 'ready', problem: null });
  if (modelsBusy(answer.value.models)) pollModels(machine);
}

/**
 * Saves a change on the computer. The page shows it at once and goes back to the computer's
 * answer (or the old value, with the reason) when it comes.
 */
export async function changeDictate(machine: MachineConnectionTarget, patch: Partial<DictateSettings>): Promise<void> {
  const before = useDictateStore.getState().overview;
  if (before === null || !current(machine)) return;
  const settings = {
    ...before.settings,
    ...patch,
    polish: { ...before.settings.polish, ...(patch.polish ?? {}) },
  };
  useDictateStore.setState({ overview: { ...before, settings }, problem: null });
  const answer = await call<DictateOverview>(machine, 'setDictateSettings', { patch });
  if (!current(machine)) return;
  if (!answer.ok) {
    useDictateStore.setState({
      overview: before,
      problem: `Couldn't save it on your computer: ${answer.message}`,
    });
    return;
  }
  useDictateStore.setState({ overview: answer.value });
  if (modelsBusy(answer.value.models)) pollModels(machine);
}

/** Puts one model's new view in the overview. */
function replaceModel(model: SpeechModel): void {
  const overview = useDictateStore.getState().overview;
  if (overview === null) return;
  useDictateStore.setState({
    overview: { ...overview, models: overview.models.map((entry) => (entry.id === model.id ? model : entry)) },
  });
}

async function modelAction(
  machine: MachineConnectionTarget,
  method: 'downloadSpeechModel' | 'cancelSpeechModelDownload' | 'deleteSpeechModel',
  id: string,
  failure: string,
): Promise<void> {
  const answer = await call<{ model?: SpeechModel }>(machine, method, { id });
  if (!current(machine)) return;
  if (!answer.ok) {
    useDictateStore.setState({ problem: `${failure}: ${answer.message}` });
    return;
  }
  useDictateStore.setState({ problem: null });
  if (answer.value.model) replaceModel(answer.value.model);
  // The engine line and the disk total follow the models.
  void loadDictate(machine, true);
}

export function downloadModel(machine: MachineConnectionTarget, id: string): Promise<void> {
  return modelAction(machine, 'downloadSpeechModel', id, "Couldn't start the download");
}

export function cancelModelDownload(machine: MachineConnectionTarget, id: string): Promise<void> {
  return modelAction(machine, 'cancelSpeechModelDownload', id, "Couldn't stop the download");
}

export function removeModel(machine: MachineConnectionTarget, id: string): Promise<void> {
  return modelAction(machine, 'deleteSpeechModel', id, "Couldn't remove the model");
}

let pollingFor: string | null = null;
let pollRun = 0;

/** Follows downloads on `machine` every half second until none moves (or another computer is picked). */
function pollModels(machine: MachineConnectionTarget): void {
  if (pollingFor === machine.id) return;
  pollingFor = machine.id;
  pollRun += 1;
  const run = pollRun;
  const live = () => run === pollRun && current(machine);
  void (async () => {
    try {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (!live()) return;
        const models = await listSpeechModels(machine);
        if (!live()) return;
        if (models === null) continue;
        const overview = useDictateStore.getState().overview;
        if (overview !== null) useDictateStore.setState({ overview: { ...overview, models } });
        if (!modelsBusy(models)) break;
      }
    } finally {
      if (run === pollRun) pollingFor = null;
    }
    // Ready (or stopped): the engine line changes with it.
    await loadDictate(machine, true);
  })();
}

/** Stops following downloads (Settings › Voice closed); the next read starts again if one moves. */
export function stopDictatePolling(): void {
  pollRun += 1;
  pollingFor = null;
}
