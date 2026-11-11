/**
 * The composer's Dictate control: the microphone records to a file on the phone first and, after
 * Stop, the computer's gxserver keeps and transcribes it (`src/voice/dictation.ts`); the text is
 * typed into the draft at the caret. While it records or transcribes, a row above the box shows it
 * with an ✕ that cancels (the recording is kept as dismissed); a failure stays in that row with
 * Transcribe again; a long press on the microphone offers Transcribe previous.
 *
 * CDXC:SessionChat 2026-10-08 DECISION: User asked for voice input in the chat box, to the left of the Terminal View button, on the desktop and the phone (GPUI Kit's speech input, #3333, on the desktop). Pressing the microphone starts listening and pressing it again stops; recognized text is typed into the draft and never sent by itself.
 * CDXC:SessionChat 2026-10-08 SEE-ALSO: `apps/desktop/src/app/native_chat/dictation.rs` is the desktop's control.
 * CDXC:VoiceMode 2026-10-20 DECISION: User: "use grok bot's api for the dictation mic button" and "the one in the chat box just pastes whatever i say into the chat box". Dictate uses xAI speech-to-text through gxserver with the key kept on the computer, instead of the platform recognizer; the platform recognizer code below is kept but unused (user: "keep but mark the old code as unused").
 * CDXC:VoiceMode 2026-11-05 DECISION: Each computer picks Dictate's engine (Local, OpenAI or xAI; Settings › Voice). The phone names what will transcribe wherever it shows Dictate, and on a missing local model offers its download and transcribes the kept recording once it is ready (the recording is never lost).
 * CDXC:VoiceMode 2026-10-20 SEE-ALSO: recording first and transcribing second, the Transcribing ✕, keeping cancelled recordings and Transcribe previous are the user's decision in the computer's `apps/desktop/src/app/voice_agent/dictation.rs`; the phone opens Transcribe previous on a long press (CDXC:SessionChat 2026-10-12 DECISION: actions open on a long press on the phone).
 */

import { requireOptionalNativeModule } from 'expo';
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Share } from 'react-native';

import { GhostexNative, type LocalDictation } from '../../../../modules/ghostex-native/src';

import type { MachineConnectionTarget } from '../../../machines/credentials';
import {
  dictationSupported,
  dismissDictation,
  dismissLocal,
  forgetRecording,
  latestUntranscribed,
  localRecording,
  onWaitingChanged,
  saveAndTranscribe,
  sendUnsent,
  startRecording,
  stopRecording,
  transcribeLatest,
  waitingRecordings,
  type Kept,
  type Transcription,
} from '../../../voice/dictation';
import type { DictateEngine } from '../../../voice/dictateModel';
import { readDictateEngine } from '../../../voice/dictateSettings';
import type { DictationTargets } from './dictationTarget';
import type { UserAction } from '../../rust/actions';
import { chatMachineLink } from '../../rust/machine-link';
import { setReadAloudDictating } from '../../../voice/readAloud';

type Subscription = { remove(): void };
type SpeechNative = {
  isRecognitionAvailable(): boolean;
  requestPermissionsAsync(): Promise<{ granted: boolean }>;
  start(options: ExpoSpeechRecognitionOptions): void;
  stop(): void;
  addListener(event: 'start' | 'end', listener: () => void): Subscription;
  addListener(event: 'result', listener: (event: ExpoSpeechRecognitionResultEvent) => void): Subscription;
  addListener(event: 'error', listener: (event: ExpoSpeechRecognitionErrorEvent) => void): Subscription;
};

const speech = requireOptionalNativeModule<SpeechNative>('ExpoSpeechRecognition');

/**
 * The switch for the Dictate control.
 *
 * CDXC:VoiceMode 2026-10-20 DECISION: The Dictate control is back on the phone, on Grok dictation (supersedes the 2026-10-09 decision that hid it on every OS until it was tested: the user asked for it to return with xAI speech-to-text). It shows only when the chat's computer lists the `voiceAgent` capability.
 * CDXC:SessionChat 2026-10-09 SEE-ALSO: the desktop's switch is `DICTATION_ENABLED` in `apps/desktop/src/app/native_chat/dictation.rs`.
 */
