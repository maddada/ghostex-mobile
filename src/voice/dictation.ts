/**
 * Dictate on the phone, in two independent steps: the microphone is recorded to a file on the phone
 * first (`GhostexVoiceRecorder.kt` / `.swift`), and only after Stop is that file handed to the computer's
 * gxserver, which keeps it and transcribes it with xAI using the key kept on the computer
 * (`/api/saveDictationRecording`, `/api/transcribeDictation`). The phone deletes its copy only once
 * its words are in the chat box (or nothing was heard, or the person dismissed it), so a dropped link,
 * a refused key, Hex being closed or leaving the chat never loses what was said: the recording stays
 * on the phone, goes again on its own when the computer is back, and the chat box offers it until then.
 *
 * CDXC:VoiceMode 2026-11-09 WHY: A user: "most of the time I record, and it fails and my audio does not get saved properly ... not saving my audio is killer". The phone forgot its copy as soon as the computer had the file, a failed send needed a tap on a row that vanished when the chat closed, and leaving the chat while recording marked the recording dismissed. Sending is idempotent by recording id (`save_piece` and `transcribe` in server/src/voice_agent/), so the phone re-sends and re-asks freely.
 *
 * CDXC:VoiceMode 2026-10-20 SEE-ALSO: the user's decision is in the computer's `server/src/voice_agent/recordings.rs` and `apps/desktop/src/app/voice_agent/dictation.rs`; the desktop records with `recorder.rs`.
 */

import { GhostexNative, type LocalDictation } from '../../modules/ghostex-native/src';
import { chatMachineLink } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from '../machines/credentials';
import { VOICE_SUPPORTED } from './conversation';
import { microphoneAllowed, microphoneDeniedMessage } from './microphone';

/** Raw bytes per upload piece: under gxserver's 1 MiB JSON limit once base64 grows it by a third. */
const PIECE_BYTES = 512 * 1024;
const UPLOAD_TIMEOUT_MS = 30_000;
/** xAI usually answers in a few seconds; a long recording takes longer. */
const TRANSCRIBE_TIMEOUT_MS = 180_000;
const SHORT_TIMEOUT_MS = 10_000;

/** A recording the computer keeps, as gxserver describes it. */
export type ServerDictation = {
  id: string;
  createdAt: number;
  durationMs: number;
  status: 'recorded' | 'transcribing' | 'transcribed' | 'failed' | 'dismissed';
  text: string | null;
  error: { code: string; message: string; provider?: string | null } | null;
  /** What made the text ("Local, Parakeet v3"); absent on computers before the local engine. */
  engine?: { engine: string; label: string } | null;
};

/** Where a recording without text is: on the computer, or still only on the phone. */
export type Kept = { kind: 'server'; id: string } | { kind: 'local'; recording: LocalDictation };

/**
 * What a transcription came to. `id` is the recording's (the phone's id is the computer's too).
 * A failure with `code` null never got an answer from the computer (a dropped link): sending again later can fix it.
 */
export type Transcription =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'nothing'; id: string; message: string }
  | { kind: 'failed'; kept: Kept; message: string; code: string | null };

/** Recordings a transcription is working on now; the chat box doesn't offer them as waiting. */
const handling = new Set<string>();
/** Recordings whose words are in or that were dismissed, while the phone's copy is still being put away. */
const settled = new Set<string>();

/** Whether the computer's gxserver can dictate (it lists the `voiceAgent` capability). */
export function dictationSupported(machine: MachineConnectionTarget | null): boolean {
  if (!VOICE_SUPPORTED || machine === null) return false;
  return chatMachineLink(machine).capabilities()?.includes('voiceAgent') === true;
}

/** The device's language as a BCP-47 primary tag ("en"), the recognizer's hint. */
function deviceLanguage(): string | undefined {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.split('-')[0] || undefined;
  } catch {
    return undefined;
  }
}

async function rpc(
  machine: MachineConnectionTarget,
  method: string,
  params: unknown,
  timeoutMs: number,
): Promise<{ result: Record<string, unknown> } | { error: string }> {
  const answer = await chatMachineLink(machine).rpc(method, params, timeoutMs);
  if (answer.error) return { error: answer.error.message || "Couldn't reach Ghostex on your computer." };
  return { result: (answer.result ?? {}) as Record<string, unknown> };
}

/**
 * Starts recording. `onMicError` hears about a microphone that stops later. Answers the recording's
 * id, or a sentence for why the microphone did not start.
 */
