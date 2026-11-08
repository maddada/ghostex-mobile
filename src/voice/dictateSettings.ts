/**
 * Dictate's settings on a computer, read and written through that computer's gxserver
 * (`dictateModel.ts` has the shapes): the store behind Settings › Voice and its Language and
 * Dictionary pages, which all edit the computer picked at the top of Settings › Voice.
 */

import { create } from 'zustand';

import { chatMachineLink } from '../chat/rust/machine-link';
import { isDemoMachine } from '../demo/identity';
import type { MachineConnectionTarget } from '../machines/credentials';
import { isUnknownRoute, type DictateEngine, type DictateOverview, type DictateSettings } from './dictateModel';

const READ_TIMEOUT_MS = 15_000;

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
}

/**
 * Saves a change on the computer. The page shows it at once and goes back to the computer's
 * answer (or the old value, with the reason) when it comes.
 */
export async function changeDictate(
  machine: MachineConnectionTarget,
  patch: Partial<DictateSettings> & { localRetiredNotice?: false },
): Promise<void> {
  const before = useDictateStore.getState().overview;
  if (before === null || !current(machine)) return;
  const { localRetiredNotice: _dismissed, ...changes } = patch;
  const settings = {
    ...before.settings,
    ...changes,
    polish: { ...before.settings.polish, ...(changes.polish ?? {}) },
  };
  const localRetired = patch.localRetiredNotice === false ? null : before.localRetired;
  useDictateStore.setState({ overview: { ...before, settings, localRetired }, problem: null });
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
}

/** The notice that the computer's local engine was retired for Hex, read: it isn't shown again. */
export function dismissLocalRetired(machine: MachineConnectionTarget): Promise<void> {
  return changeDictate(machine, { localRetiredNotice: false });
}

/** Deletes the retired local engine's models on the computer. */
export async function deleteOldModels(machine: MachineConnectionTarget): Promise<void> {
  const answer = await call<DictateOverview>(machine, 'deleteOldSpeechModels', {});
  if (!current(machine)) return;
  if (!answer.ok) {
    useDictateStore.setState({ problem: `Couldn't delete the old speech models: ${answer.message}` });
    return;
  }
  useDictateStore.setState({ overview: answer.value, problem: null });
}