const DICTATION_ENABLED = true;

/**
 * `waiting`: a recording on this phone still waits for its words (offered with Transcribe).
 */
export type DictationPhase = 'idle' | 'starting' | 'recording' | 'transcribing' | 'failed' | 'waiting';

/** How long a send the computer never answered waits before it goes again, try after try. */
const AUTO_RETRY_MS = [3_000, 6_000, 12_000, 20_000, 30_000, 60_000];

/** iOS's share sheet takes the audio file; React Native's Android share sends text only. */
const SHARE_AUDIO = Platform.OS === 'ios';

/**
 * Hex on the chat's computer isn't ready: the row's button opens Voice settings, where Install Hex
 * and the steps are.
 *
 * CDXC:Dictate 2026-11-08 DECISION: User (Q1709): our local engine is gone and Hex is the recommended engine, used for the phone's dictation too (the computer transcribes). Supersedes the Download (0.72 GB) button that fetched the local model.
 */
const HEX_CODES: ReadonlySet<string> = new Set(['hexNotInstalled', 'hexNotRunning', 'hexNoModels', 'hexModelNotReady', 'hexVersion']);

export type DictationFix = { kind: 'settings'; label: string };

/** `m:ss` for a recording's length. */
export function dictationClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The chat a dictation is typed into: its core, and its question form boxes (`dictationTarget.ts`). */
export type DictationChat = {
  dispatch(action: UserAction): void;
  targets: DictationTargets | null;
};

/**
 * Dictate into a draft. The chat's core types the words (`insertDictation`): into the question
 * form box that had the keyboard when the recording started while that box still takes text, into
 * the chat box otherwise. `onError` gets a short message for a problem no row shows (no microphone
 * permission, nothing waiting for Transcribe previous).
 *
 * CDXC:VoiceMode 2026-11-09 WHY: A user lost recordings while the phone kept reconnecting ("not saving my audio is killer"). A recording the computer could not be reached for waits in the row as "Waiting for your computer" and goes again on its own (when the link comes back, and on a timer); leaving the chat keeps a recording (it is offered again, not dismissed); a recording still on the phone without its words is offered in the chat box ("Recording not transcribed") with Transcribe, Share (iPhone) and ✕ until its words are in a draft.
 * CDXC:Dictate 2026-11-10 WHY: "In a draft" is the core's answer (`dictationInserted`), not the request: the phone used to forget a recording as soon as it had asked for its words to be typed, so words the core then refused (their form had just been sent) left nothing to transcribe again. This hook only hands the words over. The chat's host takes the answer (it holds the chat box's text, and is there when no chat box is drawn) and a recording's one request is kept for the whole phone in `voice/dictation.ts`; the row hears from there when a request ended without the words in a draft, and the recording waits again.
 */