export async function startRecording(
  onMicError: (message: string) => void,
): Promise<{ id: string } | { error: string }> {
  if (!(await microphoneAllowed())) return { error: microphoneDeniedMessage('dictate') };
  let id: string;
  try {
    id = await GhostexNative.dictationRecordStart();
  } catch {
    return { error: "Couldn't start the microphone." };
  }
  const subscription = GhostexNative.addListener('onVoiceEvent', (event) => {
    if (event.mode !== 'dictation' || event.sessionId !== id || event.kind !== 'status') return;
    if (event.status === 'micError') {
      subscription.remove();
      onMicError(event.message ?? 'The microphone stopped.');
    }
  });
  stopListening = () => subscription.remove();
  return { id };
}

let stopListening: (() => void) | null = null;

/** Stops recording and closes the file (marked dismissed when the reader cancelled). */
export async function stopRecording(dismissed: boolean): Promise<LocalDictation | null> {
  stopListening?.();
  stopListening = null;
  try {
    return await GhostexNative.dictationRecordStop(dismissed);
  } catch {
    return null;
  }
}

/**
 * Hands a phone recording to the computer in pieces and answers what the computer keeps. The first
 * ask carries no audio: a computer that already has the recording answers with it at once, so sending
 * again costs nothing. The phone's copy stays (`forgetRecording` removes it).
 */
async function upload(
  machine: MachineConnectionTarget,
  recording: LocalDictation,
): Promise<{ dictation: ServerDictation } | { error: string }> {
  const finished = {
    createdAt: recording.createdAt,
    durationMs: recording.durationMs,
    client: 'phone',
    dismissed: recording.dismissed,
    language: deviceLanguage(),
  };
  const probe = await rpc(machine, 'saveDictationRecording', { id: recording.id, offset: 0, chunk: '', done: false, ...finished }, UPLOAD_TIMEOUT_MS);
  if ('error' in probe) return probe;
  const known = probe.result.dictation as ServerDictation | undefined;
  if (known) return { dictation: known };
  let offset = 0;
  for (;;) {
    let chunk: string;
    try {
      chunk = await GhostexNative.dictationReadPiece(recording.path, offset, PIECE_BYTES);
    } catch {
      return { error: "The recording can't be read on this phone anymore" };
    }
    const end = offset + Math.floor((chunk.length * 3) / 4) - (chunk.endsWith('==') ? 2 : chunk.endsWith('=') ? 1 : 0);
    const done = end >= recording.bytes;
    const answer = await rpc(machine, 'saveDictationRecording', { id: recording.id, offset, chunk, done, ...finished }, UPLOAD_TIMEOUT_MS);
    if ('error' in answer) return answer;
    const dictation = answer.result.dictation as ServerDictation | undefined;
    if (dictation) return { dictation };
    const received = typeof answer.result.received === 'number' ? answer.result.received : end;
    if (done && received >= recording.bytes) return { error: "Ghostex on your computer didn't confirm the recording." };
    offset = Math.min(received, recording.bytes);
  }
}

/** The phone's own copy of recording `id`, if it still has one. */
export async function localRecording(id: string): Promise<LocalDictation | null> {
  try {
    return (await GhostexNative.dictationUnsent()).find((recording) => recording.id === id) ?? null;
  } catch {
    return null;
  }
}

/** The words are in the chat box (or nothing was heard): the phone's copy of `id` goes; the computer keeps its own. */
export async function forgetRecording(id: string): Promise<void> {
  settled.add(id);
  const recording = await localRecording(id);
  if (recording !== null) await GhostexNative.dictationForget(recording.path).catch(() => undefined);
}

/**
 * Hands the computer every phone recording it may not have yet. A dismissed one is the computer's to
 * keep (Dictation history) and leaves the phone once it is there; one still waiting for its words
 * stays on the phone until they are in a chat box.
 */
export async function sendUnsent(machine: MachineConnectionTarget): Promise<void> {
  let pending: LocalDictation[] = [];
  try {
    pending = await GhostexNative.dictationUnsent();
  } catch {
    return;
  }
  for (const recording of pending) {
    if (handling.has(recording.id)) continue;
    const sent = await upload(machine, recording);
    if ('error' in sent || !recording.dismissed) continue;
    if (sent.dictation.status !== 'dismissed' && sent.dictation.status !== 'transcribed') {
      await rpc(machine, 'dismissDictation', { id: recording.id }, SHORT_TIMEOUT_MS);
    }
    await GhostexNative.dictationForget(recording.path).catch(() => undefined);
  }
}

/** Recordings on this phone still waiting for their words (not dismissed, not being worked on), newest first. */
export async function waitingRecordings(): Promise<LocalDictation[]> {
  try {
    const all = await GhostexNative.dictationUnsent();
    return all
      .filter((recording) => !recording.dismissed && !handling.has(recording.id) && !settled.has(recording.id))
      .reverse();
  } catch {
    return [];
  }
}