export function useDictation(
  machine: MachineConnectionTarget | null,
  onError: (message: string) => void,
  chat: DictationChat,
) {
  const { dispatch, targets } = chat;
  const [available, setAvailable] = useState(() => DICTATION_ENABLED && dictationSupported(machine));
  const [phase, setPhase] = useState<DictationPhase>('idle');
  const [failure, setFailure] = useState<{ kept: Kept; message: string; code: string | null } | null>(null);
  /** A recording on this phone still waiting for its words, offered while nothing else runs. */
  const [waiting, setWaiting] = useState<LocalDictation | null>(null);
  /** What will transcribe on the chat's computer (`/api/readDictateEngine`); null on older computers. */
  const [engine, setEngine] = useState<DictateEngine | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const phaseRef = useRef<DictationPhase>('idle');
  phaseRef.current = phase;
  /** One per run: a cancel flips it and remembers the computer's id to dismiss. */
  const run = useRef<{ cancelled: boolean; serverId: string | null }>({ cancelled: false, serverId: null });
  /** False once the chat box is gone: results stop touching it, and nothing is dismissed for that. */
  const mounted = useRef(true);
  /** The recording the microphone is writing now. */
  const recordingId = useRef<string | null>(null);
  const callbacks = useRef({ onError });
  callbacks.current = { onError };
  /** How many times the recording in the row went again on its own, so the waits keep growing across tries. */
  const autoTries = useRef<{ id: string; count: number }>({ id: '', count: 0 });

  /** Asks the computer what will transcribe now; answers it too. */
  const refreshEngine = useCallback(async (): Promise<DictateEngine | null> => {
    if (machine === null) return null;
    const next = await readDictateEngine(machine);
    setEngine(next);
    return next;
  }, [machine]);

  /** Looks for a recording on this phone still waiting for its words. */
  const refreshWaiting = useCallback(async () => {
    if (machine === null) return;
    const found = (await waitingRecordings())[0] ?? null;
    if (mounted.current) setWaiting(found);
  }, [machine]);

  useEffect(() => {
    setEngine(null);
    if (available) void refreshEngine();
  }, [available, refreshEngine]);

  useEffect(() => {
    if (!DICTATION_ENABLED || machine === null) {
      setAvailable(false);
      return undefined;
    }
    const link = chatMachineLink(machine);
    const refresh = () => setAvailable(dictationSupported(machine));
    refresh();
    void link.route().then(refresh, refresh);
    return link.onRouteChange(refresh);
  }, [machine]);

  // A recording left from before (the chat closed, the app restarted, a send that never went) is offered while the row is free.
  useEffect(() => {
    if (available && phase === 'idle') void refreshWaiting();
  }, [available, phase, refreshWaiting]);

  // A recording waits again, or no longer does (`voice/dictation.ts`): whichever chat box is on
  // screen then shows it, not only the one that asked for its words.
  useEffect(() => {
    if (!available) return undefined;
    return onWaitingChanged(() => {
      if (phaseRef.current === 'idle') void refreshWaiting();
    });
  }, [available, refreshWaiting]);

  // Read aloud keeps quiet while the microphone records (the core's `setDictating`), so the
  // recording never takes in the phone's own voice; transcribing no longer listens.
  const recording = phase === 'starting' || phase === 'recording';
  useEffect(() => {
    if (!recording) return undefined;
    setReadAloudDictating(true);
    return () => setReadAloudDictating(false);
  }, [recording]);

  // The form box a recording was aimed at is its target until its first words are back; whatever
  // arrives after the row left that run (a failure, ✕, a later Transcribe) is the chat box's.
  const running = recording || phase === 'transcribing';
  useEffect(() => {
    if (!running) targets?.release();
  }, [running, targets]);

  // The recording row's clock.
  useEffect(() => {
    if (phase !== 'recording') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [phase]);

  // Leaving the chat keeps a recording still running: it is closed and offered again in the chat box.
  // A transcription under way carries on; its recording stays on the phone until its words are in a draft.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (phaseRef.current === 'recording' || phaseRef.current === 'starting') void stopRecording(false);
    };
  }, []);

  // The box a run was aimed at is released with the chat box too (a question card takes its place
  // while the form stays), so no box stays marked for a run nothing shows any more.
  useEffect(() => () => targets?.release(), [targets]);

  /** Asks the core to type `dictated`, the words of recording `id`, into the run's target. */
  const insert = useCallback(
    (dictated: string, id: string) => {
      const words = dictated.trim();
      if (words.length === 0) {
        void forgetRecording(id);
        return;
      }
      // The question form box the recording started in; the core checks that it still takes text.
      // The host adds the chat box as it is now, which takes the words when the form box does not.
      const box = targets?.target() ?? null;
      const shown = box === null ? null : (targets?.shownBy(box) ?? null);
      dispatch({
        type: 'insertDictation',
        text: words,
        // Transcribe previous can come back without the recording's id: nothing is kept for it then.
        ...(id.length > 0 ? { id } : {}),
        ...(box === null ? {} : { form: box.form, slot: box.slot }),
        ...(shown === null ? {} : { shown: shown.text, shownStart: shown.caret, shownEnd: shown.caret }),
      });
    },
    [dispatch, targets],
  );

  const settle = useCallback(
    (current: { cancelled: boolean }, result: Transcription | null) => {
      if (current.cancelled || result === null) return;
      if (result.kind === 'nothing' && result.id) void forgetRecording(result.id);
      // Gone: the words wait on the computer and the recording on the phone, offered when the chat opens again.
      if (!mounted.current) return;
      if (result.kind === 'text') {
        setPhase('idle');
        insert(result.text, result.id);
      } else if (result.kind === 'nothing') {
        setPhase('idle');
        if (result.message) callbacks.current.onError(result.message);
      } else {
        setFailure({ kept: result.kept, message: result.message, code: result.code });
        setPhase('failed');
        // The engine line follows (Hex closed, a key missing).
        void refreshEngine();
      }
    },
    [insert, machine, refreshEngine],
  );

  const transcribeKept = useCallback(
    async (kept: Kept | null, quiet = false) => {
      if (machine === null) return;
      const current = { cancelled: false, serverId: kept?.kind === 'server' ? kept.id : null };
      run.current = current;
      if (!quiet) {
        setFailure(null);
        setWaiting(null);
        setPhase('transcribing');
      }
      const result =
        kept === null
          ? await transcribeLatest(machine, () => current.cancelled)
          : await saveAndTranscribe(
              machine,
              kept,
              () => current.cancelled,
              (id) => {
                current.serverId = id;
              },
            );
      // A tap (Transcribe again, ✕, a new recording) took over while a quiet retry ran.
      if (quiet && run.current !== current) return;
      settle(current, result);
    },
    [machine, settle],
  );

  // A send the computer never answered (a dropped link) goes again on its own: when the link comes back and on a timer.
  const retryable = phase === 'failed' && failure !== null && failure.code === null && failure.kept.kind === 'local';
  useEffect(() => {
    if (!retryable || machine === null || failure === null) return undefined;
    const kept = failure.kept;
    if (kept.kind !== 'local') return undefined;
    if (autoTries.current.id !== kept.recording.id) autoTries.current = { id: kept.recording.id, count: 0 };
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let live = true;
    const again = async () => {
      if (!live || busy || phaseRef.current !== 'failed') return;
      busy = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      await transcribeKept(kept, true);
      busy = false;
      // Still waiting with the same failure: the next try is a little later each time, at most a minute apart.
      if (live && phaseRef.current === 'failed') schedule();
    };
    const schedule = () => {
      const tries = autoTries.current;
      const delay = AUTO_RETRY_MS[Math.min(tries.count, AUTO_RETRY_MS.length - 1)];
      tries.count += 1;
      timer = setTimeout(() => void again(), delay);
    };
    schedule();
    const link = chatMachineLink(machine);
    const unsubscribe = link.onRouteChange(() => void again());
    const connected = GhostexNative.addListener('onConnectionState', (event) => {
      if (event.machineId === machine.id && event.state === 'connected') void again();
    });
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      unsubscribe();
      connected.remove();
    };
    // The kept recording is the failure's; a new failure object restarts the ladder.
  }, [retryable, failure, machine, transcribeKept]);

  const stop = useCallback(async () => {
    // Shown at once, so a second tap while the file closes does not stop it twice.
    setPhase('transcribing');
    let recording = await stopRecording(false);
    // The recorder had already stopped (a microphone that went away, a reload): its file is still here.
    if (recording === null && recordingId.current !== null) recording = await localRecording(recordingId.current);
    recordingId.current = null;
    if (recording === null) {
      setPhase('idle');
      return;
    }
    await transcribeKept({ kind: 'local', recording });
  }, [transcribeKept]);

  const start = useCallback(async () => {
    if (machine === null) return;
    const current = { cancelled: false, serverId: null };
    run.current = current;
    // Decided now, at the press: a box touched while it records does not move the words.
    targets?.aimAtFocused();
    setFailure(null);
    setWaiting(null);
    setPhase('starting');
    // What transcribes may have changed on the computer since the chat opened.
    void refreshEngine();
    // A recording the phone was still writing when this chat box was made (the app reloaded) is closed and kept, not dismissed.
    await GhostexNative.dictationRecordStop(false).catch(() => null);
    // Recordings an earlier run could not hand over go now, off the path of this one.
    void sendUnsent(machine);
    const started = await startRecording((message) => {
      // The microphone went away: what was recorded so far is transcribed.
      callbacks.current.onError(`${message} What was recorded so far is being transcribed.`);
      if (phaseRef.current === 'recording') void stop();
    });
    if ('error' in started) {
      setPhase('idle');
      callbacks.current.onError(started.error);
      return;
    }
    recordingId.current = started.id;
    if (current.cancelled) {
      const recording = await stopRecording(true);
      recordingId.current = null;
      if (recording !== null)
        void saveAndTranscribe(
          machine,
          { kind: 'local', recording },
          () => true,
          () => undefined,
        );
      return;
    }
    setStartedAt(Date.now());
    setNow(Date.now());
    setPhase('recording');
  }, [machine, stop, refreshEngine, targets]);

  /** The microphone button: start, or stop and transcribe. */
  const toggle = useCallback(async () => {
    if (phaseRef.current === 'recording') await stop();
    else if (phaseRef.current === 'idle' || phaseRef.current === 'failed') await start();
  }, [start, stop]);

  /** Sets a phone recording aside as dismissed: the computer keeps it (Dictation history) once it can be sent. */
  const dismissKeptLocal = useCallback(
    async (local: LocalDictation) => {
      if (machine === null) return;
      const dismissed = await dismissLocal(local);
      void saveAndTranscribe(
        machine,
        { kind: 'local', recording: dismissed },
        () => true,
        () => undefined,
      );
    },
    [machine],
  );

  /** ✕: a recording stops and is kept as dismissed; a transcription is dismissed; a failure or waiting recording is set aside the same way. */
  const cancel = useCallback(async () => {
    const current = run.current;
    const was = phaseRef.current;
    const failed = failure;
    const offered = waiting;
    current.cancelled = true;
    setPhase('idle');
    setFailure(null);
    setWaiting(null);
    if (machine === null) return;
    if (was === 'recording') {
      const recording = await stopRecording(true);
      recordingId.current = null;
      if (recording !== null) await dismissKeptLocal(recording);
    } else if (was === 'transcribing' && current.serverId !== null) {
      void dismissDictation(machine, current.serverId);
      void forgetRecording(current.serverId);
    } else if (was === 'failed' && failed !== null) {
      if (failed.kept.kind === 'local') await dismissKeptLocal(failed.kept.recording);
      else {
        void dismissDictation(machine, failed.kept.id);
        void forgetRecording(failed.kept.id);
      }
    } else if (offered !== null) {
      await dismissKeptLocal(offered);
    }
    // The row is free again: the next recording still waiting shows at once, not only when the chat opens again.
    await refreshWaiting();
  }, [machine, failure, waiting, dismissKeptLocal, refreshWaiting]);

  const retry = useCallback(async () => {
    if (failure !== null) await transcribeKept(failure.kept);
    else if (waiting !== null) await transcribeKept({ kind: 'local', recording: waiting });
  }, [failure, waiting, transcribeKept]);

  const transcribePrevious = useCallback(async () => {
    if (phaseRef.current !== 'idle' && phaseRef.current !== 'failed') return;
    await transcribeKept(null);
  }, [transcribeKept]);

  /** The recording the row is about, when this phone has its audio (for Share). */
  const local: LocalDictation | null =
    phase === 'failed' && failure?.kept.kind === 'local' ? failure.kept.recording : phase === 'idle' ? waiting : null;

  /** Share: the recording's audio file, to save it or send it somewhere else (iPhone). */
  const share = useCallback(async () => {
    if (local === null) return;
    try {
      await Share.share({ url: `file://${local.path}`, title: 'Dictation recording' });
    } catch {
      callbacks.current.onError("Couldn't share the recording.");
    }
  }, [local]);

  const fix: DictationFix | null =
    failure !== null && failure.code !== null && HEX_CODES.has(failure.code)
      ? { kind: 'settings', label: 'Set up Hex' }
      : null;
  const failureText = failure?.message ?? null;

  /** What Transcribe previous would take, asked fresh (for the long-press menu). */
  const previous = useCallback(async () => (machine === null ? null : latestUntranscribed(machine)), [machine]);

  const shownPhase: DictationPhase = phase === 'idle' && waiting !== null ? 'waiting' : phase;
  return {
    available,
    phase: shownPhase,
    listening: phase === 'recording' || phase === 'starting',
    failure: failureText,
    /** The computer could not be reached; the row says it goes again on its own. */
    retrying: retryable,
    /** How long the recording offered in the row is. */
    waitingMs: shownPhase === 'waiting' ? (waiting?.durationMs ?? 0) : 0,
    /** Share shows for a recording this phone has (iPhone; Android's share sheet takes no files from here). */
    canShare: SHARE_AUDIO && local !== null,
    elapsedMs: phase === 'recording' ? Math.max(0, now - startedAt) : 0,
    /** What will transcribe ("Hex, Parakeet v3"), or null when the computer doesn't say. */
    engine,
    fix,
    toggle,
    cancel,
    retry,
    share,
    transcribePrevious,
    previous,
  };
}

/**
 * UNUSED since 2026-10-20 (CDXC:VoiceMode DECISION above): the platform speech recognizer
 * (`expo-speech-recognition`) the Dictate control used before Grok dictation. Kept, not wired.
 */
const SYSTEM_DICTATION_ENABLED = false;

function recognitionAvailable(): boolean {
  if (!SYSTEM_DICTATION_ENABLED) return false;
  try {
    return speech?.isRecognitionAvailable() ?? false;
  } catch {
    return false;
  }
}

/** The device's language for the recognizer, or the recognizer's own default. */
function deviceLanguage(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || undefined;
  } catch {
    return undefined;
  }
}

/**
 * UNUSED since 2026-10-20: the platform recognizer's Dictate. `onPhrase` receives each recognized
 * phrase; `onError` a short message for a failure the reader should know about (no microphone
 * permission, no recognizer for the language).
 */
export function useSystemDictation(onPhrase: (text: string) => void, onError: (message: string) => void) {
  const [available] = useState(recognitionAvailable);
  const [listening, setListening] = useState(false);
  const phrase = useRef(onPhrase);
  const failure = useRef(onError);
  phrase.current = onPhrase;
  failure.current = onError;

  useEffect(() => {
    if (speech === null || !available) return;
    const subscriptions = [
      speech.addListener('start', () => setListening(true)),
      speech.addListener('end', () => setListening(false)),
      speech.addListener('result', (event) => {
        const text = event.results[0]?.transcript?.trim();
        if (event.isFinal && text) phrase.current(text);
      }),
      speech.addListener('error', (event) => {
        setListening(false);
        // Stopping, or a pause with nothing said, is not a failure the reader needs to hear about.
        if (event.error === 'aborted' || event.error === 'no-speech' || event.error === 'speech-timeout') return;
        failure.current(event.message || 'Dictation stopped.');
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, [available]);

  const toggle = useCallback(async () => {
    if (speech === null) return;
    if (listening) {
      speech.stop();
      return;
    }
    const permission = await speech.requestPermissionsAsync();
    if (!permission.granted) {
      failure.current('Ghostex needs microphone and speech recognition access to dictate.');
      return;
    }
    speech.start({ lang: deviceLanguage(), interimResults: false, continuous: true, addsPunctuation: true });
  }, [listening]);

  return { available, listening, toggle };
}