function outcome(answer: { result: Record<string, unknown> } | { error: string }, kept: Kept, id: string): Transcription {
  if ('error' in answer) return { kind: 'failed', kept, message: answer.error, code: null };
  const dictation = answer.result.dictation as ServerDictation | undefined;
  if (dictation?.status === 'transcribed') {
    const text = (dictation.text ?? '').trim();
    return text.length > 0
      ? { kind: 'text', id: dictation.id || id, text }
      : {
          kind: 'nothing',
          id: dictation.id || id,
          message: 'No words were heard in the recording. It is kept on your computer in Settings › Dictation › Dictation history.',
        };
  }
  return {
    kind: 'failed',
    kept,
    message: dictation?.error?.message ?? 'The transcription failed.',
    code: dictation?.error?.code ?? null,
  };
}

/**
 * Hands a recording to the computer if only the phone has it, then transcribes it. `isCancelled`
 * is asked between the steps: a cancelled one is kept on the computer as dismissed instead.
 * `onServerId` learns the computer's id as soon as it has the recording, so a cancel can dismiss it.
 */
export async function saveAndTranscribe(
  machine: MachineConnectionTarget,
  kept: Kept,
  isCancelled: () => boolean,
  onServerId: (id: string) => void,
): Promise<Transcription | null> {
  const id = kept.kind === 'local' ? kept.recording.id : kept.id;
  handling.add(id);
  try {
    if (kept.kind === 'local') {
      const recording = isCancelled() ? { ...kept.recording, dismissed: true } : kept.recording;
      const saved = await upload(machine, recording);
      if ('error' in saved) {
        return {
          kind: 'failed',
          kept,
          message: `Couldn't send the recording to your computer (${saved.error.replace(/\.$/, '')}).`,
          code: null,
        };
      }
    }
    onServerId(id);
    if (isCancelled()) {
      const dismissed = await rpc(machine, 'dismissDictation', { id }, SHORT_TIMEOUT_MS);
      // The computer keeps it as dismissed (Dictation history); the phone's copy is no longer needed.
      if (!('error' in dismissed) && kept.kind === 'local') await GhostexNative.dictationForget(kept.recording.path).catch(() => undefined);
      return null;
    }
    const answer = await rpc(machine, 'transcribeDictation', { id }, TRANSCRIBE_TIMEOUT_MS);
    if (isCancelled()) {
      await rpc(machine, 'dismissDictation', { id }, SHORT_TIMEOUT_MS);
      return null;
    }
    return outcome(answer, kept, id);
  } finally {
    handling.delete(id);
  }
}

/** Transcribe previous: the newest recording without text, from any device. */
export async function transcribeLatest(
  machine: MachineConnectionTarget,
  isCancelled: () => boolean,
): Promise<Transcription | null> {
  await sendUnsent(machine);
  const answer = await rpc(machine, 'transcribeDictation', { latest: true }, TRANSCRIBE_TIMEOUT_MS);
  const id = 'result' in answer ? (answer.result.dictation as ServerDictation | undefined)?.id : undefined;
  if (isCancelled()) {
    if (id) await rpc(machine, 'dismissDictation', { id }, SHORT_TIMEOUT_MS);
    return null;
  }
  if ('error' in answer) return { kind: 'nothing', id: id ?? '', message: answer.error };
  return outcome(answer, { kind: 'server', id: id ?? '' }, id ?? '');
}

/** The reader cancelled a transcription: the computer keeps the recording as dismissed. */
export async function dismissDictation(machine: MachineConnectionTarget, id: string): Promise<void> {
  await rpc(machine, 'dismissDictation', { id }, SHORT_TIMEOUT_MS);
}

/** Marks a phone recording dismissed before it reaches the computer. */
export async function dismissLocal(recording: LocalDictation): Promise<LocalDictation> {
  settled.add(recording.id);
  await GhostexNative.dictationDismissLocal(recording.path).catch(() => undefined);
  return { ...recording, dismissed: true };
}

/** What Transcribe previous would take: `{durationMs, createdAt}` of the newest recording without text. */
export async function latestUntranscribed(
  machine: MachineConnectionTarget,
): Promise<{ durationMs: number; createdAt: number } | null> {
  const answer = await rpc(machine, 'listDictations', { limit: 0 }, SHORT_TIMEOUT_MS);
  if ('error' in answer) return null;
  const latest = answer.result.latestUntranscribed as ServerDictation | null | undefined;
  return latest ? { durationMs: latest.durationMs, createdAt: latest.createdAt } : null;
}
